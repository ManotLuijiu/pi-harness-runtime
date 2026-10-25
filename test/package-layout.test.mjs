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

test("the package allowlist ships the plugin and the package's own skill", () => {
	const files = manifest.files ?? [];

	assert.ok(
		files.includes("plugins/**/*"),
		"the plugin directory must be in the files allowlist",
	);
	assert.ok(
		files.includes("skills/harness-runtime/**/*"),
		"the package's own skill must be in the files allowlist",
	);
	assert.ok(
		!files.some((entry) => entry.startsWith(".pi/")),
		"the .pi directory must not be in the files allowlist",
	);
	assert.ok(
		!files.some((entry) => entry === "skills/**/*"),
		"the whole skills directory must not be in the files allowlist - only the package's own skill",
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
