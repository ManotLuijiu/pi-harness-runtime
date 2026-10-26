/**
 * The registry refuses a removal with a browser approval whose URL embeds
 * credential material.
 *
 * The approval URL must never reach a log (it is masked) and must never
 * reach a run artifact (the repository is public, so the artifact would
 * publish the token). It has to be opened in a terminal instead, which is
 * what `scripts/npm-unpublish-with-approval.sh` does: it captures the
 * challenge, prints the link, polls the registry until the approval lands,
 * refreshes the credential and carries on.
 *
 * The test stands a fake npm and a fake registry up against the script.
 * The fakes are executables in a temporary directory that is placed first
 * on PATH, so nothing global is replaced and the script runs exactly as it
 * runs in a terminal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const script = join(repo, "scripts", "npm-unpublish-with-approval.sh");

function fakeBin(dir, name, body) {
	const path = join(dir, name);
	writeFileSync(path, body);
	chmodSync(path, 0o755);
	return path;
}

/**
 * A workspace with a fake npm, a fake curl and an isolated home.
 *
 * The fake npm refuses the first removal with a challenge and accepts the
 * rest. The fake curl answers the polling URL with an approved token.
 */
function workspace(options = {}) {
	const dir = mkdtempSync(join(tmpdir(), "npm-approval-test-"));
	const bin = join(dir, "bin");
	const home = join(dir, "home");
	mkdirSync(bin, { recursive: true });
	mkdirSync(join(home, ".pi-harness-runtime", "keys"), { recursive: true });

	fakeBin(
		bin,
		"npm",
		`#!/usr/bin/env bash
if [ "$1" = "unpublish" ]; then
  state="${dir}/state"
  if [ ! -f "$state" ]; then
    touch "$state"
    cat >&2 <<'ERR'
npm error code EOTP
npm error This operation requires a one-time password.
npm error Open this URL in your browser to authenticate:
npm error   https://www.npmjs.com/auth/cli/FAKE-CHALLENGE-ID
npm error
npm error After authenticating, your token can be retrieved from:
npm error   https://registry.npmjs.org/-/v1/done?authId=FAKE-CHALLENGE-ID
ERR
    exit 1
  fi
  exit 0
fi
exit 0
`,
	);

	fakeBin(
		bin,
		"curl",
		options.approval === "never"
			? `#!/usr/bin/env bash
# An approval that never lands: the registry keeps answering that the
# request is not done yet.
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ]; then
  printf '{}' > "$out"
fi
printf '404'
`
			: `#!/usr/bin/env bash
# The script reads the body from the file it names with -o and the status
# code from the -w format, so the fake has to honour both. An earlier
# version of this fake ignored -o and wrote the body to a file of its
# own, which left the script reading a file that nobody wrote - and the
# test only passed because a stale file from an earlier run was lying
# around in /tmp.
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ]; then
  printf '{"token":"npm_fake_approved_token"}' > "$out"
else
  printf '{"token":"npm_fake_approved_token"}'
fi
printf '200'
`,
	);

	return {
		dir,
		bin,
		home,
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			HOME: home,
			NPM_CONFIG_USERCONFIG: join(dir, "npmrc"),
			NPM_TOKEN_FILE: join(home, ".pi-harness-runtime", "keys", "npm-token.txt"),
			APPROVAL_WAIT: options.approval === "never" ? "6" : "20",
		},
	};
}

