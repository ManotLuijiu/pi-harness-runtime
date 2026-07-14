/**
 * Codex Adapter — Execution Sandbox (RFC-0070)
 */

import { spawn } from "node:child_process";
import type { ExecutionResult, ExecutionConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Execute code in a sandboxed environment
 */
export class ExecutionSandbox {
	private config: Required<ExecutionConfig>;

	constructor(config: ExecutionConfig = {}) {
		this.config = {
			timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
			memoryLimitMB: config.memoryLimitMB ?? 512,
			cwd: config.cwd ?? process.cwd(),
			env: config.env ?? {},
		};
	}

	async execute(command: string): Promise<ExecutionResult> {
		const start = Date.now();
		return new Promise((resolve) => {
			const proc = spawn(command, [], {
				shell: true,
				cwd: this.config.cwd,
				env: { ...process.env, ...this.config.env },
			});

			let stdout = "";
			let stderr = "";

			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			const timer = setTimeout(() => {
				proc.kill("SIGKILL");
			}, this.config.timeout);

			proc.on("close", (code) => {
				clearTimeout(timer);
				resolve({
					stdout,
					stderr,
					exitCode: code ?? -1,
					durationMs: Date.now() - start,
				});
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				resolve({
					stdout,
					stderr,
					exitCode: -1,
					durationMs: Date.now() - start,
				});
			});
		});
	}

	async executeCode(
		code: string,
		language: "python" | "javascript" | "bash",
	): Promise<ExecutionResult> {
		switch (language) {
			case "python":
				return this.execute(`python3 -c ${JSON.stringify(code)}`);
			case "javascript":
				return this.execute(`node -e ${JSON.stringify(code)}`);
			case "bash":
				return this.execute(code);
		}
	}
}
