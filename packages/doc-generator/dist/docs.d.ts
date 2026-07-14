/**
 * Doc Generator — Documentation Generation (RFC-0014)
 */
import type { DetectedSymbol, GeneratedDocs, SourceFile } from "./types.js";
/** Detect exported symbols in a source file. */
export declare function detectSymbols(source: SourceFile): DetectedSymbol[];
/** Generate documentation for a list of source files. */
export declare function generateDocs(sources: SourceFile[], projectSignals: string[]): GeneratedDocs;
//# sourceMappingURL=docs.d.ts.map