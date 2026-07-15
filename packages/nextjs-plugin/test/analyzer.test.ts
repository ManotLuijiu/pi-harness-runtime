/**
 * Next.js Plugin Tests (RFC-0062)
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { analyzeNextJs } from "../src/analyzer.js";

const roots: string[] = [];

async function mkdtemp(): Promise<string> {
	const d = await fs.mkdtemp(path.join(os.tmpdir(), "nextjs-plugin-"));
	roots.push(d);
	return d;
}

afterEach(async () => {
	for (const d of roots) {
		try {
			await fs.rm(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
	roots.length = 0;
});

describe("analyzeNextJs", () => {
	it("returns null for non-nextjs workspace", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		expect(await analyzeNextJs(dir)).toBeNull();
	});

	it("detects next.js workspace via next.config", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "next.config.js"),
			"module.exports = {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { next: "14.0.0" },
			}),
			"utf-8",
		);
		const result = await analyzeNextJs(dir);
		expect(result).not.toBeNull();
		expect(result!.framework.id).toBe("nextjs");
		expect(result!.version).toBe("14.0.0");
	});

	it("detects app router", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "app"), { recursive: true });
		await fs.mkdir(path.join(dir, "app", "dashboard"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "app", "page.tsx"),
			"export default function Page() {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "app", "dashboard", "page.tsx"),
			"export default function Dashboard() {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "next.config.js"),
			"module.exports = {}",
			"utf-8",
		);
		const result = await analyzeNextJs(dir);
		expect(result!.usingAppRouter).toBe(true);
		expect(result!.appRoutes.length).toBeGreaterThanOrEqual(2);
	});

	it("lists API routes", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "pages", "api", "posts"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(dir, "pages", "api", "users.ts"),
			"export default function handler(req, res) {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "pages", "api", "posts", "[id].ts"),
			"export default function handler(req, res) {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "next.config.js"),
			"module.exports = {}",
			"utf-8",
		);
		const result = await analyzeNextJs(dir);
		expect(result!.usingPagesRouter).toBe(true);
		expect(result!.apiRoutes.some((r) => r.includes("users"))).toBe(true);
	});

	it("extracts environment variables", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, ".env.example"),
			[
				"# Database",
				"DATABASE_URL=postgres://...",
				"API_KEY=secret",
				"",
				"NEXT_PUBLIC_APP_URL=https://example.com",
			].join("\n"),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "next.config.js"),
			"module.exports = {}",
			"utf-8",
		);
		const result = await analyzeNextJs(dir);
		expect(result!.environmentVars).toContain("DATABASE_URL");
		expect(result!.environmentVars).toContain("API_KEY");
		expect(result!.environmentVars).toContain("NEXT_PUBLIC_APP_URL");
		expect(result!.environmentVars).not.toContain(
			"DATABASE_URL=postgres://...",
		);
	});

	it("finds middleware file", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "middleware.ts"),
			"import { NextResponse } from 'next/server'",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "next.config.js"),
			"module.exports = {}",
			"utf-8",
		);
		const result = await analyzeNextJs(dir);
		expect(result!.middleware).toBeDefined();
		expect(result!.middleware).toContain("middleware.ts");
	});
});
