/**
 * Config Capture Extension
 *
 * Automatically detects API responses containing constant configuration values
 * (DNS records, routes, feature flags, etc.) and logs a suggestion to document
 * them to AGENTS.md.
 *
 * Pattern: Like todo-bd-sync, this listens to tool execution end events
 * and logs when constant config is detected. The agent decides whether to
 * document based on context.
 *
 * Usage:
 *   import { registerConfigCapture } from "@moocoding/config-capture";
 *   registerConfigCapture(pi);
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfigType =
	| "dns_records"
	| "routes"
	| "feature_flags"
	| "environment_config"
	| "integration_ids"
	| "webhook_urls"
	| "redirect_rules"
	| "unknown";

export interface ConfigDetection {
	detected: boolean;
	configType: ConfigType | null;
	confidence: "high" | "medium" | "low";
	sampleData?: string;
}

// ─── Config Type Detection ────────────────────────────────────────────────────

const DNS_PATTERNS = [
	"zone_id",
	"zoneId",
	"dns_record",
	"dns-record",
	"cloudflare",
	"name_servers",
	"@",
	"ttl",
	"proxied",
	"record_type",
	" a ",
	"aaaa",
	"cname",
	"txt",
	"mx",
	"ns",
	"spf",
];

const ROUTE_PATTERNS = [
	"routes",
	"endpoints",
	"api_routes",
	"api_rout",
	"path",
	"method",
	" get ",
	" post ",
	" put ",
	" delete ",
	" patch ",
	"/api/",
	"route_path",
];

const FEATURE_FLAG_PATTERNS = [
	"feature_flags",
	"feature-flags",
	"feature_toggle",
	"feature-toggle",
	"enabled",
	"disabled",
	"rollout",
	"variants",
];

const INTEGRATION_PATTERNS = [
	"integration_id",
	"integrationId",
	"webhook_url",
	"webhookUrl",
	"webhook_id",
	"redirect_url",
	"account_id",
	"project_id",
];

// ─── Detection Logic ─────────────────────────────────────────────────────────

/**
 * Detect if a tool result contains constant configuration data
 */
export function detectConfig(result: unknown): ConfigDetection {
	if (!result || typeof result !== "object") {
		return { detected: false, configType: null, confidence: "low" };
	}

	const resultStr = JSON.stringify(result).toLowerCase();
	const scores: { type: ConfigType; score: number }[] = [
		{ type: "dns_records", score: countMatches(resultStr, DNS_PATTERNS) },
		{ type: "routes", score: countMatches(resultStr, ROUTE_PATTERNS) },
		{ type: "feature_flags", score: countMatches(resultStr, FEATURE_FLAG_PATTERNS) },
		{ type: "integration_ids", score: countMatches(resultStr, INTEGRATION_PATTERNS) },
	];

	// Sort by score descending
	scores.sort((a, b) => b.score - a.score);

	const best = scores[0];
	if (best.score < 2) {
		return { detected: false, configType: null, confidence: "low" };
	}

	// Check for array of objects (typical config structure)
	const hasArrayOfObjects = detectArrayOfObjects(result);

	let confidence: "high" | "medium" | "low" = "low";
	if (best.score >= 4 || (best.score >= 2 && hasArrayOfObjects)) {
		confidence = "high";
	} else if (best.score >= 2) {
		confidence = "medium";
	}

	// Extract sample data for logging
	const sampleData = extractSampleData(result, best.type);

	return {
		detected: true,
		configType: best.type,
		confidence,
		sampleData,
	};
}

function countMatches(text: string, patterns: string[]): number {
	return patterns.filter((p) => text.includes(p.toLowerCase())).length;
}

