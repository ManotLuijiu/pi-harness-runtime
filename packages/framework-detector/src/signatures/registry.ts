/**
 * Framework Detector - Signature Registry
 *
 * Registry of framework detection signatures.
 */

import type { FrameworkSignature } from "../types.js";

// ─── Default Signatures ────────────────────────────────────────────────────

/**
 * Get all default framework signatures
 */
export function getDefaultSignatures(): FrameworkSignature[] {
	return [
		// Frontend Frameworks
		getReactSignature(),
		getVueSignature(),
		getAngularSignature(),
		getNextJsSignature(),
		getNuxtSignature(),
		getSvelteSignature(),

		// Backend Frameworks
		getExpressSignature(),
		getFastifySignature(),
		getNestJsSignature(),
		getDjangoSignature(),
		getFlaskSignature(),
		getSpringBootSignature(),
		getFastApiSignature(),

		// Fullstack
		getRemixSignature(),
		getAstroSignature(),

		// Desktop
		getElectronSignature(),
		getTauriSignature(),

		// Mobile
		getReactNativeSignature(),
		getFlutterSignature(),

		// Frappe
		getFrappeSignature(),
		getErpNextSignature(),
		getFrappeSpaSignature(),
	];
}

// ─── React ──────────────────────────────────────────────────────────────

function getReactSignature(): FrameworkSignature {
	return {
		id: "react",
		name: "React",
		category: "frontend",
		description: "JavaScript library for building user interfaces",
		signals: [
			{ type: "package", pattern: "react", weight: 0.3, source: "package" },
			{ type: "package", pattern: "react-dom", weight: 0.3, source: "package" },
			{ type: "file", pattern: "jsx", weight: 0.2, source: "config" },
			{ type: "file", pattern: "tsx", weight: 0.2, source: "config" },
			{
				type: "import",
				pattern: "from ['\"]react['\"]",
				weight: 0.2,
				source: "import",
			},
		],
		tags: ["javascript", "ui", "component"],
	};
}

// ─── Vue ───────────────────────────────────────────────────────────────

function getVueSignature(): FrameworkSignature {
	return {
		id: "vue",
		name: "Vue.js",
		category: "frontend",
		description: "Progressive JavaScript framework",
		signals: [
			{ type: "package", pattern: "vue", weight: 0.4, source: "package" },
			{ type: "file", pattern: "vue", weight: 0.3, source: "file" },
			{
				type: "config",
				pattern: "vite.config.ts",
				weight: 0.2,
				source: "file",
			},
			{
				type: "import",
				pattern: "from ['\"]vue['\"]",
				weight: 0.2,
				source: "import",
			},
		],
		tags: ["javascript", "ui", "component"],
	};
}

// ─── Angular ───────────────────────────────────────────────────────────

function getAngularSignature(): FrameworkSignature {
	return {
		id: "angular",
		name: "Angular",
		category: "frontend",
		description: "Platform for building mobile and desktop web applications",
		signals: [
			{
				type: "package",
				pattern: "@angular/core",
				weight: 0.4,
				source: "package",
			},
			{ type: "file", pattern: "angular.json", weight: 0.3, source: "config" },
			{
				type: "import",
				pattern: "@angular/core",
				weight: 0.2,
				source: "import",
			},
		],
		tags: ["typescript", "ui", "enterprise"],
	};
}

// ─── Next.js ───────────────────────────────────────────────────────────

function getNextJsSignature(): FrameworkSignature {
	return {
		id: "nextjs",
		name: "Next.js",
		category: "fullstack",
		description: "The React framework for production",
		signals: [
			{ type: "package", pattern: "next", weight: 0.4, source: "package" },
			{ type: "file", pattern: "next.config", weight: 0.3, source: "config" },
			{ type: "directory", pattern: "pages", weight: 0.2, source: "directory" },
			{ type: "directory", pattern: "app", weight: 0.2, source: "directory" },
			{ type: "package", pattern: "react", weight: 0.1, source: "package" },
		],
		requires: ["react"],
		tags: ["react", "ssr", "fullstack"],
	};
}

// ─── Nuxt ──────────────────────────────────────────────────────────────

