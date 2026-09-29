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
import { writeJson, appendJsonl } from "../../cli.js";
import { join } from "node:path";
export class E2ETestEngine {
    rootDir;
    config;
    runner = null;
    constructor(rootDir, config) {
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
    setRunner(runner) {
        this.runner = runner;
    }
    /**
     * Run a single E2E scenario
     */
    async runScenario(scenario, context) {
        if (!this.runner) {
            return this.createErrorResult(scenario.id, "No runner configured");
        }
        const startTime = Date.now();
        let stepsExecuted = 0;
        let stepsPassed = 0;
        let stepsFailed = 0;
        let screenshotPath;
        let failedStep;
        try {
            for (let i = 0; i < scenario.steps.length; i++) {
                const step = scenario.steps[i];
                stepsExecuted++;
                try {
                    const success = await this.executeStep(step, context);
                    if (success) {
                        stepsPassed++;
                    }
                    else {
                        stepsFailed++;
                        failedStep = i;
                        if (this.config.screenshotOnFailure) {
                            screenshotPath = await this.captureScreenshot(scenario.id, i);
                        }
                        break; // Stop on first failure
                    }
                }
                catch (error) {
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
        }
        catch (error) {
            return this.createErrorResult(scenario.id, String(error));
        }
    }
    /**
     * Run all scenarios for a job
     */
    async runAllScenarios(jobId, scenarios, context) {
        const results = [];
        let totalDuration = 0;
        for (const scenario of scenarios) {
            if (!scenario.required) {
                // Skip non-required scenarios on failure of required ones
                const result = await this.runScenario(scenario, context);
                results.push(result);
                totalDuration += result.duration;
            }
            else {
                const result = await this.runScenario(scenario, context);
                results.push(result);
                totalDuration += result.duration;
                // Stop on first required failure
                if (result.status === "failed") {
                    // Run remaining non-required scenarios
                    for (const nextScenario of scenarios.slice(scenarios.indexOf(scenario) + 1)) {
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
        const report = {
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
    createScenario(id, name, description, required = true) {
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
    addStep(scenario, action, options) {
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
    async executeStep(step, context) {
        if (!this.runner)
            return false;
        const timeout = step.timeout ?? this.config.timeout ?? 30000;
        switch (step.action) {
            case "navigate":
                await this.runner.navigate(this.resolveValue(step.value ?? "", context));
                return true;
            case "click":
                await this.runner.wait(step.selector, timeout);
                await this.runner.click(step.selector);
                return true;
            case "type":
                await this.runner.wait(step.selector, timeout);
                await this.runner.type(step.selector, this.resolveValue(step.value ?? "", context));
                return true;
            case "wait":
                await this.runner.wait(step.selector, timeout);
                return true;
            case "screenshot": {
                const path = this.resolveValue(step.value ?? "screenshot.png", context);
                await this.runner.screenshot(path);
                return true;
            }
            case "assert":
                return await this.runner.assert(step.assertCondition ?? "true", `Assertion failed: ${step.assertCondition}`);
            case "hover":
                await this.runner.wait(step.selector, timeout);
                // await this.runner.hover(step.selector!);
                return true;
            case "select":
                await this.runner.wait(step.selector, timeout);
                // await this.runner.select(step.selector!, step.value!);
                return true;
            case "upload":
                await this.runner.wait(step.selector, timeout);
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
    async captureScreenshot(scenarioId, stepIndex) {
        const path = join(this.rootDir, "harness", "e2e", "artifacts", "screenshots", `${scenarioId}-step-${stepIndex}.png`);
        if (this.runner) {
            await this.runner.screenshot(path);
        }
        return path;
    }
    /**
     * Create error result
     */
    createErrorResult(scenarioId, error) {
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
    saveReport(report) {
        const reportPath = join(this.rootDir, "harness", "e2e", "reports", `${report.jobId}-${Date.now()}.json`);
        writeJson(reportPath, report);
        // Also append to a log
        const logPath = join(this.rootDir, "harness", "e2e", "reports", `${report.jobId}.jsonl`);
        appendJsonl(logPath, report);
    }
    /**
     * Resolve variables in values
     */
    resolveValue(value, context) {
        if (!context)
            return value;
        let result = value;
        for (const [key, val] of Object.entries(context)) {
            result = result.replace(new RegExp(`{{${key}}}`, "g"), String(val));
        }
        return result;
    }
    /**
     * Load scenarios from directory
     */
    loadScenarios(_scenariosDir) {
        // In practice, this would read from the scenarios directory
        return [];
    }
}
/**
 * Default E2E steps for common workflows
 */
export const CommonSteps = {
    login: (username, password) => [
        { action: "navigate", value: "/login" },
        { action: "type", selector: "#username", value: username },
        { action: "type", selector: "#password", value: password },
        { action: "click", selector: 'button[type="submit"]' },
        { action: "wait", selector: ".dashboard", timeout: 10000 },
    ],
    logout: () => [
        { action: "click", selector: ".user-menu" },
        { action: "click", selector: 'a[href="/logout"]' },
    ],
    fillForm: (fields) => {
        const steps = [];
        for (const [selector, value] of Object.entries(fields)) {
            steps.push({ action: "type", selector, value });
        }
        return steps;
    },
};
