/**
 * The policy of the copy of the workspace.
 *
 * The copy of the workspace is what a worker of another vendor sees. A
 * file of the copy is a file that another program may read, and the
 * program is not the harness. So the copy holds the work of the project
 * and not the secrets of the machine.
 *
 * The rules are explicit and shared: the copy of a consult and the copy
 * of a write lane are made by the same rules, so the write lane cannot
 * reach a file that the consult could not see either.
 *
 * Three kinds of rules:
 *
 * - The names that never go into the copy: the environment files, the
 *   credentials, the keys, the logs and the runtime directories.
 * - The templates that are allowed: a project needs the shape of its
 *   environment file, and a template holds no secret.
 * - The files that git ignores: they are private by the decision of the
 *   project, and a worker of another vendor does not need them. The
 *   documentation of this repository is ignored, so it stays out of the
 *   copy as well.
 *
 * A path that is named in the include list is taken into the copy even
 * when a rule would leave it out. The include list is a decision of the
 * human and it is narrow: one path, one purpose.
 */

import { execFileSync } from "node:child_process";
import { basename, relative, sep } from "node:path";

/**
 * The names that are never part of the copy.
 *
 * The rule is on the name of the entry, not on its place: a key is a key
 * wherever it is found.
 */
const EXCLUDED_NAMES = new Set([
	// The version control and the dependencies.
	".git",
	"node_modules",
	// The environment of the project. A `.env` holds the secrets of the
	// project, and the worker of another vendor has no need for it.
	".env",
	".env.local",
	".env.development",
	".env.development.local",
	".env.production",
	".env.production.local",
	".env.test",
	".env.test.local",
	// The configuration of the package managers holds a token.
	".npmrc",
	".yarnrc",
	".yarnrc.yml",
	".pypirc",
	".netrc",
	".git-credentials",
	// The keys of the machine and of the cloud.
	".ssh",
	".gnupg",
	".aws",
	".azure",
	".kube",
	".docker",
	".pi-harness-runtime",
	".gcloud",
	// The caches and the build output.
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".cache",
	".turbo",
	".next",
	".nuxt",
	".tox",
	".gradle",
	"coverage",
	"dist",
	"build",
	"target",
	// The runtime of the harness and the logs of the project.
	"logs",
	"log",
]);

/**
 * The names that may be part of the copy although they look excluded.
 *
 * A template of the environment file is a shape, not a secret: the
 * project needs it to know which names it expects.
 */
const ALLOWED_NAMES = new Set([
	".env.example",
	".env.sample",
	".env.template",
	".env.dist",
]);

/**
 * The suffixes of the files that never go into the copy.
 */
const EXCLUDED_SUFFIXES = [
	".pem",
	".key",
	".p12",
	".pfx",
	".jks",
	".keystore",
	".log",
	".secret",
];

/**
 * The names that hold a secret, whatever their suffix.
 */
const EXCLUDED_SECRET_NAMES = new Set([
	"credentials",
	"credentials.json",
	"secrets.json",
	"secret.json",
	"htpasswd",
	"id_rsa",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
]);

/**
 * The paths that the human named, and that go into the copy although a
 * rule would leave them out.
 */
function includePaths(env: Record<string, string | undefined>): string[] {
	const raw = env.PI_AGENT_COMMUNICATION_STAGE_INCLUDE ?? "";
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.split("/").join(sep));
}

/**
 * Is the name one of the excluded names?
 */
function excludedName(name: string): boolean {
	if (ALLOWED_NAMES.has(name)) return false;
	if (EXCLUDED_NAMES.has(name)) return true;
	if (EXCLUDED_SECRET_NAMES.has(name.toLowerCase())) return true;
	const lower = name.toLowerCase();
	return EXCLUDED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * The files that git ignores in a workspace.
 *
 * The list is the decision of the project about what is private. A
 * workspace that is not a repository has no ignored files.
 */
function ignoredPaths(root: string): string[] {
	try {
		const output = execFileSync(
			"git",
			["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
			{
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				maxBuffer: 8 * 1024 * 1024,
			},
		);
		return output
			.split("\n")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
			.map((entry) => entry.split("/").join(sep));
	} catch {
		// A workspace without git, or without the git of the user, has no
		// ignored files. The name rules still hold.
		return [];
	}
}

/**
 * The policy of the copy of a workspace.
 */
export interface StagingPolicy {
	/**
	 * Does the path go into the copy?
	 *
	 * The path is relative to the root of the workspace and uses the
	 * separator of the machine.
	 */
	allows(relativePath: string): boolean;
	/** The rules that were applied, for the record of the job. */
	readonly summary: string;
}

/**
 * The policy of the copy of a workspace.
 */
export function stagingPolicy(
	root: string,
	env: Record<string, string | undefined> = {},
): StagingPolicy {
	const ignored = ignoredPaths(root);
	const ignoredSet = new Set(ignored);
	const included = includePaths(env);

	const allows = (relativePath: string): boolean => {
		if (relativePath.length === 0) return true;
		const normalized = relativePath.split("/").join(sep);
		// A path that the human named is taken into the copy.
		for (const entry of included) {
			if (normalized === entry || normalized.startsWith(`${entry}${sep}`)) return true;
		}
		const name = basename(normalized);
		// The rule of the name holds on every part of the path: a key in a
		// directory is a key.
		const parts = normalized.split(sep).filter((part) => part.length > 0);
		for (const part of parts) {
			if (excludedName(part)) return false;
		}
		if (excludedName(name)) return false;
		// A file that git ignores is private by the decision of the
		// project.
		for (const entry of ignoredSet) {
			if (normalized === entry || normalized.startsWith(`${entry}${sep}`)) return false;
			// The listing of git may name a file inside an ignored
			// directory.
			if (entry.startsWith(`${normalized}${sep}`)) return false;
		}
		return true;
	};

	const summary = ignoredSet.size > 0
		? `the copy leaves out the files that git ignores (${ignoredSet.size}) and the names that hold a secret`
		: "the copy leaves out the names that hold a secret";

	return { allows, summary };
}

/**
 * The path of a file relative to the root of the workspace.
 */
export function relativeTo(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}
