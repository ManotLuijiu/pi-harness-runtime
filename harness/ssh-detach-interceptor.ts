/**
 * SSH Detach Interceptor
 *
 * Automatically transforms bare `ssh ... &` commands into detached patterns
 * that don't hang the SSH session.
 *
 * Problem: `ssh user@host "command &"` keeps SSH open waiting for the background
 * process. This causes 2000+ second hangs.
 *
 * Solution: Auto-inject nohup + redirect + DONE echo so SSH exits immediately
 * while the process continues running on the server.
 */

/**
 * Find the last SSH command in a string (handles pipelined commands).
 * Returns { start, end } of the ssh ... part, or null if no SSH found.
 */
function findLastSshCommand(s: string): { start: number; end: number } | null {
	// Find the LAST occurrence of "ssh " (word boundary)
	const matches = [...s.matchAll(/\bssh\s+/gm)];
	if (matches.length === 0) return null;

	const lastMatch = matches[matches.length - 1];
	const sshStart = lastMatch.index!;

	// Find where the SSH command ends:
	// Look for a | that's OUTSIDE quotes, which starts a new pipe segment
	let sshEnd = s.length;
	let depth = 0;
	for (let i = sshStart; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && i + 1 < s.length) {
			i++; // skip escaped char
			continue;
		}
		if (depth > 0) {
			if ((ch === '"' && depth === 1) || (ch === "'" && depth === 2)) {
				depth = 0;
			}
		} else if (ch === '"') depth = 1;
		else if (ch === "'") depth = 2;
		else if (ch === "|") {
			sshEnd = i;
			break;
		}
	}
	return { start: sshStart, end: sshEnd };
}

/**
 * Check if a command is an SSH command.
 */
export function isSshCommand(command: string): boolean {
	return /\bssh\s+/m.test(command.trim());
}

/**
 * Check if an SSH command uses the detached pattern:
 * nohup + redirect + DONE echo (visible OUTSIDE the quoted remote command).
 *
 * Note: & inside the quoted remote command string does NOT count as detached.
 */
