/**
 * E2E Test Engine — RFC-0013
 *
 * Browser-based end-to-end testing before work is marked ready for client.
 *
 * @example
 * ```typescript
 * import { E2ETestEngine, PlaywrightE2ERunner } from "./e2e/index.js";
 *
 * const runner = new PlaywrightE2ERunner({ headless: true });
 * await runner.start();
 *
 * const engine = new E2ETestEngine("/tmp/e2e", {
 *   baseUrl: "http://localhost:3000",
 *   screenshotOnFailure: true,
 * });
 * engine.setRunner(runner);
 *
 * const scenario = engine.createScenario(
 *   "homepage-loads",
 *   "Homepage Loads",
 *   "Verify the homepage loads correctly",
 * );
 * engine.addStep(scenario, "navigate", { value: "http://localhost:3000" });
 * engine.addStep(scenario, "wait", { selector: "h1" });
 * engine.addStep(scenario, "assert", { assertCondition: "document.querySelector('h1') !== null" });
 *
 * const result = await engine.runScenario(scenario);
 * console.log(result);
 *
 * await runner.stop();
 * ```
 */

export { E2ETestEngine } from "./test-engine.js";
export {
	PlaywrightE2ERunner,
	MiniMaxQuotaScraper,
} from "./playwright-runner.js";
export type {
	E2ERunner,
	PlaywrightRunnerConfig,
	QuotaPageData,
} from "./playwright-runner.js";
