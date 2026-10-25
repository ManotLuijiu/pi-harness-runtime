/**
 * The published package must not carry a skill payload or a local state
 * directory, and it must carry the plugin that the postinstall copies.
 *
 * The history of this repository shipped three things it should not ship:
 *
 *   1. the `.pi/` directory (per-machine extension state and private skills),
 *   2. the skill payload directories (skill content lives in the user's own
 *      Qdrant collection and in the installation-local skill store), and
 *   3. the plugin, which was read from `.pi/plugins/` - a directory that is
 *      not committed, so the plugin only reached an installation when the
 *      release happened to run on a machine that had it.
 *
 * The plugin now lives in `plugins/`, which is committed and published. The
 * other two are gone from the index, from the package allowlist and from the
 * ignore rules.
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
	"skills/",
	".agents/skills/",
	".claude/skills/",
];

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

test("the package allowlist ships the plugin and not the skill payloads", () => {
	const files = manifest.files ?? [];

	assert.ok(
		files.includes("plugins/**/*"),
		"the plugin directory must be in the files allowlist",
	);
	assert.ok(
		!files.some((entry) => entry.startsWith(".pi/")),
		"the .pi directory must not be in the files allowlist",
	);
	assert.ok(
		!files.some((entry) => entry.startsWith("skills/")),
		"the root skills directory must not be in the files allowlist",
	);
});

test("the package declares no skill directory", () => {
	// `pi.skills` told pi to load skills from a directory of the package.
	// The package ships no skills, so the declaration would point at
	// nothing - or, worse, at a directory that a later install fills with
	// whatever happens to be on the machine.
	assert.equal(
		manifest.pi?.skills,
		undefined,
		"pi.skills must be gone because the package ships no skills",
	);
});

test("no skill payload and no local state is tracked by git", () => {
	const offenders = trackedFiles().filter((file) =>
		FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix)),
	);
	assert.deepEqual(
		offenders,
		[],
		`these paths must not be committed: ${offenders.join(", ")}`,
	);
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

	for (const rule of [".pi/", ".pi-lens/", "/skills/", "/.agents/skills/"]) {
		assert.ok(
			lines.includes(rule),
			`the .gitignore must contain "${rule}"`,
		);
	}
});

test("the ignore rules still protect the private release skill", () => {
	const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
	assert.match(
		gitignore,
		/\.pi\/skills\/release\/\*/,
		"the private release skill must stay ignored",
	);
});