function detectArrayOfObjects(result: unknown): boolean {
	if (Array.isArray(result)) {
		return result.some((item) => typeof item === "object" && item !== null);
	}
	if (typeof result === "object" && result !== null) {
		const values = Object.values(result);
		return values.some((v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object");
	}
	return false;
}

function extractSampleData(result: unknown, _type: ConfigType): string | undefined {
	if (!Array.isArray(result) || result.length === 0) return undefined;

	const sample = result[0];
	if (typeof sample !== "object" || sample === null) return undefined;

	const entries = Object.entries(sample).slice(0, 5);
	if (entries.length === 0) return undefined;

	const lines = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
	return lines.join(", ");
}

// ─── Privacy Filter ────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
	"token",
	"secret",
	"password",
	"key",
	"credential",
	"auth",
	"api_key",
	"apiKey",
	"bearer",
	"authorization",
	"private_",
	"private-",
];

/**
 * Check if a field name is sensitive (should not be documented)
 */
export function isSensitiveField(fieldName: string): boolean {
	const lower = fieldName.toLowerCase();
	return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Remove sensitive fields from a config object
 */
export function removeSensitiveFields<T extends object>(config: T): Partial<T> {
	const sanitized: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		if (!isSensitiveField(key)) {
			sanitized[key] = value;
		}
	}

	return sanitized as Partial<T>;
}

// ─── Format Output ────────────────────────────────────────────────────────────

export type OutputFormat = "markdown" | "json" | "brief";

/**
 * Format detected config for AGENTS.md
 */
export function formatForAgentsMd(
	detection: ConfigDetection,
	sampleData?: string,
): string {
	const lines: string[] = [];

	switch (detection.configType) {
		case "dns_records":
			lines.push("### DNS Records");
			lines.push("");
			lines.push("| Name | Type | Content | Notes |");
			lines.push("|------|------|---------|-------|");
			lines.push("| ... | ... | ... | ... |");
			lines.push("");
			lines.push("*Source: Auto-captured from API*");
			break;

		case "routes":
			lines.push("### API Routes");
			lines.push("");
			lines.push("- `GET /api/resource` - Description");
			lines.push("- `POST /api/resource` - Create");
			lines.push("");
			lines.push("*Source: Auto-captured from API*");
			break;

		case "feature_flags":
			lines.push("### Feature Flags");
			lines.push("");
			lines.push("| Flag | Enabled | Notes |");
			lines.push("|------|---------|-------|");
			lines.push("| flag_name | true/false | ... |");
			lines.push("");
			lines.push("*Source: Auto-captured from API*");
			break;

		default:
			lines.push("### Configuration");
			lines.push("");
			if (sampleData) {
				lines.push("```");
				lines.push(sampleData);
				lines.push("```");
			}
			lines.push("");
			lines.push("*Source: Auto-captured from API*");
	}

	return lines.join("\n");
}

// ─── Extension Registration ────────────────────────────────────────────────────

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Type for tool_execution_end event
interface ToolExecutionEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
}

interface ConfigCaptureConfig {
	/** Enable debug logging */
	debug?: boolean;
	/** Minimum confidence to trigger capture */
	minConfidence?: "high" | "medium" | "low";
}

const DEFAULT_CONFIG = {
	debug: false,
	minConfidence: "medium" as const,
};

/**
 * Register the config-capture extension
 */
export function registerConfigCapture(
	pi: ExtensionAPI,
	config: ConfigCaptureConfig = {},
): void {
	const cfg = { ...DEFAULT_CONFIG, ...config };

	// Track if we've already suggested documenting this config in this session
	const documentedConfigs = new Set<string>();

	// Listen to tool execution end
	pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
		// Skip errors
		if (event.isError) return;

		// Skip non-API tools (focus on bash/curl/http calls)
		const apiTools = ["bash", "http_request", "fetch", "curl"];
		if (!apiTools.includes(event.toolName)) return;

		// Detect config in result
		const detection = detectConfig(event.result);

		if (!detection.detected) return;

		// Check confidence threshold
		const confidenceLevels = { low: 0, medium: 1, high: 2 };
		const minLevel = confidenceLevels[cfg.minConfidence!];
		const currentLevel = confidenceLevels[detection.confidence];

		if (currentLevel < minLevel) return;

		// Create a unique key for this config type + rough content hash
		const contentStr = JSON.stringify(event.result).slice(0, 100);
		const configKey = `${detection.configType}-${contentStr}`;

		// Skip if already suggested in this session
		if (documentedConfigs.has(configKey)) return;

		// Log detection
		if (cfg.debug) {
			console.log(`[config-capture] Detected ${detection.configType} (${detection.confidence})`);
			console.log(`[config-capture] Sample: ${detection.sampleData}`);
		}

		// Mark as documented
		documentedConfigs.add(configKey);

		// Log the suggestion - agent will notice this
		console.log(`[config-capture] Config detected: ${detection.configType}`);
		console.log(`[config-capture] Confidence: ${detection.confidence}`);
		console.log(`[config-capture] Sample: ${detection.sampleData?.slice(0, 200)}`);

		// Suggest action
		const actionMsg = `[config-capture] Consider documenting this to AGENTS.md section "Discovered Configuration"`;
		console.log(actionMsg);
	});

	console.log("[config-capture] Started - detecting API config responses");
}

// Default export
export default registerConfigCapture;
