/**
 * Doc Generator Tests (RFC-0014)
 */

import { describe, it, expect } from "bun:test";
import {
	detectProjectType,
	parseSignals,
	detectSymbols,
	generateDocs,
} from "../src/index.js";
import type { SourceFile } from "../src/index.js";

const src = (content: string, path = "src/utils.ts"): SourceFile => ({
	path,
	content,
	language: "typescript",
});

describe("detectProjectType", () => {
	it("detects Frappe/ERPNext", () => {
		const signals = ["frappe-bench/apps/myapp/hooks.py", "doctype/CRM"];
		const result = detectProjectType(signals);
		expect(result.projectType).toBe("frappe_erpnext");
		expect(result.signals).toContain("frappe-bench/apps/myapp/hooks.py");
	});

	it("detects Next.js", () => {
		const signals = ["next.config.js", "app/layout.tsx", "pages/index.ts"];
		const result = detectProjectType(signals);
		expect(result.projectType).toBe("nextjs");
	});

	it("detects React/Vite", () => {
		const signals = ["vite.config.ts", "src/main.tsx", "index.html"];
		const result = detectProjectType(signals);
		expect(result.projectType).toBe("react_vite");
	});

	it("detects Django", () => {
		const signals = ["manage.py", "settings.py"];
		const result = detectProjectType(signals);
		expect(result.projectType).toBe("django");
	});

	it("detects Laravel", () => {
		const signals = ["artisan", "database/seeders/UserSeeder.php"];
		const result = detectProjectType(signals);
		expect(result.projectType).toBe("laravel");
	});

	it("returns unknown for empty signals", () => {
		const result = detectProjectType([]);
		expect(result.projectType).toBe("unknown");
		expect(result.confidence).toBe(0);
	});

	it("returns generic_web for package.json", () => {
		const result = detectProjectType(["package.json", "index.js"]);
		expect(result.projectType).toBe("generic_web");
	});

	it("includes recommended seed strategy", () => {
		const result = detectProjectType(["manage.py"]);
		expect(result.recommendedSeedStrategy).toBe("django_migrations");
	});

	it("includes recommended e2e strategy", () => {
		const result = detectProjectType(["next.config.js"]);
		expect(result.recommendedE2EStrategy).toBe("nextjs_dev_server_flow");
	});

	it("confidence is 0-1", () => {
		const result = detectProjectType(["doctype/CRM"]);
		expect(result.confidence).toBeGreaterThanOrEqual(0);
		expect(result.confidence).toBeLessThanOrEqual(1);
	});
});

describe("parseSignals", () => {
	it("filters paths with dots or slashes", () => {
		const entries = ["frappe-bench", "doctype", "README.md", "apps/main.py"];
		const signals = parseSignals(entries);
		expect(signals).toContain("README.md");
		expect(signals).toContain("apps/main.py");
		expect(signals).not.toContain("doctype");
	});
});

describe("detectSymbols", () => {
	it("detects function declarations", () => {
		const s = src(
			"export function add(a: number, b: number): number { return a + b; }",
		);
		const symbols = detectSymbols(s);
		const fn = symbols.find((sym) => sym.kind === "function");
		expect(fn).toBeDefined();
		expect(fn!.name).toBe("add");
		expect(fn!.signature).toContain("add");
	});

	it("detects async functions", () => {
		const s = src("async function fetchData(): Promise<string> { return ''; }");
		const symbols = detectSymbols(s);
		expect(symbols.some((sym) => sym.kind === "function")).toBe(true);
	});

	it("detects class declarations", () => {
		const s = src("export class UserService { }");
		const symbols = detectSymbols(s);
		expect(symbols.some((sym) => sym.kind === "class")).toBe(true);
	});

	it("detects interface declarations", () => {
		const s = src("export interface Config { port: number; }");
		const symbols = detectSymbols(s);
		expect(symbols.some((sym) => sym.kind === "interface")).toBe(true);
	});

	it("detects type aliases", () => {
		const s = src("export type ID = string | number;");
		const symbols = detectSymbols(s);
		expect(symbols.some((sym) => sym.kind === "type")).toBe(true);
	});

	it("detects const exports", () => {
		const s = src("export const MAX_RETRIES = 3;");
		const symbols = detectSymbols(s);
		expect(symbols.some((sym) => sym.kind === "constant")).toBe(true);
	});

	it("includes file and line number", () => {
		const s = src("function a() {}\nfunction b() {}");
		const symbols = detectSymbols(s);
		const b = symbols.find((sym) => sym.name === "b");
		expect(b!.line).toBe(2);
	});
});

describe("generateDocs", () => {
	it("generates overview section", () => {
		const sources = [
			src("export function hello() {}", "src/a.ts"),
			src("export type Config = {}", "src/b.ts"),
		];
		const docs = generateDocs(sources, ["next.config.js"]);
		expect(docs.sections.some((s) => s.heading === "Overview")).toBe(true);
		expect(docs.sections.some((s) => s.heading === "Functions")).toBe(true);
	});

	it("sets project type from signals", () => {
		const docs = generateDocs([], ["vite.config.ts", "src/main.tsx"]);
		expect(docs.projectType).toBe("react_vite");
	});

	it("lists exported symbols", () => {
		const sources = [src("export function fn() {}")];
		const docs = generateDocs(sources, []);
		expect(docs.symbols.length).toBeGreaterThan(0);
	});

	it("includes exported functions in sections", () => {
		const sources = [src("export function publicFn() {}")];
		const docs = generateDocs(sources, []);
		const fnSection = docs.sections.find((s) => s.heading === "Functions");
		expect(fnSection!.content).toContain("publicFn");
	});
});
