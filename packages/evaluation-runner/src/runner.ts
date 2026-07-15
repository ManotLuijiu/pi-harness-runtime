/**
 * Evaluation Runner — Core (RFC-0020)
 */

import type {
	EvaluationCase,
	EvaluationConfig,
	EvaluationInput,
	EvaluatorFn,
	EvaluationReport,
	EvaluationResult,
	EvaluationSuite,
} from "./types.js";

let _runCounter = 0;
function nextRunId(): string {
	return `run-${Date.now()}-${++_runCounter}`;
}

export class EvaluationRunner {
	private evaluators = new Map<string, EvaluatorFn>();
	private config: Required<EvaluationConfig>;

	constructor(config: EvaluationConfig = {}) {
		this.config = {
			timeoutMs: config.timeoutMs ?? 30_000,
			retries: config.retries ?? 1,
			parallel: config.parallel ?? false,
		};
	}

	registerEvaluator(name: string, fn: EvaluatorFn): void {
		this.evaluators.set(name, fn);
	}

	async runSuite(
		suite: EvaluationSuite,
		execute: (input: EvaluationInput) => Promise<string>,
	): Promise<EvaluationReport> {
		const results: EvaluationResult[] = [];
		const cases = suite.cases;

		if (this.config.parallel) {
			const promises = cases.map((c) => this.runCase(c, execute));
			const all = await Promise.allSettled(promises);
			for (const r of all) {
				if (r.status === "fulfilled") results.push(...r.value);
			}
		} else {
			for (const c of cases) {
				const r = await this.runCase(c, execute);
				results.push(...r);
			}
		}

		const passed = results.filter((r) => r.passed).length;
		const summary: EvaluationReport["summary"] = {};

		for (const r of results) {
			if (!summary[r.metric]) {
				summary[r.metric] = { count: 0, avgScore: 0 };
			}
			const s = summary[r.metric];
			s.count++;
			s.avgScore = (s.avgScore * (s.count - 1) + r.score) / s.count;
		}

		return {
			suiteId: suite.id,
			runAt: new Date().toISOString(),
			total: results.length,
			passed,
			failed: results.length - passed,
			results,
			summary,
		};
	}

	private async runCase(
		c: EvaluationCase,
		execute: (input: EvaluationInput) => Promise<string>,
	): Promise<EvaluationResult[]> {
		const start = Date.now();
		let output: string;
		try {
			output = await Promise.race([
				execute(c.input),
				new Promise<string>((_, reject) =>
					setTimeout(() => reject(new Error("timeout")), this.config.timeoutMs),
				),
			]);
		} catch (err) {
			return c.evaluators.map((name) => ({
				runId: nextRunId(),
				metric: name,
				score: 0,
				passed: false,
				details: err instanceof Error ? err.message : "unknown error",
				latencyMs: Date.now() - start,
			}));
		}

		const results: EvaluationResult[] = [];
		for (const name of c.evaluators) {
			const fn = this.evaluators.get(name);
			if (!fn) {
				results.push({
					runId: nextRunId(),
					metric: name,
					score: 0,
					passed: false,
					details: `Evaluator not registered: ${name}`,
					latencyMs: Date.now() - start,
				});
				continue;
			}

			for (let attempt = 0; attempt < this.config.retries; attempt++) {
				try {
					const r = await fn(c.input, output);
					results.push(r);
					break;
				} catch (err) {
					if (attempt === this.config.retries - 1) {
						results.push({
							runId: nextRunId(),
							metric: name,
							score: 0,
							passed: false,
							details: err instanceof Error ? err.message : "unknown error",
							latencyMs: Date.now() - start,
						});
					}
				}
			}
		}
		return results;
	}

	listEvaluators(): string[] {
		return [...this.evaluators.keys()];
	}
}

// Built-in evaluators
export const exactMatchEvaluator: EvaluatorFn = async (input, output) => {
	const expected = input.expectedOutput ?? "";
	return {
		runId: nextRunId(),
		metric: "exact-match",
		score: output === expected ? 1 : 0,
		passed: output === expected,
		details: output === expected ? "exact match" : "output differs from expected",
	};
};

export const substringMatchEvaluator: EvaluatorFn = async (input, output) => {
	const expected = input.expectedOutput ?? "";
	const found = expected.length > 0 && output.includes(expected);
	return {
		runId: nextRunId(),
		metric: "substring-match",
		score: found ? 1 : 0,
		passed: found,
		details: found ? "expected substring found" : "expected substring not found",
	};
};

export const lengthEvaluator: EvaluatorFn = async (input, output) => {
	const min = (input.metadata?.["minLength"] as number) ?? 0;
	const max = (input.metadata?.["maxLength"] as number) ?? Infinity;
	const len = output.length;
	const passed = len >= min && len <= max;
	const score = passed ? 1 : Math.max(0, 1 - Math.abs(len - (min + max) / 2) / max);
	return {
		runId: nextRunId(),
		metric: "length-check",
		score,
		passed,
		details: `length ${len}, expected ${min}-${max}`,
	};
};
