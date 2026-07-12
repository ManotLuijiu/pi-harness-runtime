/**
 * E2E Test Engine — RFC-0013
 *
 * Browser-based end-to-end testing before work is marked ready for client.
 *
 * Artifact Layout:
 *   harness/e2e/
 *     scenarios/
 *     test-data/
 *     reports/
 *     artifacts/screenshots/
 *     artifacts/traces/
 *     artifacts/videos/
 */

import type {
	E2EScenario,
	E2EStep,
	E2EResult,
	E2EReport,
} from "../../packages/types/src/runtime-types.js";
import { writeJson, appendJsonl } from "../../cli.js";
import { join } from "node:path";

// Re-export from playwright-runner for backwards compatibility
export type { E2ERunner as PlaywrightRunner } from "./playwright-runner.js";

// Also import locally for use in this file
import type { E2ERunner } from "./playwright-runner.js";

export interface E2EConfig {
	baseUrl: string;
	headless?: boolean;
	screenshotOnFailure?: boolean;
	videoOnFailure?: boolean;
	traceOnFailure?: boolean;
	timeout?: number;
}

export class E2ETestEngine {
	private readonly rootDir: string;
	private readonly config: E2EConfig;
	private runner: E2ERunner | null = null;

	constructor(rootDir: string, config: E2EConfig) {
		this.rootDir = rootDir;
		this.config = {
			headless: true,
			screenshotOnFailure: true,
			videoOnFailure: false,
			traceOnFailure: false,
			timeout: 30000,
			...config,
		};
	}

	/**
	 * Set the Playwright runner
	 */
	setRunner(runner: E2ERunner): void {
		this.runner = runner;
	}

	/**
	 * Run a single E2E scenario
	 */
	async runScenario(
		scenario: E2EScenario,
		context?: Record<string, unknown>,
	): Promise<E2EResult> {
		if (!this.runner) {
			return this.createErrorResult(scenario.id, "No runner configured");
		}

		const startTime = Date.now();
		let stepsExecuted = 0;
		let stepsPassed = 0;
		let stepsFailed = 0;
		let screenshotPath: string | undefined;
		let failedStep: number | undefined;

		try {
			for (let i = 0; i < scenario.steps.length; i++) {
				const step = scenario.steps[i];
				stepsExecuted++;

				try {
					const success = await this.executeStep(step, context);
					if (success) {
						stepsPassed++;
					} else {
						stepsFailed++;
						failedStep = i;
						if (this.config.screenshotOnFailure) {
							screenshotPath = await this.captureScreenshot(scenario.id, i);
						}
						break; // Stop on first failure
					}
				} catch (error) {
					stepsFailed++;
					failedStep = i;
					if (this.config.screenshotOnFailure) {
						screenshotPath = await this.captureScreenshot(scenario.id, i);
					}
					break;
				}
			}

			const duration = Date.now() - startTime;

			return {
				scenarioId: scenario.id,
				status: stepsFailed > 0 ? "failed" : "passed",
				duration,
				stepsExecuted,
				stepsPassed,
				stepsFailed,
				screenshotPath,
				executedAt: new Date().toISOString(),
				failedStep,
			};
		} catch (error) {
			return this.createErrorResult(scenario.id, String(error));
		}
	}

	/**
	 * Run all scenarios for a job
	 */
	async runAllScenarios(
		jobId: string,
		scenarios: E2EScenario[],
		context?: Record<string, unknown>,
	): Promise<E2EReport> {
		const results: E2EResult[] = [];
		let totalDuration = 0;

		for (const scenario of scenarios) {
			if (!scenario.required) {
				// Skip non-required scenarios on failure of required ones
				const result = await this.runScenario(scenario, context);
				results.push(result);
				totalDuration += result.duration;
			} else {
				const result = await this.runScenario(scenario, context);
				results.push(result);
				totalDuration += result.duration;

				// Stop on first required failure
				if (result.status === "failed") {
					// Run remaining non-required scenarios
					for (const nextScenario of scenarios.slice(
						scenarios.indexOf(scenario) + 1,
					)) {
						if (!nextScenario.required) {
							const nextResult = await this.runScenario(nextScenario, context);
							results.push(nextResult);
							totalDuration += nextResult.duration;
						}
					}
					break;
				}
			}
		}

		const report: E2EReport = {
			jobId,
			scenarios,
			results,
			summary: {
				total: results.length,
				passed: results.filter((r) => r.status === "passed").length,
				failed: results.filter((r) => r.status === "failed").length,
				skipped: results.filter((r) => r.status === "skipped").length,
				duration: totalDuration,
			},
			createdAt: new Date().toISOString(),
		};

		// Save report
		this.saveReport(report);

		return report;
	}

