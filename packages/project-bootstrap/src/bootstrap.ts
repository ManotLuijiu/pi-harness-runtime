/**
 * Project Bootstrap - RFC-0072
 *
 * Main bootstrap orchestration.
 */

import type {
	ProjectSpec,
	BootstrapOptions,
	BootstrapResult,
	ValidationError,
	Template,
} from "./types.js";
import { minimalTemplate } from "./minimal.js";
import { nodeTypescriptTemplate } from "./typescript.js";
import { frappeTemplate } from "./frappe.js";

// Built-in templates
const TEMPLATES: Record<string, Template> = {
	minimal: minimalTemplate,
	"node-typescript": nodeTypescriptTemplate,
	"frappe-app": frappeTemplate,
};

/**
 * Validate a project spec
 */
export function validateSpec(spec: ProjectSpec): ValidationError[] {
	const errors: ValidationError[] = [];

	if (!spec.name || spec.name.trim() === "") {
		errors.push({ field: "name", message: "Name is required" });
	}

	if (
		!spec.type ||
		!["monorepo", "single-package", "multi-package"].includes(spec.type)
	) {
		errors.push({
			field: "type",
			message: "Type must be monorepo, single-package, or multi-package",
		});
	}

	if (!spec.frameworks || spec.frameworks.length === 0) {
		errors.push({
			field: "frameworks",
			message: "At least one framework is required",
		});
	}

	return errors;
}

/**
 * Get template for a spec
 */
export function getTemplateForSpec(
	spec: ProjectSpec,
	override?: string,
): Template {
	if (override && TEMPLATES[override]) {
		return TEMPLATES[override];
	}

	// Auto-detect based on frameworks
	if (spec.frameworks.includes("frappe")) {
		return TEMPLATES["frappe-app"];
	}

	if (
		spec.frameworks.includes("node") ||
		spec.frameworks.includes("typescript")
	) {
		return TEMPLATES["node-typescript"];
	}

	return TEMPLATES["minimal"];
}

/**
 * Bootstrap a project from a spec
 */
export async function bootstrap(
	spec: ProjectSpec,
	targetDir: string,
	options: BootstrapOptions = {},
): Promise<BootstrapResult> {
	const startTime = Date.now();
	const errors = validateSpec(spec);

	if (errors.length > 0) {
		throw new Error(`Invalid spec: ${errors.map((e) => e.message).join(", ")}`);
	}

	const { mkdir, writeFile } = await import("fs/promises");
	const { join } = await import("path");

	// Create target directory
	await mkdir(targetDir, { recursive: true });

	// Get template
	const template = getTemplateForSpec(spec, options.template);

	// Emit started event
	if (options.verbose) {
		console.log(`Bootstrap: ${spec.name} using template: ${template.name}`);
	}

	// Apply template
	const files = await template.apply(spec, targetDir);

	// Create gitignore if gitInit
	if (spec.gitInit) {
		const gitignore = `node_modules/\ndist/\n.env\n*.log\n`;
		await writeFile(join(targetDir, ".gitignore"), gitignore);
		files.push(".gitignore");
	}

	const result: BootstrapResult = {
		root: targetDir,
		files,
		packages: spec.packages?.map((p) => p.name) || [],
		duration: Date.now() - startTime,
	};

	return result;
}

/**
 * Detect framework and suggest a spec
 */
export async function detectAndSuggest(
	projectRoot: string,
): Promise<ProjectSpec | null> {
	const { readdir } = await import("fs/promises");
	const { join } = await import("path");

	try {
		const entries = await readdir(projectRoot, { withFileTypes: true });
		const files = entries.filter((e) => e.isFile()).map((e) => e.name);
		const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

		// Detect Frappe
		if (dirs.includes("sites") && dirs.includes("apps")) {
			const appName = join(projectRoot).split("/").pop() || "frappe-app";
			return {
				name: appName,
				type: "single-package",
				frameworks: ["frappe"],
				gitInit: true,
			};
		}

		// Detect Next.js
		if (files.includes("next.config.js") || files.includes("next.config.mjs")) {
			return {
				name: "nextjs-app",
				type: "single-package",
				frameworks: ["nextjs"],
				features: { typescript: true, testing: true },
				gitInit: true,
			};
		}

		// Detect Node TypeScript
		if (files.includes("package.json") && files.includes("tsconfig.json")) {
			return {
				name: "node-app",
				type: "single-package",
				frameworks: ["node", "typescript"],
				features: { typescript: true, testing: true, eslint: true },
				gitInit: true,
			};
		}

		return null;
	} catch {
		return null;
	}
}
