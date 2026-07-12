/**
 * Cost Optimizer Configuration (RFC-0055)
 */

import type { CostOptimizerConfig } from "./types.js";

export const DEFAULT_CONFIG: CostOptimizerConfig = {
	defaultBudget: {
		daily: 10,
		weekly: 50,
		monthly: 200,
	},
	currency: "USD",
	alertThreshold: 0.8, // 80%
	autoSwitchToCheaper: false,
	maxQualityLossPercent: 15,
};

/**
 * Create a custom optimizer config
 */
export function createOptimizerConfig(
	overrides: Partial<CostOptimizerConfig>,
): CostOptimizerConfig {
	const result: CostOptimizerConfig = {
		...DEFAULT_CONFIG,
		...overrides,
		defaultBudget: {
			...DEFAULT_CONFIG.defaultBudget,
			...(overrides.defaultBudget ?? {}),
		},
	};
	return result;
}