function run(ws, ...args) {
	try {
		const stdout = execFileSync("bash", [script, ...args], {
			env: { ...process.env, ...ws.env },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, stdout };
	} catch (error) {
		return {
			code: typeof error.status === "number" ? error.status : 1,
			stdout: `${error.stdout ?? ""}${error.stderr ?? ""}`,
		};
	}
}

/**
 * Every test in this file starts a shell script, a fake npm and a fake
 * curl. The runner's default per-test timeout is five seconds, which is
 * enough on a fast machine and not enough on a slow one - the batch test
 * polls the registry between attempts, so it needs more than that.
 *
 * The timeout is therefore stated per test rather than left to the
 * default, and it is stated for every test so that a slow runner never
 * decides which assertion runs.
 */
const TEST_TIMEOUT_MS = 60_000;

test("a removal without any credential is refused", { timeout: TEST_TIMEOUT_MS }, () => {
	const ws = workspace();
	const result = run(ws, "request", "pi-harness-runtime", "1.1.390");
	assert.notEqual(result.code, 0);
	assert.match(result.stdout, /no credential/);
});

test("the challenge is captured and the link is printed", { timeout: TEST_TIMEOUT_MS }, () => {
	const ws = workspace();
	writeFileSync(ws.env.NPM_TOKEN_FILE, "npm_fake_repository_token\n");

	const result = run(ws, "request", "pi-harness-runtime", "1.1.390");
	assert.equal(result.code, 42, result.stdout);
	assert.match(result.stdout, /https:\/\/www\.npmjs\.com\/auth\/cli\/FAKE-CHALLENGE-ID/);

	// The credential reached the npmrc, and the approval URL was kept.
	const npmrc = readFileSync(ws.env.NPM_CONFIG_USERCONFIG, "utf8");
	assert.match(npmrc, /_authToken=npm_fake_repository_token/);
	assert.ok(existsSync("/tmp/npm-approval/url.txt"));
	assert.match(readFileSync("/tmp/npm-approval/url.txt", "utf8"), /FAKE-CHALLENGE-ID/);
});

test("the approval refreshes the credential", { timeout: TEST_TIMEOUT_MS }, () => {
	const ws = workspace();
	writeFileSync(ws.env.NPM_TOKEN_FILE, "npm_fake_repository_token\n");
	run(ws, "request", "pi-harness-runtime", "1.1.390");

	const result = run(ws, "wait", "pi-harness-runtime", "1.1.390", "20");
	assert.equal(result.code, 0, result.stdout);
	const npmrc = readFileSync(ws.env.NPM_CONFIG_USERCONFIG, "utf8");
	assert.match(npmrc, /_authToken=npm_fake_approved_token/);
});

test("the approved token does not outlive the approval", { timeout: TEST_TIMEOUT_MS }, () => {
	const ws = workspace();
	writeFileSync(ws.env.NPM_TOKEN_FILE, "npm_fake_repository_token\n");
	run(ws, "request", "pi-harness-runtime", "1.1.390");
	run(ws, "wait", "pi-harness-runtime", "1.1.390", "20");

	// The registry hands the approved token back in the body of the
	// polling response. That body is a credential, so it must be gone
	// once the token has been read - a file in /tmp that survives the run
	// leaves a usable npm credential on a shared machine.
	assert.ok(
		!existsSync("/tmp/npm-approval/done-body.json"),
		"the approved token body is left behind",
	);
	// The older path must not be used either.
	assert.ok(!existsSync("/tmp/npm-done.json"), "a credential body is left in /tmp");
});

test("a batch removes every version across an approval", { timeout: TEST_TIMEOUT_MS }, () => {
	const ws = workspace();
	writeFileSync(ws.env.NPM_TOKEN_FILE, "npm_fake_repository_token\n");

	const result = run(ws, "batch", "pi-harness-runtime", "1.1.390", "1.1.391");
	assert.equal(result.code, 0, result.stdout);
	assert.match(result.stdout, /OK: unpublished pi-harness-runtime@1\.1\.390/);
	assert.match(result.stdout, /OK: unpublished pi-harness-runtime@1\.1\.391/);
});

test("an approval that never arrives stops the batch instead of burning the window", { timeout: TEST_TIMEOUT_MS }, () => {
	// Nobody is watching the run, so the approval never arrives. Every
	// remaining version would face the same challenge and wait the same
	// fifteen minutes, so the batch stops at the first one that waits.
	// The removal windows close on their own; spending the rest of them
	// waiting removes nothing.
	const ws = workspace({ approval: "never" });
	writeFileSync(ws.env.NPM_TOKEN_FILE, "npm_fake_repository_token\n");
	const result = run(ws, "batch", "pi-harness-runtime", "1.1.390", "1.1.391", "1.1.392");

	assert.match(result.stdout, /The approval did not arrive, so the batch stops/);
	// Only the version that waited is reported as failed. The other two
	// were never attempted, so they are not failures.
	const failed = result.stdout.match(/^FAILED:/gm) ?? [];
	assert.equal(failed.length, 1, `expected one failed version, got ${failed.length}`);
	assert.match(result.stdout, /The versions that were not attempted are still published/);
});

test("the batch can be told to keep going after an unanswered approval", { timeout: TEST_TIMEOUT_MS }, () => {
	// The operator may want the run to try every version anyway. That is
	// the old behaviour and it is still available.
	const ws = workspace({ approval: "never" });
	writeFileSync(ws.env.NPM_TOKEN_FILE, "npm_fake_repository_token\n");
	ws.env.APPROVAL_ABORT = "0";
	const result = run(ws, "batch", "pi-harness-runtime", "1.1.390", "1.1.391");
	// With the override the batch carries on after the unanswered
	// approval: the first version is reported as failed and the second
	// is still attempted.
	const failed = result.stdout.match(/^FAILED:/gm) ?? [];
	assert.equal(failed.length, 1, `expected one failed version, got ${failed.length}`);
	assert.match(result.stdout, /OK: unpublished pi-harness-runtime@1\.1\.391/);
	assert.doesNotMatch(result.stdout, /The approval did not arrive, so the batch stops/);
});