function getNuxtSignature(): FrameworkSignature {
	return {
		id: "nuxt",
		name: "Nuxt.js",
		category: "fullstack",
		description: "The intuitive Vue framework",
		signals: [
			{ type: "package", pattern: "nuxt", weight: 0.4, source: "package" },
			{ type: "file", pattern: "nuxt.config", weight: 0.3, source: "config" },
			{ type: "directory", pattern: "pages", weight: 0.2, source: "directory" },
		],
		requires: ["vue"],
		tags: ["vue", "ssr", "fullstack"],
	};
}

// ─── Svelte ───────────────────────────────────────────────────────────

function getSvelteSignature(): FrameworkSignature {
	return {
		id: "svelte",
		name: "Svelte",
		category: "frontend",
		description: "Cybernetically enhanced web apps",
		signals: [
			{ type: "package", pattern: "svelte", weight: 0.4, source: "package" },
			{ type: "file", pattern: "svelte.config", weight: 0.3, source: "config" },
			{ type: "file", pattern: ".svelte", weight: 0.2, source: "file" },
		],
		tags: ["javascript", "compiler"],
	};
}

// ─── Express ───────────────────────────────────────────────────────────

function getExpressSignature(): FrameworkSignature {
	return {
		id: "express",
		name: "Express.js",
		category: "backend",
		description: "Fast, unopinionated web framework for Node.js",
		signals: [
			{ type: "package", pattern: "express", weight: 0.4, source: "package" },
			{
				type: "import",
				pattern: "from ['\"]express['\"]",
				weight: 0.2,
				source: "import",
			},
			{ type: "file", pattern: "app.js", weight: 0.2, source: "file" },
			{ type: "file", pattern: "server.js", weight: 0.2, source: "file" },
		],
		tags: ["nodejs", "api", "backend"],
	};
}

// ─── Fastify ──────────────────────────────────────────────────────────

function getFastifySignature(): FrameworkSignature {
	return {
		id: "fastify",
		name: "Fastify",
		category: "backend",
		description: "Fast and low overhead web framework",
		signals: [
			{ type: "package", pattern: "fastify", weight: 0.4, source: "package" },
			{
				type: "import",
				pattern: "from ['\"]fastify['\"]",
				weight: 0.2,
				source: "import",
			},
		],
		tags: ["nodejs", "api", "high-performance"],
	};
}

// ─── NestJS ───────────────────────────────────────────────────────────

function getNestJsSignature(): FrameworkSignature {
	return {
		id: "nestjs",
		name: "NestJS",
		category: "backend",
		description: "A progressive Node.js framework",
		signals: [
			{
				type: "package",
				pattern: "@nestjs/core",
				weight: 0.4,
				source: "package",
			},
			{
				type: "import",
				pattern: "@nestjs/core",
				weight: 0.2,
				source: "import",
			},
			{ type: "file", pattern: "nest-cli.json", weight: 0.3, source: "config" },
		],
		tags: ["nodejs", "api", "enterprise", "typescript"],
	};
}

// ─── Django ───────────────────────────────────────────────────────────

function getDjangoSignature(): FrameworkSignature {
	return {
		id: "django",
		name: "Django",
		category: "fullstack",
		description: "Python web framework",
		signals: [
			{ type: "package", pattern: "django", weight: 0.4, source: "package" },
			{ type: "file", pattern: "manage.py", weight: 0.3, source: "file" },
			{
				type: "directory",
				pattern: "migrations",
				weight: 0.2,
				source: "directory",
			},
		],
		tags: ["python", "fullstack", "orm"],
	};
}

// ─── Flask ─────────────────────────────────────────────────────────────

function getFlaskSignature(): FrameworkSignature {
	return {
		id: "flask",
		name: "Flask",
		category: "backend",
		description: "Lightweight Python web framework",
		signals: [
			{ type: "package", pattern: "flask", weight: 0.4, source: "package" },
			{
				type: "import",
				pattern: "from flask import",
				weight: 0.2,
				source: "import",
			},
		],
		tags: ["python", "api", "micro"],
	};
}

// ─── Spring Boot ──────────────────────────────────────────────────────