	/**
	 * Create a scenario from a natural language description
	 */
	createScenario(
		id: string,
		name: string,
		description: string,
		required: boolean = true,
	): E2EScenario {
		return {
			id,
			name,
			description,
			steps: [],
			required,
		};
	}

	/**
	 * Add a step to a scenario
	 */
	addStep(
		scenario: E2EScenario,
		action: E2EStep["action"],
		options?: Partial<E2EStep>,
	): void {
		scenario.steps.push({
			action,
			selector: options?.selector,
			value: options?.value,
			timeout: options?.timeout,
			assertCondition: options?.assertCondition,
		});
	}

	/**
	 * Execute a single step
	 */
	private async executeStep(
		step: E2EStep,
		context?: Record<string, unknown>,
	): Promise<boolean> {
		if (!this.runner) return false;

		const timeout = step.timeout ?? this.config.timeout ?? 30000;

		switch (step.action) {
			case "navigate":
				await this.runner.navigate(
					this.resolveValue(step.value ?? "", context),
				);
				return true;

			case "click":
				await this.runner.wait(step.selector!, timeout);
				await this.runner.click(step.selector!);
				return true;

			case "type":
				await this.runner.wait(step.selector!, timeout);
				await this.runner.type(
					step.selector!,
					this.resolveValue(step.value ?? "", context),
				);
				return true;

			case "wait":
				await this.runner.wait(step.selector!, timeout);
				return true;

			case "screenshot": {
				const path = this.resolveValue(step.value ?? "screenshot.png", context);
				await this.runner.screenshot(path);
				return true;
			}

			case "assert":
				return await this.runner.assert(
					step.assertCondition ?? "true",
					`Assertion failed: ${step.assertCondition}`,
				);

			case "hover":
				await this.runner.wait(step.selector!, timeout);
				// await this.runner.hover(step.selector!);
				return true;

			case "select":
				await this.runner.wait(step.selector!, timeout);
				// await this.runner.select(step.selector!, step.value!);
				return true;

			case "upload":
				await this.runner.wait(step.selector!, timeout);
				// await this.runner.upload(step.selector!, step.value!);
				return true;

			default:
				console.warn(`Unknown step action: ${step.action}`);
				return false;
		}
	}

	/**
	 * Capture screenshot
	 */
	private async captureScreenshot(
		scenarioId: string,
		stepIndex: number,
	): Promise<string> {
		const path = join(
			this.rootDir,
			"harness",
			"e2e",
			"artifacts",
			"screenshots",
			`${scenarioId}-step-${stepIndex}.png`,
		);
		if (this.runner) {
			await this.runner.screenshot(path);
		}
		return path;
	}

	/**
	 * Create error result
	 */
	private createErrorResult(scenarioId: string, error: string): E2EResult {
		return {
			scenarioId,
			status: "error",
			duration: 0,
			stepsExecuted: 0,
			stepsPassed: 0,
			stepsFailed: 0,
			errorMessage: error,
			executedAt: new Date().toISOString(),
		};
	}

	/**
	 * Save report to file
	 */
	private saveReport(report: E2EReport): void {
		const reportPath = join(
			this.rootDir,
			"harness",
			"e2e",
			"reports",
			`${report.jobId}-${Date.now()}.json`,
		);
		writeJson(reportPath, report);

		// Also append to a log
		const logPath = join(
			this.rootDir,
			"harness",
			"e2e",
			"reports",
			`${report.jobId}.jsonl`,
		);
		appendJsonl(logPath, report);
	}

	/**
	 * Resolve variables in values
	 */
	private resolveValue(
		value: string,
		context?: Record<string, unknown>,
	): string {
		if (!context) return value;
		let result = value;
		for (const [key, val] of Object.entries(context)) {
			result = result.replace(new RegExp(`{{${key}}}`, "g"), String(val));
		}
		return result;
	}

	/**
	 * Load scenarios from directory
	 */
	loadScenarios(_scenariosDir: string): E2EScenario[] {
		// In practice, this would read from the scenarios directory
		return [];
	}
}

/**
 * Default E2E steps for common workflows
 */
export const CommonSteps = {
	login: (username: string, password: string): E2EStep[] => [
		{ action: "navigate", value: "/login" },
		{ action: "type", selector: "#username", value: username },
		{ action: "type", selector: "#password", value: password },
		{ action: "click", selector: 'button[type="submit"]' },
		{ action: "wait", selector: ".dashboard", timeout: 10000 },
	],

	logout: (): E2EStep[] => [
		{ action: "click", selector: ".user-menu" },
		{ action: "click", selector: 'a[href="/logout"]' },
	],

	fillForm: (fields: Record<string, string>): E2EStep[] => {
		const steps: E2EStep[] = [];
		for (const [selector, value] of Object.entries(fields)) {
			steps.push({ action: "type", selector, value });
		}
		return steps;
	},
};
