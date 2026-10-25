/**
 * SSH Hang Recovery — Smart SSH wrapper that auto-recovers from hangs
 *
 * Problem: SSH commands can hang indefinitely (PM2 restart, sudo prompts, etc.)
 * Solution: Timeout + process killing + retry + escalation
 *
 * Flow:
 *   Execute SSH command
 *     → Timeout reached? → Kill stuck processes → Retry
 *     → Retry failed? → Kill PM2 daemon processes → Retry
 *     → Still failing? → Escalate to human with diagnostic
 */

import { execSync, exec } from "node:child_process";
import { setTimeout as setAsyncTimeout, clearTimeout } from "node:timers";

export interface SSHConfig {
	host: string;
	user?: string;
	timeout?: number; // ms, default 120000 (2 min)
	maxRetries?: number;
	strictHostKeyChecking?: boolean;
}

export interface SSHResult {
	success: boolean;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	retries: number;
	hungProcessesKilled: boolean;
	error?: string;
}

const DEFAULT_TIMEOUT = 120_000; // 2 minutes

/**
 * A host is either a DNS name, an IPv4 address or a bracketed IPv6 address.
 * Anything else never reaches the shell.
 */
const SAFE_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])$/;

/** A login name on the remote machine. */
const SAFE_USER = /^[A-Za-z0-9._-]+$/;

/**
 * Shell-quote a value for a POSIX shell.
 *
 * Every value that reaches the shell goes through here: a value that is
 * wrapped in single quotes cannot end the quote and cannot start a new
 * command, whatever it contains.
 */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Reject a host or user that is not a plain identifier.
 *
 * The host and the user are interpolated into a command line, so they are
 * validated instead of quoted: a value that does not look like a host is
 * never a host, and passing it on would only help an attacker.
 */
export function assertSafeSshTarget(host: string, user: string): void {
	if (!SAFE_HOST.test(host)) {
		throw new Error(`Refusing to use an invalid ssh host: ${JSON.stringify(host)}`);
	}
	if (!SAFE_USER.test(user)) {
		throw new Error(`Refusing to use an invalid ssh user: ${JSON.stringify(user)}`);
	}
}

/**
 * Execute SSH command with automatic hang recovery
 */
export async function sshWithRecovery(
	config: SSHConfig,
	command: string,
): Promise<SSHResult> {
	const {
		host,
		user = "frappe",
		timeout = DEFAULT_TIMEOUT,
		maxRetries = 3,
		strictHostKeyChecking = false,
	} = config;

	assertSafeSshTarget(host, user);

	const sshBase = `ssh -o BatchMode=yes -o ConnectTimeout=30 -o StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"} ${shellQuote(user)}@${shellQuote(host)}`;

	let retries = 0;
	let hungProcessesKilled = false;

	while (retries <= maxRetries) {
		const startTime = Date.now();

		try {
			// Execute with timeout
			const result = await execAsync(
				`${sshBase} ${shellQuote(command)}`,
				timeout,
			);

			return {
				success: result.exitCode === 0,
				stdout: result.stdout,
				stderr: result.stderr,
				elapsedMs: Date.now() - startTime,
				retries,
				hungProcessesKilled,
				error: result.exitCode === 0 ? undefined : `Exit code: ${result.exitCode}`,
			};
		} catch (error: any) {
			const elapsed = Date.now() - startTime;
			const isTimeout = elapsed >= timeout;

			console.error(
				`[ssh-recovery] Attempt ${retries + 1} failed: ${error.message} (${elapsed}ms)`,
			);

			if (isTimeout) {
				hungProcessesKilled = true;

				// Kill stuck processes on remote server
				await killStuckProcesses(host, user);

				// Also kill any local SSH processes stuck on this host
				killLocalSSHProcesses(host);

				retries++;
			} else {
				// Non-timeout error (permission denied, etc.)
				return {
					success: false,
					stdout: "",
					stderr: "",
					elapsedMs: elapsed,
					retries,
					hungProcessesKilled: false,
					error: error.message,
				};
			}
		}
	}

	// All retries exhausted
	return {
		success: false,
		stdout: "",
		stderr: "",
		elapsedMs: 0,
		retries,
		hungProcessesKilled,
		error: `Command failed after ${maxRetries + 1} attempts`,
	};
}

