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
 * Transform a command to use detached SSH pattern.
 * Removes trailing unquoted & and appends nohup wrapper.
 *
 * Before: ssh user@host 'kill 123' &
 * After:  ssh user@host 'kill 123' nohup '' > /tmp/herdr-ssh.log 2>&1 & echo 'SSH_DETACHED'
 *
 * The && operators inside the quoted command are preserved.
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

	const sshPrefix = sshPart.slice(0, remoteCmdEnd).trimEnd();
	const afterRemoteCmd = sshPart.slice(remoteCmdEnd);

	// Only transform if there's a trailing bare & OUTSIDE the quoted part
	if (!/^\s*&\s*$/.test(afterRemoteCmd.trim())) return command;

	// Remove the trailing & and rebuild with nohup
	return (
		beforeSsh +
		sshPrefix +
		` nohup '' > ${logFile} 2>&1 & echo 'SSH_DETACHED'` +
		afterSsh
	);
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
