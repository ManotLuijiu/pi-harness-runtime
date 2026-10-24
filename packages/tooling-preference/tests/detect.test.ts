import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectToolingContext,
	evaluateBiomeProposalEligibility,
} from "../src/detect.ts";

function workspace(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "tooling-preference-"));
	for (const [name, content] of Object.entries(files)) {
		const path = join(root, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content, "utf8");
	}
	return root;
}

function cleanup(root: string): void {
	rmSync(root, { recursive: true, force: true });
}

describe("detectToolingContext", () => {
	it("detects a Next.js + React + TypeScript workspace with ESLint and Prettier", () => {
		const root = workspace({
			"package.json": JSON.stringify({
				name: "web",
				dependencies: { next: "15.0.0", react: "19.0.0" },
				devDependencies: { eslint: "^9.0.0", prettier: "^3.0.0", typescript: "^5.7.0" },
			}),
			"tsconfig.json": "{}",
			".eslintrc.json": "{}",
			".prettierrc": "{}",
			"src/app/page.tsx": "export const x = 1;",
		});
		try {
			const context = detectToolingContext(root);
			expect(context.hasPackageJson).toBe(true);
			expect(context.isJavaScriptTypeScript).toBe(true);
			expect(context.isNextJs).toBe(true);
			expect(context.isReact).toBe(true);
			expect(context.usesBiome).toBe(false);
			expect(context.usesEslint).toBe(true);
			expect(context.usesPrettier).toBe(true);
			expect(context.frameworks).toContain("next");
		} finally {
			cleanup(root);
		}
	});

	it("reports a workspace that already uses Biome", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web", devDependencies: { eslint: "^9.0.0" } }),
			"biome.json": "{}",
			"tsconfig.json": "{}",
		});
		try {
			const context = detectToolingContext(root);
			expect(context.usesBiome).toBe(true);
		} finally {
			cleanup(root);
		}
	});

	it("detects Biome through the dependency alone", () => {
		const root = workspace({
			"package.json": JSON.stringify({
				name: "web",
				devDependencies: { "@biomejs/biome": "^2.4.7" },
			}),
			"tsconfig.json": "{}",
		});
		try {
			expect(detectToolingContext(root).usesBiome).toBe(true);
		} finally {
			cleanup(root);
		}
	});

	it("detects the package manager through the lockfile", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web" }),
			"pnpm-lock.yaml": "",
		});
		try {
			expect(detectToolingContext(root).packageManager).toBe("pnpm");
		} finally {
			cleanup(root);
		}
	});

	it("prefers the declared package manager", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web", packageManager: "bun@1.3.0" }),
			"package-lock.json": "{}",
		});
		try {
			expect(detectToolingContext(root).packageManager).toBe("bun");
		} finally {
			cleanup(root);
		}
	});

	it("finds a source file without a tsconfig", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web" }),
			"src/index.ts": "export const x = 1;",
		});
		try {
			expect(detectToolingContext(root).isJavaScriptTypeScript).toBe(true);
		} finally {
			cleanup(root);
		}
	});

	it("does not walk into a dependency directory for sources", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web" }),
			"node_modules/some-package/index.js": "module.exports = 1;",
		});
		try {
			expect(detectToolingContext(root).isJavaScriptTypeScript).toBe(false);
		} finally {
			cleanup(root);
		}
	});
});

describe("evaluateBiomeProposalEligibility", () => {
	it("offers the proposal for a JS/TS workspace with ESLint or Prettier", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web", devDependencies: { eslint: "^9.0.0" } }),
			"tsconfig.json": "{}",
		});
		try {
			const decision = evaluateBiomeProposalEligibility(detectToolingContext(root));
			expect(decision.eligible).toBe(true);
		} finally {
			cleanup(root);
		}
	});

	it("never asks a workspace that already uses Biome", () => {
		const root = workspace({
			"package.json": JSON.stringify({
				name: "web",
				devDependencies: { eslint: "^9.0.0", "@biomejs/biome": "^2.4.7" },
			}),
			"tsconfig.json": "{}",
		});
		try {
			const decision = evaluateBiomeProposalEligibility(detectToolingContext(root));
			expect(decision.eligible).toBe(false);
			expect(decision.reason).toContain("Biome");
		} finally {
			cleanup(root);
		}
	});

	it("never asks a workspace without ESLint and Prettier", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "web" }),
			"tsconfig.json": "{}",
		});
		try {
			const decision = evaluateBiomeProposalEligibility(detectToolingContext(root));
			expect(decision.eligible).toBe(false);
			expect(decision.reason).toContain("neither ESLint nor Prettier");
		} finally {
			cleanup(root);
		}
	});

	it("never asks a workspace that is not JavaScript/TypeScript", () => {
		const root = workspace({
			"package.json": JSON.stringify({ name: "docs" }),
			"README.md": "# docs",
		});
		try {
			const decision = evaluateBiomeProposalEligibility(detectToolingContext(root));
			expect(decision.eligible).toBe(false);
			expect(decision.reason).toContain("not a JavaScript/TypeScript project");
		} finally {
			cleanup(root);
		}
	});
});
