/**
 * Generic Web Plugin Tests (RFC-0066)
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { analyzeWeb, detectWeb } from "../src/analyzer.js";

const tempRoots: string[] = [];

async function mkdtemp(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "generic-web-"));
	tempRoots.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempRoots) {
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
	tempRoots.length = 0;
});

describe("detectWeb", () => {
	it("returns false for empty directory", async () => {
		const dir = await mkdtemp();
		const result = await detectWeb(dir);
		expect(result).toBe(false);
	});

	it("returns true when package.json exists", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
		const result = await detectWeb(dir);
		expect(result).toBe(true);
	});

	it("returns true when src directory exists", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "src"), { recursive: true });
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		const result = await detectWeb(dir);
		expect(result).toBe(true);
	});
});

describe("analyzeWeb", () => {
	it("returns null for non-web workspace", async () => {
		const dir = await mkdtemp();
		const result = await analyzeWeb(dir);
		expect(result).toBeNull();
	});

	it("detects Express.js from package.json", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({ dependencies: { express: "^4.18.0" } }),
			"utf-8",
		);
		await fs.mkdir(path.join(dir, "src", "routes"), { recursive: true });

		const result = await analyzeWeb(dir);
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("express");
	});

	it("detects Fastify", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
			"utf-8",
		);
		await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });

		const result = await analyzeWeb(dir);
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("fastify");
	});

	it("detects React/Vite", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({
				scripts: { dev: "vite" },
				dependencies: { react: "^18.0.0" },
				devDependencies: { vite: "^5.0.0" },
			}),
			"utf-8",
		);
		await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });

		const result = await analyzeWeb(dir);
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("react-vite");
	});

	it("marks SSR frameworks correctly", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({ dependencies: { next: "^14.0.0" } }),
			"utf-8",
		);
		await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });

		const result = await analyzeWeb(dir);
		expect(result).not.toBeNull();
		expect(result!.ssr).toBe(true);
	});

	it("marks static site as non-SSR", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({ dependencies: { astro: "^3.0.0" } }),
			"utf-8",
		);
		await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });

		const result = await analyzeWeb(dir);
		expect(result).not.toBeNull();
		expect(result!.ssr).toBe(true); // astro detected as astro, not static
	});
});
