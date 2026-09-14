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
function findLastSshCommand(s) {
    // Find the LAST occurrence of "ssh " (word boundary)
    const matches = [...s.matchAll(/\bssh\s+/gm)];
    if (matches.length === 0) return null;
    const lastMatch = matches[matches.length - 1];
    const sshStart = lastMatch.index;
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
export function isSshCommand(command) {
    return /\bssh\s+/m.test(command.trim());
}
/**
 * Check if an SSH command uses the detached pattern:
 * nohup + redirect + trailing DONE echo. The chain may live remotely
 * (inside the quoted command) or locally — either way ssh exits promptly.
 *
 * Note: a quoted `cmd &` alone (no redirect/echo) does NOT count.
 */
export function isDetachedPattern(command) {
    const sshRange = findLastSshCommand(command);
    if (!sshRange) return false;
    const sshPart = command.slice(sshRange.start, sshRange.end);
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
export function hasBareAmpersand(command) {
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
export function hasCommandChainWithAmpersand(command) {
    if (!isSshCommand(command)) return false;
    if (isDetachedPattern(command)) return false;
    const sshRange = findLastSshCommand(command);
    if (!sshRange) return false;
    const sshPart = command.slice(sshRange.start, sshRange.end);
    // Find the quoted remote command
    const quoteMatch = sshPart.match(/['"](.+?)['"]\s*$/s);
    if (!quoteMatch) return false;
    const quotedContent = quoteMatch[1];
    // Risky: command chain followed by &
    // e.g. "cd /path && python uvicorn 2>&1 &"  or "cmd1 && cmd2 &"
    // Safe: just one command with & ("cmd &") or detached ("cmd > log 2>&1 & echo DONE")
    const trimmed = quotedContent.trim();
    // Detect && or ; followed by anything, then &
    return /&&.+\s+&\s*$/.test(trimmed) || /;.+\s+&\s*$/.test(trimmed);
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
export function transformToDetached(command, config = {}) {
    const { logFile = "/tmp/herdr-ssh.log" } = config;
    if (isDetachedPattern(command)) return command;
    const sshRange = findLastSshCommand(command);
    if (!sshRange) return command;
    const beforeSsh = command.slice(0, sshRange.start);
    const sshPart = command.slice(sshRange.start, sshRange.end);
    const afterSsh = command.slice(sshRange.end);
    // Helper: find the position AFTER the closing quote of the last quoted arg
    // Returns position AFTER the closing quote, or s.length if no quotes found.
    function findClosingQuotePos(s) {
        for (let i = s.length - 1; i >= 0; i--) {
            if (s[i] === "\\" && i > 0) {
                i--;
                continue;
            }
            if (s[i] === '"' || s[i] === "'") {
                const cq = s[i];
                let found = false;
                for (let j = i - 1; j >= 0; j--) {
                    if (s[j] === "\\") {
                        j--;
                        continue;
                    }
                    if (s[j] === cq) {
                        found = true;
                        break;
                    }
                }
                if (found) return i + 1; // AFTER closing quote
            }
        }
        return s.length;
    }
    // Helper: find the position OF the closing quote (excluding the quote itself)
    function findClosingQuotePosExcl(s) {
        for (let i = s.length - 1; i >= 0; i--) {
            if (s[i] === "\\" && i > 0) {
                i--;
                continue;
            }
            if (s[i] === '"' || s[i] === "'") {
                const cq = s[i];
                let found = false;
                for (let j = i - 1; j >= 0; j--) {
                    if (s[j] === "\\") {
                        j--;
                        continue;
                    }
                    if (s[j] === cq) {
                        found = true;
                        break;
                    }
                }
                if (found) return i; // AT (not after) closing quote
            }
        }
        return s.length;
    }
    // Pattern 1: bare & OUTSIDE the quoted remote command
    // e.g. ssh host 'kill 123' &
    // remoteCmdEnd1 includes the closing quote in sshPrefix
    const remoteCmdEnd1 = findClosingQuotePos(sshPart);
    const sshPrefix = sshPart.slice(0, remoteCmdEnd1).trimEnd();
    const afterRemoteCmd = sshPart.slice(remoteCmdEnd1);
    if (/^\s*&\s*$/.test(afterRemoteCmd.trim())) {
        return (
            beforeSsh +
            sshPrefix +
            ` nohup '' > ${logFile} 2>&1 & echo 'SSH_DETACHED'` +
            afterSsh
        );
    }
    // Pattern 2: command chain with & INSIDE the quoted part
    // e.g. ssh host "cmd1 && cmd2 &"  or  ssh host "cmd1 && cmd2 2>&1 &"
    // Find opening quote to exclude closing quote from beforeQuote (needed for chain regex)
    let openQuotePos = -1;
    for (let i = 0; i < sshPart.length; i++) {
        if (sshPart[i] === "'" || sshPart[i] === '"') {
            openQuotePos = i;
            break;
        }
    }
    if (openQuotePos < 0) return command;
    // Exclude closing quote so chain regex can match the & that precedes it
    const remoteCmdEnd2 = findClosingQuotePosExcl(sshPart);
    const beforeQuote = sshPart.slice(0, remoteCmdEnd2);
    // Chain with 2>&1 redirect first (&& chains only — `;` chains inside quotes
    // are left alone per contract: SSH completes normally for them)
    const chainMatch2 = beforeQuote.match(/(.+?)&&\s*(.+?)\s+(2>&1)\s*&\s*$/);
    if (chainMatch2) {
        return (
            beforeSsh +
            chainMatch2[1] +
            "&&" +
            ` nohup ${chainMatch2[2]} ${chainMatch2[3]} & echo 'SSH_DETACHED'"`
        );
    }
    // Chain without 2>&1
    const chainMatch = beforeQuote.match(/(.+?)&&\s*(.+?)\s*&\s*$/);
    if (chainMatch) {
        return (
            beforeSsh +
            chainMatch[1] +
            "&&" +
            ` nohup ${chainMatch[2]} > ${logFile} 2>&1 & echo 'SSH_DETACHED'"`
        );
    }
    return command;
}
export function detectSsh(command) {
    const ssh = isSshCommand(command);
    const detached = ssh ? isDetachedPattern(command) : false;
    const bare = ssh ? hasBareAmpersand(command) : false;
    const needsTimeout = ssh ? isForegroundDaemonSsh(command) : false;
    let suggestion = "";
    if (ssh && !detached && bare) {
        suggestion =
            "Warning: trailing '&' outside quotes backgrounds SSH itself. Use nohup ... > /tmp/log 2>&1 & echo DONE.";
    } else if (needsTimeout) {
        suggestion = `Warning: foreground SSH running a long-lived remote command. Auto-wrapped with timeout ${getDefaultSshTimeoutSeconds()}s (set PI_HARNESS_SSH_TIMEOUT_S to change).`;
    }
    return {
        isSsh: ssh,
        isDetached: detached,
        hasBareAmpersand: bare,
        needsTimeoutGuard: needsTimeout,
        suggestion,
    };
}
// --- Foreground daemon-over-SSH timeout guard ---------------------------------
//
// Problem: `ssh -tt host "python -m worker --video | head -10"` runs a poller
// daemon in the foreground. head -10 exits, the daemon swallows BrokenPipeError
// and keeps ticking; ssh -tt holds the session until the whole remote pipeline
// ends — which never happens. Observed: 1911.9s hang until manual abort.
//
// Solution: detect daemon-ish remote payloads without any timeout protection
// and prefix the ssh invocation with `timeout Ns` so the local side is always
// guaranteed to return.
/** Long-running remote command patterns (pollers, servers, watchers). */
const REMOTE_DAEMON_PATTERNS = [
    /\buvicorn\b/,
    /\bgunicorn\b/,
    /\bcelery\b/,
    /\bflask\s+run\b/,
    /\btail\s+-f\b/,
    /\bnpm\s+(run\s+)?(dev|start)\b/,
    /\bbun\s+(run\s+)?(dev|start)\b/,
    /\byarn\s+(dev|start)\b/,
    /\bnode\s+\S*(server|daemon)\S*/,
    /--watch(\s|=)/,
    /\bpython3?\s+-m\s+\S*(worker|daemon|server|bot|poller|scheduler|agent)\S*/,
    /\buv\s+run\s+\S*(worker|daemon|server|bot|poller|scheduler|agent)\S*/,
];
export function getDefaultSshTimeoutSeconds() {
    const raw = process.env.PI_HARNESS_SSH_TIMEOUT_S;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}
/**
 * Extract the remote command payload of an ssh invocation (the quoted
 * argument). Falls back to the whole ssh segment when unquoted.
 */
function extractRemotePayload(sshPart) {
    const m = sshPart.match(/["'](.+)["']/s);
    return m ? m[1] : sshPart;
}
/**
 * The ssh flag segment: everything before the quoted remote command.
 * Used for host-side flag checks (-f, -o, ...) so that remote payload args
 * like `tail -f` are not mistaken for ssh flags.
 */
function getSshFlagSegment(sshPart) {
    const quotePos = sshPart.search(/["']/);
    return quotePos >= 0 ? sshPart.slice(0, quotePos) : sshPart;
}
/**
 * Check if an SSH command runs a daemon-ish remote command in the
 * foreground with no timeout protection anywhere (local or remote).
 *
 * RISKY:  ssh -tt host "cd app && python -m amos_worker --video 2>&1 | head -10"
 * SAFE:   timeout 60s ssh host "python -m amos_worker --video"
 * SAFE:   ssh host "timeout 30 python -m amos_worker --video"
 * SAFE:   ssh host "nohup python -m amos_worker ... &" (detached patterns)
 * SAFE:   ssh -f host "..." (ssh backgrounds itself)
 */
export function isForegroundDaemonSsh(command) {
    if (!isSshCommand(command)) return false;
    if (isDetachedPattern(command)) return false;
    if (hasBareAmpersand(command)) return false; // handled by detach transform
    if (/\bnohup\b/.test(command)) return false;
    const range = findLastSshCommand(command);
    if (!range) return false;
    const sshPart = command.slice(range.start, range.end);
    // ssh -f: requests ssh itself to go to background before executing.
    // Only inspect the flag segment — `tail -f` in the remote payload is NOT ssh -f.
    const flagSegment = getSshFlagSegment(sshPart);
    if (/(^|\s)-f(\s|$)/.test(flagSegment)) return false;
    // Any timeout guard (local `timeout Ns ssh` or remote `timeout N cmd`)
    if (/\btimeout\b/.test(command)) return false;
    const payload = extractRemotePayload(sshPart);
    // Remote-side backgrounding (`... &` inside quotes): SSH completes when the
    // remote shell returns — per project convention this is the safe pattern.
    if (/&\s*$/.test(payload.trim())) return false;
    return REMOTE_DAEMON_PATTERNS.some((re) => re.test(payload));
}
/**
 * Prefix the last ssh invocation with `timeout Ns` so the local bash call is
 * guaranteed to return even if the remote daemon never exits.
 *
 * Before: echo 'x' | ssh -tt host "python -m amos_worker --video | head -10"
 * After:  echo 'x' | timeout 300s ssh -tt host "python -m amos_worker --video | head -10"
 */
export function addSshTimeoutGuard(
    command,
    seconds = getDefaultSshTimeoutSeconds(),
) {
    if (!Number.isFinite(seconds) || seconds <= 0) return command;
    const range = findLastSshCommand(command);
    if (!range) return command;
    return (
        command.slice(0, range.start) +
        `timeout ${seconds}s ` +
        command.slice(range.start)
    );
}
//# sourceMappingURL=ssh-detach-interceptor.js.map
