/**
 * Durable Reviewer
 *
 * Reviewer extension with constrained tools and structured result validation.
 */
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
export declare const ReadFileTool: import("@earendil-works/pi-durable").ToolRegistration<Type.TObject<{
    path: Type.TString;
    startLine: Type.TOptional<Type.TNumber>;
    endLine: Type.TOptional<Type.TNumber>;
}>, JsonValue>;
/**
 * Tool parameters for listing files
 */
export declare const ListFilesTool: import("@earendil-works/pi-durable").ToolRegistration<Type.TObject<{
    path: Type.TOptional<Type.TString>;
    pattern: Type.TOptional<Type.TString>;
}>, JsonValue>;
/**
 * Tool parameters for getting diff
 */
export declare const GetDiffTool: import("@earendil-works/pi-durable").ToolRegistration<Type.TObject<{}>, JsonValue>;
/**
 * Tool parameters for submitting review result
 */
export declare const SubmitReviewTool: import("@earendil-works/pi-durable").ToolRegistration<Type.TObject<{
    verdict: Type.TUnion<[Type.TLiteral<"approved">, Type.TLiteral<"changes_requested">, Type.TLiteral<"blocked">]>;
    findings: Type.TArray<Type.TObject<{
        rule: Type.TString;
        severity: Type.TUnion<[Type.TLiteral<"error">, Type.TLiteral<"warning">, Type.TLiteral<"info">]>;
        message: Type.TString;
        file: Type.TOptional<Type.TString>;
        line: Type.TOptional<Type.TNumber>;
        endLine: Type.TOptional<Type.TNumber>;
    }>>;
    summary: Type.TString;
}>, JsonValue>;
/**
 * Reviewer extension
 */
export declare const ReviewerExtension: import("@earendil-works/pi-durable").Extension<import("@earendil-works/pi-durable").ToolRegistration<Type.TObject<{}>, JsonValue>>;
//# sourceMappingURL=reviewer.d.ts.map