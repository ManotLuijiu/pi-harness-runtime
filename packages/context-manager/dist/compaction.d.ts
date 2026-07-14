/**
 * Context Manager — Compaction Engine (RFC-0010)
 */
import type { ContextItem, CompactionResult, ResumePrompt, TriggerPolicy } from "./types.js";
/** Compact context by extracting durable state and keeping high-priority items. */
export declare function compactContext(messages: ContextItem[], maxTokens: number, policy?: TriggerPolicy): CompactionResult;
/** Generate a resume prompt from compaction result. */
export declare function generateResumePrompt(result: CompactionResult, nextAction?: string): ResumePrompt;
/** Format resume prompt as markdown string. */
export declare function formatResumeMarkdown(prompt: ResumePrompt): string;
//# sourceMappingURL=compaction.d.ts.map