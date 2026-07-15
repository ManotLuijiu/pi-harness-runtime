/**
 * Prompt Versioning — Types (RFC-0019)
 */
export interface PromptVersion {
    version: string;
    prompt: string;
    createdAt: string;
    createdBy?: string;
    tags?: string[];
    metadata?: Record<string, string>;
}
export interface PromptRecord {
    id: string;
    name: string;
    versions: PromptVersion[];
    activeVersion: string;
}
export interface VersionDiff {
    from: string;
    to: string;
    added: number;
    removed: number;
    addedLines: string[];
    removedLines: string[];
}
export interface RollbackResult {
    promptId: string;
    rolledBackTo: string;
    currentVersion: string;
    previousVersion: string;
}
export interface PromptVersioningConfig {
    maxVersions?: number;
    allowDelete?: boolean;
    onVersionCreated?: (v: PromptVersion) => void;
}
//# sourceMappingURL=types.d.ts.map