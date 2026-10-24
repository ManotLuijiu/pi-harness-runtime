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
export type ConfigType = "dns_records" | "routes" | "feature_flags" | "environment_config" | "integration_ids" | "webhook_urls" | "redirect_rules" | "unknown";
export interface ConfigDetection {
    detected: boolean;
    configType: ConfigType | null;
    confidence: "high" | "medium" | "low";
    sampleData?: string;
}
/**
 * Detect if a tool result contains constant configuration data
 */
export declare function detectConfig(result: unknown): ConfigDetection;
/**
 * Check if a field name is sensitive (should not be documented)
 */
export declare function isSensitiveField(fieldName: string): boolean;
/**
 * Remove sensitive fields from a config object
 */
export declare function removeSensitiveFields<T extends object>(config: T): Partial<T>;
export type OutputFormat = "markdown" | "json" | "brief";
/**
 * Format detected config for AGENTS.md
 */
export declare function formatForAgentsMd(detection: ConfigDetection, sampleData?: string): string;
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
interface ConfigCaptureConfig {
    /** Enable debug logging */
    debug?: boolean;
    /** Minimum confidence to trigger capture */
    minConfidence?: "high" | "medium" | "low";
}
/**
 * Register the config-capture extension
 */
export declare function registerConfigCapture(pi: ExtensionAPI, config?: ConfigCaptureConfig): void;
export default registerConfigCapture;
//# sourceMappingURL=index.d.ts.map