/**
 * Dependency Analyzer — Import Parsing
 */

import { extname, join, resolve } from "node:path";

/**
 * Parse imports from file content. Supports TypeScript, JavaScript, CommonJS, Python.
 */
export function parseImports(content: string, filePath: string): string[] {
	const ext = extname(filePath).toLowerCase();
	const imports: string[] = [];

	if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
		imports.push(...parseTypeScriptImports(content));
		imports.push(...parsePythonImports(content));
	} else if (ext === "py") {
		imports.push(...parsePythonImports(content));
	}

	return [...new Set(imports)].filter(Boolean);
}

function parseTypeScriptImports(content: string): string[] {
	const imports: string[] = [];

	// ESM: import X from './y' or import X from 'package'
	const esmDefault =
		/import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[A-Z][\w$]*)\s+from\s+)?['"]([^'"]+)['"]/g;
	for (const match of content.matchAll(esmDefault)) {
		imports.push(match[1]);
	}

	// ESM: import * as X from './y'
	const esmNamespace = /import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g;
	for (const match of content.matchAll(esmNamespace)) {
		imports.push(match[1]);
	}

	// ESM: import './x' (side-effect only)
	const esmSideEffect = /import\s+['"]([^'"]+)['"]/g;
	for (const match of content.matchAll(esmSideEffect)) {
		imports.push(match[1]);
	}

	// CommonJS: const X = require('./y')
	const cjs = /const\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	for (const match of content.matchAll(cjs)) {
		imports.push(match[1]);
	}

	// CommonJS: require('./y')
	const cjsBare = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	for (const match of content.matchAll(cjsBare)) {
		imports.push(match[1]);
	}

	return imports;
}

function parsePythonImports(content: string): string[] {
	const imports: string[] = [];

	// from module import x, y
	const fromImport =
		/from\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s+import/g;
	for (const match of content.matchAll(fromImport)) {
		imports.push(match[1]);
	}

	// import module
	const directImport =
		/^import\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/gm;
	for (const match of content.matchAll(directImport)) {
		imports.push(match[1]);
	}

	return imports;
}

/**
 * Resolve an import path relative to a file path.
 */
export function resolveImport(
	importPath: string,
	fromFile: string,
): string | null {
	if (importPath.startsWith(".")) {
		return resolve(fromFile, "..", importPath);
	}
	// Package imports — return as-is (not a file path)
	return null;
}
