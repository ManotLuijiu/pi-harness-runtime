/**
 * Durable Reviewer
 *
 * Reviewer extension with constrained tools and structured result validation.
 */

import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import { Type } from "typebox";

/**
 * Finding from the reviewer
 */
export interface Finding {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  endLine?: number;
  [key: string]: string | number | undefined;
}

/**
 * Review result
 */
export interface ReviewResult {
  verdict: "approved" | "changes_requested" | "blocked";
  findings: Finding[];
  summary: string;
  reportId: string;
}

/**
 * Tool parameters for reading a file
 */
export const ReadFileTool = defineTool({
  name: "read_file",
  description: "Read contents of a file in the review snapshot",
  parameters: Type.Object({
    path: Type.String(),
    startLine: Type.Optional(Type.Number()),
    endLine: Type.Optional(Type.Number()),
  }),
  replay: "safe",
  execute: async (
    args: { path: string; startLine?: number; endLine?: number },
    _api,
    _context
  ): Promise<ToolExecutionResult> => {
    // In a real implementation, this would read from the snapshot directory
    return {
      isError: true,
      structuredOutput: { error: "Snapshot reading not yet implemented", path: args.path },
    };
  },
});

/**
 * Tool parameters for listing files
 */
export const ListFilesTool = defineTool({
  name: "list_files",
  description: "List files in a directory of the review snapshot",
  parameters: Type.Object({
    path: Type.Optional(Type.String()),
    pattern: Type.Optional(Type.String()),
  }),
  replay: "safe",
  execute: async (
    _args: { path?: string; pattern?: string },
    _api,
    _context
  ): Promise<ToolExecutionResult> => {
    // In a real implementation, this would list from the snapshot directory
    return {
      structuredOutput: { files: [], error: "Snapshot listing not yet implemented" },
    };
  },
});

/**
 * Tool parameters for getting diff
 */
export const GetDiffTool = defineTool({
  name: "get_diff",
  description: "Get the diff for review",
  parameters: Type.Object({}),
  replay: "safe",
  execute: async (_args: Record<string, never>, _api, _context): Promise<ToolExecutionResult> => {
    // In a real implementation, this would return the stored diff
    return {
      structuredOutput: { diff: "", error: "Diff reading not yet implemented" },
    };
  },
});

/**
 * Tool parameters for submitting review result
 */
export const SubmitReviewTool = defineTool({
  name: "submit_review",
  description: "Submit the final review result",
  parameters: Type.Object({
    verdict: Type.Union([
      Type.Literal("approved"),
      Type.Literal("changes_requested"),
      Type.Literal("blocked"),
    ]),
    findings: Type.Array(
      Type.Object({
        rule: Type.String(),
        severity: Type.Union([
          Type.Literal("error"),
          Type.Literal("warning"),
          Type.Literal("info"),
        ]),
        message: Type.String(),
        file: Type.Optional(Type.String()),
        line: Type.Optional(Type.Number()),
        endLine: Type.Optional(Type.Number()),
      })
    ),
    summary: Type.String(),
  }),
  replay: "safe",
  execute: async (
    args: {
      verdict: "approved" | "changes_requested" | "blocked";
      findings: Finding[];
      summary: string;
    },
    _api,
    _context
  ): Promise<ToolExecutionResult> => {
    const reportId = `report-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Cast findings to JsonValue via JSON roundtrip
    let structuredOutput: Record<string, unknown>;
    try {
      structuredOutput = JSON.parse(JSON.stringify({
        verdict: args.verdict,
        findings: args.findings,
        summary: args.summary,
        reportId,
      }));
    } catch {
      structuredOutput = {
        verdict: args.verdict,
        summary: args.summary,
        reportId,
        findings: [],
      };
    }
    // SAFETY: structuredOutput is JSON-serializable and matches the schema
    return { structuredOutput: structuredOutput as unknown as JsonValue };
  },
});

/**
 * Reviewer extension
 */
export const ReviewerExtension = defineExtension({
  name: "reviewer",
  tools: [ReadFileTool, ListFilesTool, GetDiffTool, SubmitReviewTool],
});
