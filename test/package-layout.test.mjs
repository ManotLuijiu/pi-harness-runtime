/**
 * The published package must carry the plugin and the package's own skill,
 * and it must not carry a private skill payload or a local state directory.
 *
 * The history of this repository shipped three things it should not ship:
 *
 *   1. the `.pi/` directory (per-machine extension state and private skills),
 *   2. the private skill payloads (skill content lives in the user's own
 *      Qdrant collection and in the installation-local skill store), and
 *   3. the plugin, which was read from `.pi/plugins/` - a directory that is
 *      not committed, so the plugin only reached an installation when the
 *      release happened to run on a machine that had it.
 *
 * The plugin now lives in `plugins/`, which is committed and published.
 *
 * `skills/harness-runtime/` stays: it is the skill of the package itself, it
 * is written for every user of the package, and it is public content. Every
 * other directory under `skills/` belongs to a user and is never committed.
 *
 * The boundary itself is checked against the exact file list npm produces.
 * The allowlist in the manifest is an intention; the tarball is the fact.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** The paths that must never be committed and never be published. */
const FORBIDDEN_PREFIXES = [
	".pi/",
	".pi-lens/",
	".agents/skills/",
	".claude/skills/",
];

/** The one skill directory the package owns and publishes. */
const PACKAGE_SKILL_DIR = "skills/harness-runtime/";

/** The skill files the package must ship. */
const REQUIRED_SKILL_FILES = ["skills/harness-runtime/SKILL.md"];

/** The plugin files the package must ship. */
const REQUIRED_PLUGIN_FILES = [
	"plugins/herdr-clipboard/herdr-plugin.toml",
	"plugins/herdr-clipboard/paste.sh",
	"plugins/herdr-clipboard/start-bridge.sh",
	"plugins/herdr-clipboard/tmux-watch.sh",
];

/**
 * The scripts the published package ships.
 *
 * A script is a program, and a program is only published when the runtime
 * needs it: the postinstall copies the plugin, the skills package spawns the
 * sync script, the skill hints name the qdrant sync, and the clipboard login
 * names the gist poller. The release orchestration, the npm cleanup tooling,
 * the type checker and the test and debug programs belong to the repository.
 */
const REQUIRED_RUNTIME_SCRIPTS = [
	"scripts/copy-plugins.js",
	"scripts/sync-skills.ts",
	"scripts/sync-to-qdrant.ts",
	"scripts/gist-poll.sh",
];

/**
 * The packages that must never be published.
 *
 * `e2e-tester` duplicated `webmcp-tester`: the same API, added in the same
 * commit, with no production importer and a readme that documents an export
 * the package does not have.
 */
const FORBIDDEN_PACKAGES = ["packages/e2e-tester"];

/** The documentation the published package ships. */
const ALLOWED_PUBLISHED_MARKDOWN = new Set([
	"README.md",
	"CHANGELOG.md",
	"AGENTS.md",
	"RULES.md",
	"SECURITY.md",
	"prompts/agents/reviewer.md",
	"prompts/agents/writer.md",
	"prompts/slash-commands.md",
	"prompts/tencentdb-connect.md",
	"prompts/tencentdb-setup.md",
	"prompts/tencentdb.md",
	"prompts/write-review.md",
	"skills/harness-runtime/SKILL.md",
]);

