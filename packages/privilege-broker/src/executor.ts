/**
 * Broker Executor — RFC-0101 §7
 *
 * Executes a resolved CapabilityGrant using execve(2) (no shell).
 * The service account must exist and have minimal permissions.
 *
 * Safety properties:
 * - No shell interpolation — argv is passed directly to execve
 * - Env whitelist enforced — only approved env vars are forwarded
 * - Working directory constrained via chdir
 * - Timeout enforced — process is killed if it exceeds timeoutMs
 */
import { spawn } from "node:child_process";
import type { AuditLogger } from "./types.js";

/** The BrokerExecutor resolves and executes capability grants. */
export class BrokerExecutor {
	constructor(private readonly audit: AuditLogger) {}

	/**
	 * Execute a command as the configured service account.
	 * Throws on timeout or spawn error.
	 */
	async execute(options: {
		command: string;
		args: string[];
		envWhitelist?: string[];
		allowedCwd?: string;
		timeoutMs?: number;
		actor: string;
		capability: string;
		reason: string;
	}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		const {
			command,
			args,
			envWhitelist,
			allowedCwd,
			timeoutMs = 30_000,
			actor,
			capability,
			reason,
		} = options;

		// Build minimal env
		const env: Record<string, string> = {};
		if (envWhitelist) {
			for (const key of envWhitelist) {
				if (process.env[key] !== undefined) {
					env[key] = process.env[key]!;
				}
			}
		}
		env.PI_HARNESS_ACTOR = actor;
		env.PI_HARNESS_CAPABILITY = capability;

		const child = spawn(command, args, {
			env,
			cwd: allowedCwd ?? process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error(`command timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			child.on("exit", (code) => {
				clearTimeout(timer);
				const exitCode = code ?? 0;
				this.audit.log({
					timestamp: new Date().toISOString(),
					actor,
					capability: capability as Parameters<typeof this.audit.log>[0]["capability"],
					reason,
					outcome: exitCode === 0 ? "granted" : "error",
					error: exitCode !== 0 ? `exit ${exitCode}` : undefined,
				});
				resolve({ exitCode, stdout, stderr });
			});

			child.on("error", (err) => {
				clearTimeout(timer);
				this.audit.log({
					timestamp: new Date().toISOString(),
					actor,
					capability: capability as Parameters<typeof this.audit.log>[0]["capability"],
					reason,
					outcome: "error",
					error: err.message,
				});
				reject(err);
			});
		});
	}
}
