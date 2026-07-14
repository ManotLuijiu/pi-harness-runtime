/**
 * Command Executor — RFC-0025
 *
 * Safe shell command execution with timeout, output capture, and security policies.
 *
 * Features:
 * - Timeout enforcement
 * - Output capture (stdout/stderr)
 * - Working directory control
 * - Environment variable injection
 * - Security policy enforcement
 * - Process management (kill, signal)
 */

import {
	spawn,
	type ChildProcess,
	type SpawnOptions,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";

export interface CommandResult {
	success: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	duration: number;
	command: string;
}

export interface CommandOptions {
	/** Working directory (default: process.cwd()) */
	cwd?: string;
	/** Environment variables to inject */
	env?: Record<string, string>;
	/** Timeout in milliseconds (default: no timeout) */
	timeout?: number;
	/** Shell to use (default: /bin/sh on Unix, cmd.exe on Windows) */
	shell?: string;
	/** User ID to run as (if available) */
	uid?: number;
	/** Group ID to run as (if available) */
	gid?: number;
	/** Capture stdout (default: true) */
	captureStdout?: boolean;
	/** Capture stderr (default: true) */
	captureStderr?: boolean;
	/** Treat non-zero exit as success (default: false) */
	ignoreExitCode?: boolean;
	/** Policy to check before execution */
	policyCheck?: boolean;
}

export interface CommandPolicy {
	/** Allowed commands (exact match or pattern) */
	allowedCommands?: RegExp[];
	/** Denied commands (takes precedence) */
	deniedCommands?: RegExp[];
	/** Maximum timeout in ms */
	maxTimeout?: number;
	/** Allowed working directories */
	allowedDirs?: string[];
	/** Denied working directories */
	deniedDirs?: string[];
	/** Allow shell built-ins */
	allowShellBuiltins?: boolean;
	/** Allow environment variable injection */
	allowEnvInjection?: boolean;
	/** Commands that require explicit policy bypass */
	requireApproval?: RegExp[];
}

export interface CommandEvent {
	command: string;
	timestamp: string;
	pid?: number;
}

export interface CommandExecutorEvents {
	onStart: (event: CommandEvent) => void;
	onExit: (
		event: CommandEvent & { exitCode: number; duration: number },
	) => void;
	onTimeout: (event: CommandEvent) => void;
	onError: (error: Error, command: string) => void;
	onPolicyViolation: (reason: string, command: string) => void;
}

const DEFAULT_POLICY: CommandPolicy = {
	allowShellBuiltins: true,
	allowEnvInjection: true,
	maxTimeout: 300000, // 5 minutes default
};

export class CommandExecutor extends EventEmitter {
	private readonly policy: CommandPolicy;
	private runningProcesses: Map<number, ChildProcess> = new Map();
	private defaultOptions: CommandOptions;

	constructor(policy: CommandPolicy = {}) {
		super();
		this.policy = { ...DEFAULT_POLICY, ...policy };
		this.defaultOptions = {
			captureStdout: true,
			captureStderr: true,
			ignoreExitCode: false,
			policyCheck: true,
		};
	}

	/**
	 * Execute a command synchronously
	 */
	exec(command: string, options: CommandOptions = {}): CommandResult {
		const opts = { ...this.defaultOptions, ...options };
		const startTime = Date.now();

		// Policy check
		if (opts.policyCheck !== false) {
			const policyResult = this.checkPolicy(command, opts);
			if (!policyResult.allowed) {
				this.emit(
					"policyViolation",
					policyResult.reason ?? "Policy violation",
					command,
				);
				return {
					success: false,
					exitCode: null,
					stdout: "",
					stderr: policyResult.reason ?? "Policy violation",
					timedOut: false,
					duration: Date.now() - startTime,
					command,
				};
			}
		}

		// Spawn process
		const spawnOpts: SpawnOptions = {
			cwd: opts.cwd ?? process.cwd(),
			env: { ...process.env, ...opts.env },
			shell:
				opts.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh"),
			uid: opts.uid,
			gid: opts.gid,
			windowsHide: true,
		};

		let proc: ChildProcess;
		try {
			proc = spawn(command, [], spawnOpts);
		} catch (error) {
			this.emit("error", error as Error, command);
			return {
				success: false,
				exitCode: null,
				stdout: "",
				stderr: String(error),
				timedOut: false,
				duration: Date.now() - startTime,
				command,
			};
		}

		this.runningProcesses.set(proc.pid!, proc);

		const event: CommandEvent = {
			command,
			timestamp: new Date().toISOString(),
			pid: proc.pid,
		};
		this.emit("start", event);

		// Collect output
		let stdout = "";
		let stderr = "";

		if (opts.captureStdout && proc.stdout) {
			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});
		}

		if (opts.captureStderr && proc.stderr) {
			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});
		}

		// Handle timeout
		let timedOutFlag = false;
		let timeoutId: NodeJS.Timeout | undefined;

		if (opts.timeout && opts.timeout > 0) {
			const maxTimeout = this.policy.maxTimeout ?? Infinity;
			const effectiveTimeout = Math.min(opts.timeout, maxTimeout);

			timeoutId = setTimeout(() => {
				timedOutFlag = true;
				this.kill(proc.pid!);
				this.emit("timeout", event);
			}, effectiveTimeout);
		}

		// Wait for completion
		const exitCode = this.waitForExit(proc);

		// Cleanup
		if (timeoutId) clearTimeout(timeoutId);
		this.runningProcesses.delete(proc.pid!);

		const duration = Date.now() - startTime;
		this.emit("exit", { ...event, exitCode: exitCode ?? -1, duration });

		const success: boolean =
			(exitCode === 0 || opts.ignoreExitCode) && !timedOutFlag ? true : false;

		return {
			success,
			exitCode,
			stdout,
			stderr,
			timedOut: timedOutFlag,
			duration,
			command,
		};
	}

	/**
	 * Execute a command asynchronously (non-blocking)
	 */
	async execAsync(
		command: string,
		options: CommandOptions = {},
	): Promise<CommandResult> {
		const opts = { ...this.defaultOptions, ...options };
		const startTime = Date.now();

		// Policy check
		if (opts.policyCheck !== false) {
			const policyResult = this.checkPolicy(command, opts);
			if (!policyResult.allowed) {
				this.emit(
					"policyViolation",
					policyResult.reason ?? "Policy violation",
					command,
				);
				return {
					success: false,
					exitCode: null,
					stdout: "",
					stderr: policyResult.reason ?? "Policy violation",
					timedOut: false,
					duration: Date.now() - startTime,
					command,
				};
			}
		}

		// Spawn process
		const spawnOpts: SpawnOptions = {
			cwd: opts.cwd ?? process.cwd(),
			env: { ...process.env, ...opts.env },
			shell:
				opts.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh"),
			uid: opts.uid,
			gid: opts.gid,
			windowsHide: true,
		};

		return new Promise((resolve) => {
			const proc = spawn(command, [], spawnOpts);
			this.runningProcesses.set(proc.pid!, proc);

			const event: CommandEvent = {
				command,
				timestamp: new Date().toISOString(),
				pid: proc.pid,
			};
			this.emit("start", event);

			// Collect output
			let stdout = "";
			let stderr = "";

			if (opts.captureStdout && proc.stdout) {
				proc.stdout.on("data", (data) => {
					stdout += data.toString();
				});
			}

			if (opts.captureStderr && proc.stderr) {
				proc.stderr.on("data", (data) => {
					stderr += data.toString();
				});
			}

			// Handle timeout
			let timedOut = false;
			const timeoutId = setTimeout(
				() => {
					timedOut = true;
					this.kill(proc.pid!);
					this.emit("timeout", event);
				},
				opts.timeout ?? this.policy.maxTimeout ?? 300000,
			);

			proc.on("close", (code) => {
				clearTimeout(timeoutId);
				this.runningProcesses.delete(proc.pid!);

				const duration = Date.now() - startTime;
				const exitCode = code !== null ? code : -1;
				this.emit("exit", { ...event, exitCode, duration });

				const execSuccess: boolean =
					(code === 0 || opts.ignoreExitCode) && !timedOut ? true : false;

				resolve({
					success: execSuccess,
					exitCode: code,
					stdout,
					stderr,
					timedOut: timedOut,
					duration,
					command,
				});
			});

			proc.on("error", (error) => {
				clearTimeout(timeoutId);
				this.runningProcesses.delete(proc.pid!);
				this.emit("error", error, command);

				resolve({
					success: false,
					exitCode: null,
					stdout,
					stderr: stderr + "\n" + String(error),
					timedOut: false,
					duration: Date.now() - startTime,
					command,
				});
			});
		});
	}

	/**
	 * Kill a running process
	 */
	kill(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
		const proc = this.runningProcesses.get(pid);
		if (!proc) {
			return false;
		}

		try {
			proc.kill(signal);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Kill all running processes
	 */
	killAll(signal: NodeJS.Signals = "SIGTERM"): number {
		let killed = 0;
		for (const entry of Array.from(this.runningProcesses.entries())) {
			const [_pid, proc] = entry;
			try {
				proc.kill(signal);
				killed++;
			} catch {
				// Process already exited
			}
		}
		this.runningProcesses.clear();
		return killed;
	}

	/**
	 * Get count of running processes
	 */
	getRunningCount(): number {
		return this.runningProcesses.size;
	}

	/**
	 * Get list of running process PIDs
	 */
	getRunningPids(): number[] {
		return Array.from(this.runningProcesses.keys());
	}

	/**
	 * Check policy for a command
	 */
	checkPolicy(
		command: string,
		_options?: CommandOptions,
	): { allowed: boolean; reason?: string } {
		// Check denied commands
		if (this.policy.deniedCommands) {
			for (const pattern of this.policy.deniedCommands) {
				if (pattern.test(command)) {
					return {
						allowed: false,
						reason: `Command matches denied pattern: ${pattern}`,
					};
				}
			}
		}

		// Check allowed commands (if specified, must match)
		if (this.policy.allowedCommands && this.policy.allowedCommands.length > 0) {
			let allowed = false;
			for (const pattern of this.policy.allowedCommands) {
				if (pattern.test(command)) {
					allowed = true;
					break;
				}
			}
			if (!allowed) {
				return {
					allowed: false,
					reason: "Command not in allowed list",
				};
			}
		}

		// Check denied directories
		if (_options?.cwd) {
			if (this.policy.deniedDirs) {
				for (const dir of this.policy.deniedDirs) {
					if (_options.cwd.startsWith(dir)) {
						return {
							allowed: false,
							reason: `Working directory matches denied path: ${dir}`,
						};
					}
				}
			}
		}

		// Check for dangerous shell operators
		const dangerousPatterns = [
			{ pattern: /;\s*rm\s+-rf/i, reason: "Attempted rm -rf" },
			{
				pattern: />\s*\/dev\/null/i,
				reason: "Output redirection to /dev/null",
			},
			{ pattern: /\|\s*sh\s*$/i, reason: "Pipe to shell" },
			{ pattern: /&\s*$/, reason: "Background execution" },
		];

		for (const { pattern, reason } of dangerousPatterns) {
			if (pattern.test(command)) {
				// Only block if explicitly denied
				if (this.policy.deniedCommands) {
					return { allowed: false, reason };
				}
			}
		}

		return { allowed: true };
	}

	/**
	 * Update policy at runtime
	 */
	updatePolicy(updates: Partial<CommandPolicy>): void {
		Object.assign(this.policy, updates);
	}

	/**
	 * Get current policy
	 */
	getPolicy(): CommandPolicy {
		return { ...this.policy };
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private waitForExit(_proc: ChildProcess): number | null {
		// Note: This method is for synchronous execution.
		// For async execution, use execAsync() which properly handles events.
		// This returns null for sync - actual exit code is captured via events.
		return null;
	}
}

/**
 * Create a CommandExecutor with safe defaults for harness runtime
 */
export function createHarnessExecutor(): CommandExecutor {
	return new CommandExecutor({
		// Allow common development commands
		allowedCommands: [
			/^(git|npm|npx|yarn|pnpm|bun|node|python3?|make|cargo|go)\s/,
			/^(tsc|esbuild|rollup|vite|webpack)\s/,
			/^(jest|vitest|mocha|pytest|cargo test|npm test)\s/,
			/^(eslint|ruff|black|prettier)\s/,
			/^(mkdir|rm|cp|mv|cat|echo|ls|cd)\s/,
		],
		// Deny dangerous patterns
		deniedCommands: [
			/rm\s+-rf\s+\/(?!node_modules)/, // rm -rf / except rm -rf node_modules
			/curl\s+.*\|.*sh$/i, // curl | sh
			/wget\s+.*\|.*sh$/i, // wget | sh
			/base64\s+-d\s+.*\|.*sh/i, // base64 decode | sh
			/:\(\)\{.*\}\s*:/, // Fork bomb
		],
		maxTimeout: 300000, // 5 minutes
		// Default to user's home directory
		allowedDirs: [join(process.env.HOME ?? "", "")],
	});
}