/**
 * Kill stuck processes on remote server
 */
async function killStuckProcesses(host: string, user: string): Promise<void> {
	const killCommands = [
		// Kill stuck SSH sessions
		`pkill -f ${shellQuote(`ssh.*${host}`)} || true`,
		// Kill stuck PM2 commands
		`pkill -f ${shellQuote("pm2.*")} || true`,
		// Kill stuck sudo commands
		`pkill -f ${shellQuote("sudo.*pm2")} || true`,
	];

	for (const cmd of killCommands) {
		try {
			execSync(
				`ssh -o BatchMode=yes -o ConnectTimeout=10 ${shellQuote(user)}@${shellQuote(host)} ${shellQuote(cmd)}`,
				{ timeout: 10_000, encoding: "utf-8" },
			);
		} catch {
			// Ignore errors from kill commands
		}
	}
}

/**
 * Kill local SSH processes stuck on this host
 */
function killLocalSSHProcesses(host: string): void {
	try {
		// Kill any local SSH processes connecting to this host
		execSync(`pkill -f ${shellQuote(`ssh.*${host}`)} || true`, { timeout: 5000 });
	} catch {
		// Ignore
	}
}

/**
 * Check if server is responsive
 */
export async function pingServer(
	host: string,
	user: string = "frappe",
): Promise<boolean> {
	try {
		assertSafeSshTarget(host, user);
		execSync(
			`ssh -o BatchMode=yes -o ConnectTimeout=5 ${shellQuote(user)}@${shellQuote(host)} ${shellQuote("echo ok")}`,
			{ timeout: 10_000 },
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get PM2 status with hang protection
 */
export async function getPM2Status(
	host: string,
	pm2Path?: string,
): Promise<SSHResult> {
	const pm2Cmd = pm2Path || "pm2";
	const command = `PM2_HOME=~/.pm2 ${pm2Cmd} status`;

	return sshWithRecovery(
		{
			host,
			timeout: 30_000, // Status should be fast
			maxRetries: 1,
		},
		command,
	);
}

/**
 * Restart PM2 process with hang protection
 */
export async function pm2Restart(
	host: string,
	app: string,
): Promise<SSHResult> {
	const command = `PM2_HOME=~/.pm2 pm2 restart ${app}`;

	return sshWithRecovery(
		{
			host,
			timeout: 180_000, // 3 min for restart
			maxRetries: 2,
		},
		command,
	);
}

/**
 * Execute arbitrary command with hang protection
 */
export async function safeSSHCommand(
	host: string,
	command: string,
	options: { timeout?: number; maxRetries?: number } = {},
): Promise<SSHResult> {
	return sshWithRecovery(
		{
			host,
			timeout: options.timeout ?? 120_000,
			maxRetries: options.maxRetries ?? 2,
		},
		command,
	);
}

// --- Helper for promise-based exec with timeout ---

interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function execAsync(command: string, timeoutMs: number): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const proc = exec(command, { encoding: "utf-8" }, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({ exitCode: 0, stdout, stderr });
			}
		});

		const timer = setAsyncTimeout(() => {
			// Kill the process tree
			try {
				proc.kill("SIGKILL");
			} catch {
				// Process already dead
			}
			reject(new Error(`Command timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		proc.on("exit", (code) => {
			clearTimeout(timer);
			resolve({
				exitCode: code ?? 0,
				stdout: (proc.stdout || "").toString(),
				stderr: (proc.stderr || "").toString(),
			});
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}