function getSpringBootSignature(): FrameworkSignature {
	return {
		id: "spring-boot",
		name: "Spring Boot",
		category: "backend",
		description: "Java framework for building production-ready applications",
		signals: [
			{
				type: "package",
				pattern: "spring-boot-starter",
				weight: 0.4,
				source: "package",
			},
			{
				type: "file",
				pattern: "application.yml",
				weight: 0.2,
				source: "config",
			},
			{
				type: "file",
				pattern: "application.properties",
				weight: 0.2,
				source: "config",
			},
			{
				type: "directory",
				pattern: "src/main/java",
				weight: 0.2,
				source: "directory",
			},
		],
		tags: ["java", "enterprise", "api"],
	};
}

// ─── FastAPI ──────────────────────────────────────────────────────────

function getFastApiSignature(): FrameworkSignature {
	return {
		id: "fastapi",
		name: "FastAPI",
		category: "backend",
		description: "Modern Python web framework",
		signals: [
			{ type: "package", pattern: "fastapi", weight: 0.4, source: "package" },
			{
				type: "import",
				pattern: "from fastapi import",
				weight: 0.2,
				source: "import",
			},
		],
		tags: ["python", "api", "modern"],
	};
}

// ─── Remix ────────────────────────────────────────────────────────────

function getRemixSignature(): FrameworkSignature {
	return {
		id: "remix",
		name: "Remix",
		category: "fullstack",
		description: "Full-stack web framework",
		signals: [
			{
				type: "package",
				pattern: "@remix-run/react",
				weight: 0.4,
				source: "package",
			},
			{
				type: "file",
				pattern: "remix.config.js",
				weight: 0.3,
				source: "config",
			},
		],
		requires: ["react"],
		tags: ["react", "fullstack", "ssr"],
	};
}

// ─── Astro ───────────────────────────────────────────────────────────

function getAstroSignature(): FrameworkSignature {
	return {
		id: "astro",
		name: "Astro",
		category: "fullstack",
		description: "All-in-one web framework",
		signals: [
			{ type: "package", pattern: "astro", weight: 0.4, source: "package" },
			{
				type: "file",
				pattern: "astro.config.mjs",
				weight: 0.3,
				source: "config",
			},
		],
		tags: ["static", "content", " Islands"],
	};
}

// ─── Electron ────────────────────────────────────────────────────────

function getElectronSignature(): FrameworkSignature {
	return {
		id: "electron",
		name: "Electron",
		category: "desktop",
		description: "Framework for cross-platform desktop apps",
		signals: [
			{ type: "package", pattern: "electron", weight: 0.4, source: "package" },
			{ type: "file", pattern: "main.js", weight: 0.2, source: "file" },
			{ type: "file", pattern: "preload.js", weight: 0.2, source: "file" },
		],
		tags: ["desktop", "chromium", "cross-platform"],
	};
}

// ─── Tauri ───────────────────────────────────────────────────────────

function getTauriSignature(): FrameworkSignature {
	return {
		id: "tauri",
		name: "Tauri",
		category: "desktop",
		description: "Build smaller, faster, and more secure desktop apps",
		signals: [
			{
				type: "package",
				pattern: "@tauri-apps/api",
				weight: 0.4,
				source: "package",
			},
			{
				type: "file",
				pattern: "tauri.conf.json",
				weight: 0.3,
				source: "config",
			},
			{ type: "file", pattern: "Cargo.toml", weight: 0.2, source: "file" },
		],
		tags: ["desktop", "rust", "lightweight"],
	};
}

// ─── React Native ────────────────────────────────────────────────────

function getReactNativeSignature(): FrameworkSignature {
	return {
		id: "react-native",
		name: "React Native",
		category: "mobile",
		description: "Framework for building native mobile apps",
		signals: [
			{
				type: "package",
				pattern: "react-native",
				weight: 0.4,
				source: "package",
			},
			{ type: "file", pattern: "App.tsx", weight: 0.2, source: "file" },
			{ type: "file", pattern: "index.js", weight: 0.2, source: "file" },
		],
		requires: ["react"],
		tags: ["mobile", "native", "javascript"],
	};
}

// ─── Flutter ──────────────────────────────────────────────────────────

function getFlutterSignature(): FrameworkSignature {
	return {
		id: "flutter",
		name: "Flutter",
		category: "mobile",
		description: "Google's UI toolkit for building natively compiled apps",
		signals: [
			{ type: "file", pattern: "pubspec.yaml", weight: 0.3, source: "config" },
			{ type: "file", pattern: "lib/main.dart", weight: 0.3, source: "file" },
		],
		tags: ["mobile", "dart", "native"],
	};
}

