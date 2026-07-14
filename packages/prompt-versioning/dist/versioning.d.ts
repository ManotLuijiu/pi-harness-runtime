/**
 * Prompt Versioning — Core (RFC-0019)
 */
import type { PromptVersion, PromptRecord, VersionDiff, RollbackResult, PromptVersioningConfig } from "./types.js";
export declare class PromptVersioning {
    private prompts;
    private config;
    constructor(config?: PromptVersioningConfig);
    createPrompt(name: string, initialPrompt: string, createdBy?: string): PromptRecord;
    addVersion(promptId: string, prompt: string, createdBy?: string, tags?: string[]): PromptVersion;
    getVersion(promptId: string, version?: string): PromptVersion | null;
    listVersions(promptId: string): PromptVersion[];
    diff(promptId: string, from: string, to: string): VersionDiff | null;
    rollback(promptId: string, targetVersion: string): RollbackResult | null;
    delete(promptId: string): boolean;
    listPrompts(): PromptRecord[];
    getStats(promptId: string): {
        versionCount: number;
        activeVersion: string;
    } | null;
    private makeVersion;
    private enforceMaxVersions;
    private get;
    private getOrThrow;
}
//# sourceMappingURL=versioning.d.ts.map