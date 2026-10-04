/**
 * Skill Tool - Agent-accessible skill management
 *
 * Tool for agent to create, update, delete skills autonomously.
 * Implements Hermes-style skill management with write_approval gate.
 *
 * Note: Full tool integration requires matching handler registration.
 */
import { getGlobalSkillRegistry } from "./loader.js";
/**
 * Skill tool configuration
 */
export interface SkillToolConfig {
    /** Enable skill tool */
    enabled: boolean;
    /** Require approval for writes */
    writeApproval: boolean;
    /** Auto-create directory if missing */
    autoCreateDir: boolean;
}
/**
 * Default configuration
 */
export declare const DEFAULT_TOOL_CONFIG: SkillToolConfig;
/**
 * Skill manage tool parameters
 */
export interface SkillManageParams {
    action: "create" | "patch" | "delete" | "list" | "info" | "search" | "lint" | "write_file" | "remove_file";
    name?: string;
    body?: string;
    description?: string;
    content?: string;
    file?: string;
    old_text?: string;
    author?: "agent" | "user" | "curator";
}
/**
 * Skill manage result
 */
export interface SkillManageResult {
    success: boolean;
    message: string;
    skillId?: string;
    details?: Record<string, unknown>;
}
/**
 * Create skill tool definition (for registration with ExtensionAPI)
 */
export declare function createSkillToolDefinition(handler: (params: SkillManageParams) => Promise<SkillManageResult>): {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            action: {
                type: "string";
                enum: readonly ["create", "patch", "delete", "list", "info", "search", "lint", "write_file", "remove_file"];
                description: string;
            };
            name: {
                type: "string";
                description: string;
            };
            body: {
                type: "string";
                description: string;
            };
            description: {
                type: "string";
                description: string;
            };
            content: {
                type: "string";
                description: string;
            };
            file: {
                type: "string";
                description: string;
            };
            old_text: {
                type: "string";
                description: string;
            };
            author: {
                type: "string";
                enum: readonly ["agent", "user", "curator"];
                description: string;
            };
        };
        required: readonly ["action"];
    };
    handler: (params: SkillManageParams) => Promise<SkillManageResult>;
};
/**
 * Handle skill creation
 */
export declare function handleSkillCreate(registry: ReturnType<typeof getGlobalSkillRegistry>, name: string, body?: string, description?: string, author?: "agent" | "user" | "curator"): SkillManageResult;
/**
 * Handle skill listing
 */
export declare function handleSkillList(registry: ReturnType<typeof getGlobalSkillRegistry>): SkillManageResult;
/**
 * Handle skill info
 */
export declare function handleSkillInfo(registry: ReturnType<typeof getGlobalSkillRegistry>, name: string): SkillManageResult;
/**
 * Handle skill search
 */
export declare function handleSkillSearch(registry: ReturnType<typeof getGlobalSkillRegistry>, query: string): SkillManageResult;
/**
 * Handle skill linting
 */
export declare function handleSkillLint(registry: ReturnType<typeof getGlobalSkillRegistry>, name: string): SkillManageResult;
/**
 * Process skill manage action
 */
export declare function processSkillManage(params: SkillManageParams, registry?: ReturnType<typeof getGlobalSkillRegistry>): Promise<SkillManageResult>;
//# sourceMappingURL=skill-tool.d.ts.map