// ─── Frappe ───────────────────────────────────────────────────────────

function getFrappeSignature(): FrameworkSignature {
	return {
		id: "frappe",
		name: "Frappe",
		category: "fullstack",
		description: "Full-stack Python web framework",
		signals: [
			{ type: "file", pattern: "sites", weight: 0.3, source: "directory" },
			{ type: "file", pattern: "apps.txt", weight: 0.2, source: "file" },
			{
				type: "file",
				pattern: "frappe-bench",
				weight: 0.2,
				source: "directory",
			},
			{ type: "file", pattern: "bench", weight: 0.2, source: "file" },
		],
		tags: ["python", "fullstack", "bench"],
	};
}

// ─── ERPNext ──────────────────────────────────────────────────────────

function getErpNextSignature(): FrameworkSignature {
	return {
		id: "erpnext",
		name: "ERPNext",
		category: "fullstack",
		description: "Open Source ERP for the Web",
		signals: [
			{ type: "package", pattern: "erpnext", weight: 0.4, source: "package" },
		],
		requires: ["frappe"],
		implies: ["frappe"],
		tags: ["erp", "business", "python"],
	};
}

// ─── Frappe SPA ───────────────────────────────────────────────────────

function getFrappeSpaSignature(): FrameworkSignature {
	return {
		id: "frappe-spa",
		name: "Frappe SPA",
		category: "frontend",
		description: "Single Page App framework for Frappe",
		signals: [
			{
				type: "package",
				pattern: "@frappe/ui",
				weight: 0.3,
				source: "package",
			},
			{ type: "package", pattern: "frappe-ui", weight: 0.3, source: "package" },
			{
				type: "import",
				pattern: "from frappe-ui",
				weight: 0.2,
				source: "import",
			},
		],
		requires: ["frappe"],
		tags: ["javascript", "spa", "frappe"],
	};
}

// ─── Signature Registry Class ───────────────────────────────────────────

export class SignatureRegistry {
	private signatures: Map<string, FrameworkSignature> = new Map();
	private categoryIndex: Map<string, Set<string>> = new Map();
	private tagIndex: Map<string, Set<string>> = new Map();

	constructor() {
		this.loadDefaults();
	}

	/**
	 * Load default signatures
	 */
	private loadDefaults(): void {
		const defaults = getDefaultSignatures();
		for (const signature of defaults) {
			this.register(signature);
		}
	}

	/**
	 * Register a signature
	 */
	register(signature: FrameworkSignature): void {
		this.signatures.set(signature.id, signature);

		// Index by category
		if (!this.categoryIndex.has(signature.category)) {
			this.categoryIndex.set(signature.category, new Set());
		}
		this.categoryIndex.get(signature.category)!.add(signature.id);

		// Index by tags
		for (const tag of signature.tags ?? []) {
			if (!this.tagIndex.has(tag)) {
				this.tagIndex.set(tag, new Set());
			}
			this.tagIndex.get(tag)!.add(signature.id);
		}
	}

	/**
	 * Get signature by ID
	 */
	get(id: string): FrameworkSignature | undefined {
		return this.signatures.get(id);
	}

	/**
	 * Get all signatures
	 */
	list(): FrameworkSignature[] {
		return Array.from(this.signatures.values());
	}

	/**
	 * Get signatures by category
	 */
	byCategory(category: string): FrameworkSignature[] {
		const ids = this.categoryIndex.get(category);
		if (!ids) return [];
		return Array.from(ids)
			.map((id) => this.signatures.get(id)!)
			.filter(Boolean);
	}

	/**
	 * Get signatures by tag
	 */
	byTag(tag: string): FrameworkSignature[] {
		const ids = this.tagIndex.get(tag);
		if (!ids) return [];
		return Array.from(ids)
			.map((id) => this.signatures.get(id)!)
			.filter(Boolean);
	}

	/**
	 * Search signatures
	 */
	search(query: string): FrameworkSignature[] {
		const queryLower = query.toLowerCase();
		return this.list().filter(
			(s) =>
				s.name.toLowerCase().includes(queryLower) ||
				s.description.toLowerCase().includes(queryLower) ||
				s.tags?.some((t) => t.toLowerCase().includes(queryLower)),
		);
	}
}
