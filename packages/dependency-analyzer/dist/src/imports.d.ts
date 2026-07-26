/**
 * Dependency Analyzer — Import Parsing
 */
/**
 * Parse imports from file content. Supports TypeScript, JavaScript, CommonJS, Python.
 */
export declare function parseImports(content: string, filePath: string): string[];
/**
 * Resolve an import path relative to a file path.
 */
export declare function resolveImport(importPath: string, fromFile: string): string | null;
//# sourceMappingURL=imports.d.ts.map