export function isDetachedPattern(command: string): boolean {
	const sshRange = findLastSshCommand(command);
	if (!sshRange) return false;
	const sshPart = command.slice(sshRange.start, sshRange.end);
	// nohup must be OUTSIDE quotes (in the ssh command prefix, before the quoted remote cmd)
	return (
		/nohup\b/.test(sshPart) &&
		(/>\s*\//.test(sshPart) || /2>&1/.test(sshPart)) &&
		/echo\s+['"]?\w+['"]?\s*$/.test(command.trim())
	);
}

/**
 * Check if an SSH command has a trailing bare & OUTSIDE the quoted remote command.
 * This is the risky pattern that backgrounds the SSH connection itself.
 *
 * NOT risky (safe): & inside the quoted remote command string
 * RISKY (needs transform): & outside the quoted remote command (backgrounds SSH)
 */
export function hasBareAmpersand(command: string): boolean {
	if (!isSshCommand(command)) return false;
	if (isDetachedPattern(command)) return false;

	const sshRange = findLastSshCommand(command);
	if (!sshRange) return false;
	const sshPart = command.slice(sshRange.start, sshRange.end);

	// Extract the ssh prefix (ssh + host + flags) and the remote command argument
	// The remote command is typically quoted; we need to find where it ends
	// Strategy: find the last quoted string in the ssh part
	let remoteCmdEnd = sshPart.length;

	// Scan for the last closing quote outside escaped chars
	for (let i = sshPart.length - 1; i >= 0; i--) {
		if (sshPart[i] === "\\" && i > 0) {
			i--; // skip escaped char
			continue;
		}
		// Count if we see a quote — the first unescaped quote pair we encounter
		// marks the end of the quoted remote command
		if (sshPart[i] === '"' || sshPart[i] === "'") {
			// Find the matching opening quote going forward
			const closeQuote = sshPart[i];
			let found = false;
			for (let j = i - 1; j >= 0; j--) {
				if (sshPart[j] === "\\") {
					j--;
					continue;
				}
				if (sshPart[j] === closeQuote) {
					found = true;
					break;
				}
			}
			if (found) {
				remoteCmdEnd = i + 1;
				break;
			}
		}
	}

	// Everything after the quoted remote command
	const afterQuotes = sshPart.slice(remoteCmdEnd).trim();
	// Check if there's a bare & (not &&, not |&) outside the quoted part
	return /^\s*&\s*$/.test(afterQuotes);
}

/**
 * Check if an SSH command has a `&& ... &` or `; ... &` pattern INSIDE
 * the quoted remote command. This means: "run A, then run B, then background B".
 *
 * This is risky because SSH waits for the WHOLE quoted command chain to complete.
 * If B hangs (import error, DB timeout, port conflict), SSH never exits.
 *
 * RISKY: ssh ... "cd X && python uvicorn ... &"
 * RISKY: ssh ... "cmd1; cmd2 &".
 * SAFE:  ssh ... "cmd &" (just backgrounds one command)
 */
export function hasCommandChainWithAmpersand(command: string): boolean {
	if (!isSshCommand(command)) return false;
	if (isDetachedPattern(command)) return false;

	const sshRange = findLastSshCommand(command);
	if (!sshRange) return false;
	const sshPart = command.slice(sshRange.start, sshRange.end);

	// Find the quoted remote command
	const quoteMatch = sshPart.match(/['"](.+?)['"]\s*$/s);
	if (!quoteMatch) return false;

	const quotedContent = quoteMatch[1];
	// Check for && or ; followed by & inside the quoted content
	// Pattern: "cmd1 && cmd2 &" or "cmd1; cmd2 &"
	// We want to catch when there's a chain (&& or ;) and then &
	// Risky: command chain followed by &
	// e.g. "cd /path && python uvicorn 2>&1 &"  or "cmd1 && cmd2 &"
	// Safe: just one command with & ("cmd &") or detached ("cmd > log 2>&1 & echo DONE")
	const trimmed = quotedContent.trim();
	// Detect && or ; followed by anything, then &
	return /&&.+\s+&\s*$/.test(trimmed) || /;.+\s+&\s*$/.test(trimmed);
}

/**
 * Transform a command to use detached SSH pattern.
 * Handles TWO risky patterns:
 *
 * Pattern 1 (outside quotes): ssh user@host 'cmd' &
 *   → ssh user@host 'cmd' nohup '' > log 2>&1 & echo DONE
 *
 * Pattern 2 (inside quotes, command chain): ssh user@host "cd X && python uvicorn &"
 *   → ssh user@host "cd X && nohup python uvicorn > /tmp/herdr-ssh.log 2>&1 & echo SSH_DETACHED"
 *
 * The && operators in pattern 2 are preserved; nohup is inserted before the
 * final backgrounded command so SSH exits even if that command hangs.
 */
export function transformToDetached(
	command: string,
	config: { logFile?: string } = {},
): string {
	const { logFile = "/tmp/herdr-ssh.log" } = config;

	if (isDetachedPattern(command)) return command;

	const sshRange = findLastSshCommand(command);
	if (!sshRange) return command;

	const beforeSsh = command.slice(0, sshRange.start);
	const sshPart = command.slice(sshRange.start, sshRange.end);
	const afterSsh = command.slice(sshRange.end);

	// Find where the remote command argument ends (last closing quote)
	let remoteCmdEnd = sshPart.length;
	for (let i = sshPart.length - 1; i >= 0; i--) {
		if (sshPart[i] === "\\" && i > 0) {
			i--;
			continue;
		}
		if (sshPart[i] === '"' || sshPart[i] === "'") {
			const closeQuote = sshPart[i];
			let found = false;
			for (let j = i - 1; j >= 0; j--) {
				if (sshPart[j] === "\\") {
					j--;
					continue;
				}
				if (sshPart[j] === closeQuote) {
					found = true;
					break;
				}
			}
			if (found) {
				remoteCmdEnd = i + 1;
				break;
			}
		}
	}

	// sshPrefix is the SSH command up to (not including) the remote command's opening quote.
	// We add the closing quote explicitly via openQuote (from quoteMatch).
	// For pattern-2 return, we use beforeQuote (without any quote) + openQuote + transformed + closeQuote.
	const sshPrefix = sshPart.slice(0, remoteCmdEnd - 1).trimEnd();
	// Find the opening quote position in sshPrefix so we can use "beforeQuote" for pattern-2
	const openQuotePos = sshPrefix.search(/['"]/);
	const beforeQuote = openQuotePos >= 0 ? sshPrefix.slice(0, openQuotePos) : sshPrefix;
	const afterRemoteCmd = sshPart.slice(remoteCmdEnd);

	// Pattern 1: trailing bare & OUTSIDE the quoted part
	if (/^\s*&\s*$/.test(afterRemoteCmd.trim())) {
		// sshPrefix = "ssh host 'cmd" (includes opening quote AND command content).
		// openQuotePos gives the position of the opening quote so we can strip it.
		const iq = openQuotePos >= 0 ? sshPrefix[openQuotePos] : "'";
		const sshBase = openQuotePos >= 0 ? sshPrefix.slice(0, openQuotePos).trimEnd() : sshPrefix.trimEnd();
		return (
			beforeSsh +
			sshBase +
			` ${iq}nohup ${iq} > ${logFile} 2>&1 & echo 'SSH_DETACHED'` +
			afterSsh
		);
	}

	// Pattern 2: && ... & inside the quoted command
	// e.g. ssh host "cd /path && python uvicorn &"
	// We need to add nohup and redirects to the final backgrounded command
	if (hasCommandChainWithAmpersand(command)) {
		// Extract the quoted content
		const quoteMatch = sshPart.match(/(['"])(.+?)\1\s*$/);
		if (quoteMatch) {
			const openQuote = quoteMatch[1];
			const content = quoteMatch[2];
			const afterQuote = sshPart.slice(
				(quoteMatch.index ?? 0) + quoteMatch[0].length,
			);

			// Transform: find "cmd1 && cmd2 2>&1 &" or "cmd1 && cmd2 &" pattern
			// Split on && or ; and wrap only the last command with nohup
			const chainMatch = content.match(/(.+?)(&&|;)\s*(.+?)\s+(2>&1)\s*&\s*$/);
			if (chainMatch) {
				const [, prefix, chainOp, lastCmd] = chainMatch;
				// Insert nohup before the last command, keep 2>&1 as-is
				const transformedContent = `${prefix}${chainOp} nohup ${lastCmd.trim()} 2>&1 & echo 'SSH_DETACHED'`;
				return (
					beforeSsh +
					beforeQuote +
					openQuote +
					transformedContent +
					openQuote +
					afterQuote +
					afterSsh
				);
			}

			// No 2>&1 before &: split on && or ; and wrap last command
			const simpleChain = content.match(/(.+?)(&&|;)\s*(.+?)\s*&\s*$/);
			if (simpleChain) {
				const [, prefix, chainOp, lastCmd] = simpleChain;
				const transformedContent = `${prefix}${chainOp} nohup ${lastCmd.trim()} > ${logFile} 2>&1 & echo 'SSH_DETACHED'`;
				return (
					beforeSsh +
					beforeQuote +
					openQuote +
					transformedContent +
					openQuote +
					afterQuote +
					afterSsh
				);
			}

			// Fallback: if no &&/; found but there's &, wrap with nohup
			if (/\s&\s*$/.test(content)) {
				const transformedContent = `nohup ${content.trim().replace(/\s+&\s*$/, ` > ${logFile} 2>&1 & echo 'SSH_DETACHED'`)}`;
				return (
					beforeSsh +
					sshPrefix +
					openQuote +
					transformedContent +
					openQuote +
					afterQuote +
					afterSsh
				);
			}
		}
	}

	return command;
}

/**
 * Detect SSH in a bash command and return warning info.
 */
export interface SshDetection {
	isSsh: boolean;
	isDetached: boolean;
	hasBareAmpersand: boolean;
	suggestion: string;
}

export function detectSsh(command: string): SshDetection {
	const ssh = isSshCommand(command);
	const detached = ssh ? isDetachedPattern(command) : false;
	const bare = ssh ? hasBareAmpersand(command) : false;

	return {
		isSsh: ssh,
		isDetached: detached,
		hasBareAmpersand: bare,
		suggestion:
			ssh && !detached && bare
				? "Warning: trailing '&' outside quotes backgrounds SSH itself. Use nohup ... > /tmp/log 2>&1 & echo DONE."
				: ssh && !detached
					? "Use detached SSH pattern: nohup ... > /tmp/log 2>&1 & echo DONE."
					: "",
	};
}
