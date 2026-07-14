/**
 * React/Vite Plugin Tests (RFC-0063)
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { analyzeReactVite } from "../src/analyzer.js";

const roots: string[] = [];

async function mkdtemp(): Promise<string> {
	const d = await fs.mkdtemp(path.join(os.tmpdir(), "react-vite-"));
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

describe("analyzeReactVite", () => {
	it("returns null for non-vite workspace", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		expect(await analyzeReactVite(dir)).toBeNull();
	});

	it("detects vite workspace via vite.config.ts", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "vite.config.ts"),
			"import react from '@vitejs/plugin-react'",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
				devDependencies: { vite: "^5.0.0", "@vitejs/plugin-react": "^4.0.0" },
			}),
			"utf-8",
		);
		const result = await analyzeReactVite(dir);
		expect(result).not.toBeNull();
		expect(result!.framework.id).toBe("react-vite");
		expect(result!.plugins).toContain("@vitejs/plugin-react");
	});

	it("detects react-router", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "vite.config.ts"),
			"export default {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { react: "^18.0.0", "react-router-dom": "^6.0.0" },
			}),
			"utf-8",
		);
		const result = await analyzeReactVite(dir);
		expect(result!.hasRouter).toBe(true);
		expect(result!.routerType).toBe("react-router");
	});

	it("lists components from src directory", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "src", "components"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "src", "components", "Button.tsx"),
			"export function Button() {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "src", "components", "Modal.jsx"),
			"export function Modal() {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "vite.config.ts"),
			"export default {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { react: "^18.0.0" },
			}),
			"utf-8",
		);
		const result = await analyzeReactVite(dir);
		expect(result!.components.some((c) => c.endsWith("Button.tsx"))).toBe(true);
		expect(result!.components.some((c) => c.endsWith("Modal.jsx"))).toBe(true);
	});

	it("parses tsconfig path aliases", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					paths: {
						"@/*": ["./src/*"],
						"components/*": ["./src/components/*"],
					},
				},
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "vite.config.ts"),
			"export default {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { react: "^18.0.0" },
			}),
			"utf-8",
		);
		const result = await analyzeReactVite(dir);
		expect(result!.aliases["@"]).toBe("./src");
		expect(result!.aliases["components"]).toBe("./src/components");
	});
});