function trackedFiles() {
	const out = execFileSync("git", ["ls-files"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	return out.split("\n").filter(Boolean);
}

/** Whether a path is a skill payload the package must not publish. */
function isForbiddenSkillPath(file) {
	if (!file.startsWith("skills/")) return false;
	return !file.startsWith(PACKAGE_SKILL_DIR);
}

/** The exact file list npm would publish. */
let publishedFileList = null;
function publishedFiles() {
	// The list is the same for every check, and packing is slow, so it is
	// taken once.
	if (publishedFileList) return publishedFileList;
	const out = execFileSync(
		"npm",
		["pack", "--dry-run", "--json", "--ignore-scripts"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	const parsed = JSON.parse(out);
	const entries = Array.isArray(parsed) ? parsed : [parsed];
	publishedFileList = entries
		.flatMap((entry) => entry?.files ?? [])
		.map((file) => file.path);
	return publishedFileList;
}

test("the package allowlist ships the plugin and the package's own skill", () => {
	const files = manifest.files ?? [];

	assert.ok(
		files.some((entry) => entry === "/plugins/**/*" || entry === "plugins/**/*"),
		"the plugin directory must be in the files allowlist",
	);
	assert.ok(
		files.some(
			(entry) =>
				entry === "/skills/harness-runtime/**/*" ||
				entry === "skills/harness-runtime/**/*",
		),
		"the package's own skill must be in the files allowlist",
	);
	assert.ok(
		!files.some((entry) => entry.startsWith(".pi/")),
		"the .pi directory must not be in the files allowlist",
	);
	assert.ok(
		!files.some(
			(entry) => entry === "skills/**/*" || entry === "/skills/**/*",
		),
		"the whole skills directory must not be in the files allowlist - only the package's own skill",
	);
});

test("the package allowlist names only the runtime scripts", () => {
	const files = manifest.files ?? [];
	const scriptEntries = files.filter((entry) =>
		entry.replace(/^\//, "").startsWith("scripts/"),
	);

	assert.deepEqual(
		scriptEntries.map((entry) => entry.replace(/^\//, "")),
		REQUIRED_RUNTIME_SCRIPTS,
		"the allowlist must name exactly the scripts the runtime needs",
	);
});

test("the package allowlist does not use a basename-only markdown pattern", () => {
	// npm matches a pattern without a slash against the basename at every
	// depth, so `*.md` would ship the markdown of every directory. The
	// documentation of the package is named file by file instead.
	const files = manifest.files ?? [];
	const basenamePatterns = files.filter((entry) => /(^|\/)\*\.mdx?$/.test(entry));

	assert.deepEqual(
		basenamePatterns,
		[],
		"a basename-only markdown pattern would publish the documents of every directory",
	);
});

test("the package declares the skill directory to pi", () => {
	// `pi.skills` tells pi where to find the skills of the package. The
	// package ships exactly one, and this is where it lives.
	assert.deepEqual(
		manifest.pi?.skills,
		["./skills"],
		"pi.skills must point at the directory that holds the package's own skill",
	);
});

test("no private skill payload and no local state is tracked by git", () => {
	const tracked = trackedFiles();
	const offenders = tracked.filter(
		(file) =>
			FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
			isForbiddenSkillPath(file),
	);
	assert.deepEqual(
		offenders,
		[],
		`these paths must not be committed: ${offenders.join(", ")}`,
	);
});

test("the package's own skill is tracked with the files it needs", () => {
	const tracked = new Set(trackedFiles());
	for (const required of REQUIRED_SKILL_FILES) {
		assert.ok(tracked.has(required), `${required} must be tracked`);
		assert.ok(existsSync(join(ROOT, required)), `${required} must exist`);
	}
});

test("the plugin is tracked with every file it needs", () => {
	const tracked = new Set(trackedFiles());
	for (const required of REQUIRED_PLUGIN_FILES) {
		assert.ok(tracked.has(required), `${required} must be tracked`);
		assert.ok(existsSync(join(ROOT, required)), `${required} must exist`);
	}
});

test("the postinstall copies the plugin from the committed directory", () => {
	const script = readFileSync(join(ROOT, "scripts", "copy-plugins.js"), "utf8");
	assert.match(
		script,
		/join\(__dirname,\s*"\.\.",\s*"plugins"\)/,
		"the copy script must read from the plugins/ directory",
	);
	assert.doesNotMatch(
		script,
		/"\.pi"/,
		"the copy script must not read from the .pi directory",
	);
});

test("the ignore rules keep the local directories out of the index", () => {
	const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
	const lines = gitignore.split("\n").map((line) => line.trim());

	for (const rule of [".pi/", ".pi-lens/", "/skills/*", "/.agents/skills/"]) {
		assert.ok(
			lines.includes(rule),
			`the .gitignore must contain "${rule}"`,
		);
	}
});

test("the ignore rules let the package's own skill through", () => {
	const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
	assert.ok(
		gitignore.split("\n").map((line) => line.trim()).includes("!/skills/harness-runtime/"),
		"the .gitignore must un-ignore the package's own skill",
	);
});

test("the ignore rules still protect the private release skill", () => {
	const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
	assert.match(
		gitignore,
		/\.pi\/skills\/release\/\*/,
		"the private release skill must stay ignored",
	);
});

test("the published tarball ships the runtime scripts and no other script", () => {
	const files = publishedFiles();
	const shipped = files.filter((file) => file.startsWith("scripts/"));

	assert.deepEqual(
		shipped.sort(),
		[...REQUIRED_RUNTIME_SCRIPTS].sort(),
		"the published package ships exactly the runtime scripts",
	);
});

test("the published tarball ships the product documentation only", () => {
	const files = publishedFiles();
	const documents = files.filter((file) => file.endsWith(".md"));
	const offenders = documents.filter((file) => !ALLOWED_PUBLISHED_MARKDOWN.has(file));

	assert.deepEqual(
		offenders,
		[],
		`these documents must not be published: ${offenders.join(", ")}`,
	);
});

test("the published tarball carries no duplicate package, no test and no nested dependency", () => {
	const files = publishedFiles();
	const offenders = files.filter(
		(file) =>
			FORBIDDEN_PACKAGES.some((name) => file.startsWith(`${name}/`)) ||
			file.includes("/node_modules/") ||
			/^packages\/[^/]+\/(tests?|__tests__)\//.test(file),
	);

	assert.deepEqual(
		offenders,
		[],
		`these files must not be published: ${offenders.join(", ")}`,
	);
});

test("the published tarball still ships the skill and the plugin", () => {
	const files = new Set(publishedFiles());
	for (const required of [...REQUIRED_SKILL_FILES, ...REQUIRED_PLUGIN_FILES]) {
		assert.ok(files.has(required), `${required} must be in the tarball`);
	}
});

test("every script of the manifest names a file the consumer receives", () => {
	const files = new Set(publishedFiles());
	const fileToken = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+$/;

	for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
		for (const token of command.split(/\s+/)) {
			if (!fileToken.test(token)) continue;
			const path = token.replace(/^\.\//, "");
			assert.ok(
				files.has(path),
				`the script "${name}" names ${path}, which the consumer does not receive`,
			);
		}
	}
});

test("the duplicate tester package is gone and the working one stays", () => {
	assert.ok(
		!existsSync(join(ROOT, "packages", "e2e-tester")),
		"packages/e2e-tester duplicates packages/webmcp-tester and must not exist",
	);
	assert.ok(
		existsSync(join(ROOT, "packages", "webmcp-tester", "src", "index.ts")),
		"packages/webmcp-tester is the working tester and must stay",
	);
});
