/**
 * Release Manager — Changelog Generation (RFC-0078)
 */
import type { Commit, ChangelogEntry, ChangelogChanges, Version } from "./types.js";
export declare function classifyCommit(message: string): Commit["type"];
export declare function isBreakingChange(message: string): boolean;
export declare function extractScope(message: string): string | undefined;
export declare function parseCommit(line: string): Commit;
export declare function buildChanges(commits: Commit[]): ChangelogChanges;
export declare function createChangelogEntry(version: Version, commits: Commit[], options?: {
    date?: string;
}): ChangelogEntry;
export declare function formatChangelogMarkdown(entry: ChangelogEntry): string;
//# sourceMappingURL=changelog.d.ts.map