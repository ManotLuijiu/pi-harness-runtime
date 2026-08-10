/**
 * Project Bootstrap - RFC-0072
 *
 * Minimal template - bare project with package.json
 */

import type { ProjectSpec, Template } from "./types.js";

export const minimalTemplate: Template = {
	name: "minimal",
	description: "Bare project with package.json",
	async apply(spec: ProjectSpec, root: string): Promise<string[]> {
		const { writeFile, mkdir } = await import("fs/promises");
		const { join } = await import("path");

		const files: string[] = [];

		// package.json
		const packageJson = {
			name: spec.name,
			version: "0.1.0",
			description: spec.description || "",
			author: spec.author,
			license: spec.license || "MIT",
			private: spec.type === "monorepo",
			scripts: {
				build: 'echo "No build script"',
				test: 'echo "No tests"',
			},
		};

		await writeFile(
			join(root, "package.json"),
			JSON.stringify(packageJson, null, 2) + "\n",
		);
		files.push("package.json");

		// README.md
		const readme = `# ${spec.name}\n\n${spec.description || "A project."}\n`;
		await writeFile(join(root, "README.md"), readme);
		files.push("README.md");

		return files;
	},
};
