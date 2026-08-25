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

import { execSync, exec } from "child_process";
import { setTimeout as setAsyncTimeout, clearTimeout } from "timers";

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
const HANG_THRESHOLD_MS = 60_000; // 1 minute = likely hang

/**
 * Sanitize input for shell commands - prevent command injection
 */

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

	const sshBase = `ssh -o BatchMode=yes -o ConnectTimeout=30 -o StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"} ${user}@${host}`;

	let retries = 0;
	let hungProcessesKilled = false;

	while (retries <= maxRetries) {
		const startTime = Date.now();

		try {
			// Execute with timeout
			const result = await execAsync(
				`${sshBase} '${command.replace(/'/g, "'\\''")}'`,
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
		`pkill -f "ssh.*${host}" || true`,
		// Kill stuck PM2 commands
		`pkill -f "pm2.*amos-saas" || true`,
		// Kill stuck sudo commands
		`pkill -f "sudo.*pm2" || true`,
	];

	for (const cmd of killCommands) {
		try {
			execSync(
				`ssh -o BatchMode=yes -o ConnectTimeout=10 ${user}@${host} '${cmd}'`,
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
		execSync(`pkill -f "ssh.*${host}" || true`, { timeout: 5000 });
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
		execSync(
			`ssh -o BatchMode=yes -o ConnectTimeout=5 ${user}@${host} 'echo ok'`,
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
	const command = `PM2_HOME=/home/frappe/.pm2 ${pm2Cmd} status`;

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
	const command = `PM2_HOME=/home/frappe/.pm2 pm2 restart ${app}`;

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
			resolve({ exitCode: code ?? 0, stdout: (proc.stdout || '').toString(), stderr: (proc.stderr || '').toString() });
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}
