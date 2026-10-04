/**
 * Skill Commands - /skill:name slash command handler
 *
 * Registers /skill:name commands for explicit skill invocation.
 * Based on pi.dev skill command specification.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Skill command configuration
 */
export interface SkillCommandConfig {
    /** Enable skill commands */
    enabled: boolean;
    /** Prefix for skill commands (default: "skill:") */
    prefix: string;
}
/**
 * Default configuration
 */
export declare const DEFAULT_COMMAND_CONFIG: SkillCommandConfig;
/**
 * Initialize skill commands with ExtensionAPI
 */
export declare function initSkillCommands(pi: ExtensionAPI, config?: Partial<SkillCommandConfig>): void;
/**
 * Get skill index for system prompt injection
 */
export declare function getSkillIndexForSystemPrompt(): string;
/**
 * Refresh skill commands (re-register after skills change)
 */
export declare function refreshSkillCommands(pi: ExtensionAPI, prefix?: string): void;
//# sourceMappingURL=skill-commands.d.ts.map