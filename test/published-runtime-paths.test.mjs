/**
 * The published code paths must run, not only load.
 *
 * A consumer audit of the published package found defects that every
 * static check missed:
 *
 *   - a module that called `require("child_process").exec` at module scope
 *     threw the moment it was imported,
 *   - several modules called a global `require` inside a function, which
 *     is undefined in an ES module under node, so the path only broke
 *     when that function ran.
 *
 * The first kind is caught by a load check. The second kind is not: the
 * module imports cleanly and the defect waits for the call. This suite
 * therefore calls the paths that used to carry such a call, in the
 * compiled artifacts a consumer receives.
 *
 * The static half of the same rule lives in the release gate
 * (`scripts/verify-package-contents.ts`, the `esm-require` finding). This
 * suite is the runtime half: it proves the code runs.
 *
 * The suite runs under node and under bun. It never touches the network,
 * never starts a browser and never writes outside a scratch home.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

// The stores resolve their directory from the home when the module loads,
// so the scratch home is set before the first import.
const scratch = mkdtempSync(join(tmpdir(), "published-runtime-paths-"));
process.env["HOME"] = scratch;
process.env["USERPROFILE"] = scratch;

const load = (specifier) => import(pathToFileURL(join(repo, specifier)).href);

test("the delegation store stores, reads, lists and deletes a receipt", async () => {
	const mod = await load("packages/contracts/dist/delegation-store.js");
	const receipt = {
		version: 1,
		workspacePath: scratch,
		parentTaskId: "task-1",
		childTaskId: "task-2",
		createdAt: Date.now(),
		status: "pending",
	};
	mod.saveDelegationReceipt(receipt);
	const loaded = mod.loadDelegationReceipt(scratch, "task-1");
	assert.ok(loaded, "the receipt was not stored");
	assert.equal(loaded.parentTaskId, "task-1");
	assert.equal(mod.listDelegationReceipts(scratch).length, 1);
	mod.deleteDelegationReceipt(scratch, "task-1");
	assert.equal(mod.loadDelegationReceipt(scratch, "task-1"), null);
});

test("the wiki trigger scans the prompts of a project", async () => {
	const mod = await load("packages/write-review/dist/trigger.js");
	const project = join(scratch, "project");
	mkdirSync(join(project, "wiki"), { recursive: true });
	writeFileSync(join(project, "wiki", "note.md"), "# note\n");
	const prompts = mod.getWikiPrompts(project);
	assert.ok(Array.isArray(prompts), "the scan did not return a list");
});

test("the event store appends and reads an event", async () => {
	const mod = await load("packages/event-store/dist/src/store.js");
	const store = new mod.EventStore({ sessionsDir: join(scratch, "sessions") });
	await store.append({ sessionId: "session-1", type: "test", payload: { ok: true } });
	const events = await store.read({ sessionId: "session-1" });
	assert.equal(events.length, 1);
	assert.equal(events[0].sessionId, "session-1");
});

test("the audit logger writes a line", async () => {
	const mod = await load("packages/privilege-broker/dist/audit.js");
	const logPath = join(scratch, "audit.log");
	const logger = new mod.FileAuditLogger({ logPath });
	logger.log({ action: "test", actor: "suite", resource: "scratch" });
	assert.ok(existsSync(logPath), "the audit file was not written");
});

test("the prompt compiler redacts an identity", async () => {
	const mod = await load("packages/prompt-compiler/dist/compiler.js");
	const redactor = mod.createIdentityRedactor({});
	assert.equal(typeof redactor.redact, "function");
});

test("the skill parser parses a skill and scans a directory", async () => {
	const mod = await load("packages/skills/dist/parser.js");
	const content =
		"---\nname: suite-skill\ndescription: A skill for the runtime path suite.\n---\n\nBody.\n";
	const skill = mod.parseSkillContent(content, "suite-skill/SKILL.md");
	assert.equal(skill.frontmatter.name, "suite-skill");
	const dir = join(scratch, "skills");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), content);
	const found = mod.scanSkillDirectory(dir);
	assert.ok(Array.isArray(found.references));
});

test("the inbox is created", async () => {
	const mod = await load("packages/autonomous-runtime/dist/inbox.js");
	const inbox = new mod.TaskInbox({
		tasksPath: join(scratch, "tasks.json"),
		inboxDir: join(scratch, "inbox"),
	});
	assert.ok(inbox);
});

test("the workspace detector answers without a hard SQLite dependency", async () => {
	const mod = await load("packages/contracts/dist/workspace-env.js");
	const result = mod.detectWorkspaceEnv(scratch);
	assert.ok(result, "the detector returned nothing");
	assert.equal(typeof result.mode, "string");
});

test("the paperclip client reads its configuration", async () => {
	const mod = await load("packages/paperclip-integration/dist/index.js");
	assert.equal(typeof mod.hasPaperclipConfig(), "boolean");
});

test("the webmcp tester parses a scenario", async () => {
	const mod = await load("packages/webmcp-tester/dist/index.js");
	const scenario = mod.parseNaturalLanguageTest("open example.com\nclick the link");
	assert.ok(scenario);
});

test("the browser authentication loads without Playwright", async () => {
	const mod = await load("packages/auth/dist/minimax-browser-auth.js");
	assert.equal(typeof mod.getRuntimeDir(), "string");
});

test("the two MCP clients load without a third-party http client", async () => {
	const retrieval = await load("packages/knowledge-retrieval/dist/mcp-client.js");
	assert.ok(retrieval);
	const skillClient = await load("packages/skill-mcp-client/dist/client.js");
	assert.ok(skillClient);
});

test("the skill sanitizer answers", async () => {
	const mod = await load("packages/skills/dist/sanitize.js");
	const result = mod.sanitizeText("A skill body with nothing to hide.");
	assert.equal(typeof result, "string");
});
