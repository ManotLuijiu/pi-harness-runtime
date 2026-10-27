/**
 * Tests for the key file audit.
 *
 * The startup summary must tell the user exactly how to create a missing key
 * file - the audit is what produces those `echo` commands.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, chmod, mkdir, symlink } from "node:fs/promises";
import { tmpdir, homedir as osHomedir } from "node:os";
import { join } from "node:path";

import {
	auditKeyFiles,
	displayKeysDir,
	fallbackKeyFileFixes,
	formatExposedKeyFileFix,
	formatExposedKeyFileFixes,
	formatKeyFileFix,
	formatKeyFileFixes,
	formatKeyPermissionFix,
	formatKeyPermissionFixes,
	scanExposedKeyDirectories,
	scanExposedKeyFiles,
	selectKeyFileFixes,
	KEY_REQUIREMENTS,
} from "../harness/key-file-audit.ts";

async function makeKeysDir(files = {}) {
	const dir = await mkdtemp(join(tmpdir(), "key-audit-"));
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(dir, name), content, "utf8");
	}
	return dir;
}

test("reports the missing credentials of a feature with their fix command", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const telegram = audit.byFeature.get("Telegram");
		assert.ok(telegram, "the Telegram group is reported");
		const labels = telegram.map((entry) => entry.requirement.label);
		assert.ok(labels.includes("bot token"));
		assert.ok(labels.includes("chat id"));

		const fixes = formatKeyFileFixes(telegram, dir);
		assert.ok(
			fixes.some((fix) => fix.includes("telegram-bot-token.txt") && fix.includes("<TOKEN>")),
			`expected a bot token fix command, got ${JSON.stringify(fixes)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a non-empty key file satisfies the requirement", async () => {
	const dir = await makeKeysDir({ "telegram-bot-token.txt": "123:abc\n" });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const telegram = audit.byFeature.get("Telegram") ?? [];
		const labels = telegram.map((entry) => entry.requirement.label);
		assert.ok(!labels.includes("bot token"), "the bot token is satisfied by the file");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("an empty key file does not satisfy the requirement", async () => {
	const dir = await makeKeysDir({ "telegram-bot-token.txt": "   \n" });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const telegram = audit.byFeature.get("Telegram") ?? [];
		const entry = telegram.find((item) => item.requirement.label === "bot token");
		assert.ok(entry, "an empty file is still missing");
		assert.equal(entry.reason, "empty");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("an empty key file is marked as empty in its fix command", async () => {
	const dir = await makeKeysDir({ "telegram-bot-token.txt": "" });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const telegram = audit.byFeature.get("Telegram") ?? [];
		const fixes = formatKeyFileFixes(telegram, dir);
		const botTokenFix = fixes.find((fix) => fix.includes("telegram-bot-token.txt"));
		assert.ok(botTokenFix, "the bot token fix is listed");
		assert.match(botTokenFix, /empty/, `the reason is shown: ${botTokenFix}`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("an environment variable satisfies a requirement that reads the environment", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: { QDRANT_CLUSTER_ENDPOINT: "https://cluster.example" },
		});
		const qdrant = audit.byFeature.get("Qdrant") ?? [];
		const labels = qdrant.map((entry) => entry.requirement.label);
		assert.ok(!labels.includes("cluster endpoint"), "the env var satisfies the cluster endpoint");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the environment does not satisfy a credential the extension reads from a file only", async () => {
	// The Telegram init reads telegram-bot-token.txt from disk - an exported
	// TELEGRAM_BOT_TOKEN would not reach it, so the audit must still report
	// the file as missing (and the fix command is what the user needs).
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: { TELEGRAM_BOT_TOKEN: "123:abc" },
		});
		const telegram = audit.byFeature.get("Telegram") ?? [];
		const labels = telegram.map((entry) => entry.requirement.label);
		assert.ok(labels.includes("bot token"), "the bot token is still missing");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("an alternative candidate file satisfies the requirement", async () => {
	const dir = await makeKeysDir({ "telegram-webhook-secret.txt": "s3cret\n" });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const relay = audit.byFeature.get("Relay") ?? [];
		const labels = relay.map((entry) => entry.requirement.label);
		assert.ok(
			!labels.includes("auth token"),
			"the webhook secret also serves as the relay auth token",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the fix commands never contain a secret value", async () => {
	const dir = await makeKeysDir({
		// A satisfied credential and an unrelated file - neither value may
		// show up in a fix command for another credential.
		"telegram-bot-token.txt": "SECRET-BOT-TOKEN",
		"telegram-webhook-secret.txt": "SECRET-WEBHOOK-SECRET",
		"notes.txt": "SECRET-UNRELATED-NOTE",
	});
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const fixes = formatKeyFileFixes(audit.missing, dir);
		assert.ok(fixes.length > 0);
		for (const secret of ["SECRET-BOT-TOKEN", "SECRET-WEBHOOK-SECRET", "SECRET-UNRELATED-NOTE"]) {
			for (const fix of fixes) {
				assert.ok(!fix.includes(secret), `the fix leaked a value: ${fix}`);
			}
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the relay line offers the token and the endpoint files", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const fixes = formatKeyFileFixes(audit.byFeature.get("Relay"), dir);
		assert.ok(
			fixes.some((fix) => fix.includes("relay-auth-token.txt")),
			"the relay auth token file is offered",
		);
		assert.ok(
			fixes.some((fix) => fix.includes("telegram-webhook-secret.txt")),
			"the webhook secret is offered as the alternative token source",
		);
		assert.ok(
			fixes.some((fix) => fix.includes("relay-ws-url.txt")),
			"the relay websocket url file is offered",
		);
		assert.ok(
			fixes.some((fix) => fix.includes("telegram-webhook-url.txt")),
			"the telegram webhook url file is offered as the source of the relay url",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("no key file is offered by two features", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const seen = new Map();
		for (const entries of audit.byFeature.values()) {
			for (const fix of formatKeyFileFixes(entries, dir)) {
				const file = fix.slice(fix.lastIndexOf("/") + 1).split(" ")[0];
				assert.ok(!seen.has(file), `${file} is offered twice: ${seen.get(file)} and this one`);
				seen.set(file, fix);
			}
		}
		assert.ok(seen.size > 0, "the audit offers fixes");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the alternates of a credential are listed as their own command", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const jev = audit.byFeature.get("Jev") ?? [];
		const fixes = formatKeyFileFixes(jev, dir);
		assert.ok(
			fixes.some((fix) => fix.includes("typesafe-api-key.txt")),
			"the TypeSafe key file is offered",
		);
		assert.ok(
			fixes.some((fix) => fix.includes("openrouter-api-key.txt")),
			"the OpenRouter key file is offered",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the qdrant cluster fix names the file the runtime reads", async () => {
	// packages/skills/src/loader.ts reads qdrant-cluster-url.txt (the
	// key-loader mapping is only used by the langchain runner), so the fix
	// command must not create a file nothing reads.
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const qdrant = audit.byFeature.get("Qdrant") ?? [];
		const fixes = formatKeyFileFixes(qdrant, dir);
		assert.ok(
			fixes.some((fix) => fix.includes("qdrant-cluster-url.txt")),
			`the cluster url file is offered, got ${JSON.stringify(fixes)}`,
		);
		assert.ok(
			!fixes.some((fix) => fix.includes("qdrant-cluster-endpoint.txt")),
			"the unread cluster endpoint file is not offered",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("every requirement names a candidate file and a fix file", () => {
	for (const requirement of KEY_REQUIREMENTS) {
		assert.ok(requirement.feature, "the requirement has a feature");
		assert.ok(requirement.candidates.length > 0, `${requirement.label} has candidates`);
		assert.ok(
			requirement.candidates.includes(requirement.fixFile),
			`${requirement.label}: the fix file is one of the candidates`,
		);
		assert.ok(requirement.placeholder, `${requirement.label} has a placeholder`);
		for (const alternate of requirement.alternates ?? []) {
			assert.ok(
				requirement.candidates.includes(alternate.file),
				`${requirement.label}: the alternate ${alternate.file} is one of the candidates`,
			);
			assert.ok(alternate.placeholder, `${requirement.label}: the alternate has a placeholder`);
		}
	}
});

test("displayKeysDir replaces the home directory with a tilde", () => {
	const home = process.env.HOME || osHomedir();
	assert.equal(displayKeysDir(join(home, ".pi-harness-runtime", "keys")), join("~", ".pi-harness-runtime", "keys"));
	assert.equal(displayKeysDir("/opt/keys"), "/opt/keys");
});

test("selectKeyFileFixes narrows a feature to the named credentials", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const selected = selectKeyFileFixes(audit, "Telegram", ["bot token", "chat id"]);
		const labels = selected.map((entry) => entry.requirement.label);
		assert.deepEqual(labels.sort(), ["bot token", "chat id"]);

		const fixes = formatKeyFileFixes(selected, dir);
		assert.ok(fixes.some((fix) => fix.includes("telegram-bot-token.txt")));
		assert.ok(fixes.some((fix) => fix.includes("telegram-chat-id.txt")));
		assert.ok(
			!fixes.some((fix) => fix.includes("telegram-allowed-users.txt")),
			"the allowed user ids are not part of the narrowed selection",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("selectKeyFileFixes returns nothing for an unknown feature", async () => {
	const dir = await makeKeysDir();
	try {
		assert.deepEqual(selectKeyFileFixes(null, "DoesNotExist"), []);
		assert.deepEqual(selectKeyFileFixes(null, "Telegram"), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
test("a credential whose fix file is shared is only fixed once", async () => {
	const dir = await makeKeysDir();
	try {
		// Two credentials that share one fix file must not produce two
		// commands for the same file.
		const entries = [
			{
				requirement: {
					feature: "Test",
					label: "first",
					candidates: ["shared.txt"],
					fixFile: "shared.txt",
					placeholder: "<VALUE>",
				},
				file: "shared.txt",
				reason: "missing",
			},
			{
				requirement: {
					feature: "Test",
					label: "second",
					candidates: ["shared.txt"],
					fixFile: "shared.txt",
					placeholder: "<VALUE>",
				},
				file: "shared.txt",
				reason: "missing",
			},
		];
		const fixes = formatKeyFileFixes(entries, dir);
		assert.equal(fixes.length, 1, `one command per file, got ${JSON.stringify(fixes)}`);
		assert.ok(fixes[0].includes("shared.txt"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the fix commands contain a placeholder and never file content", async () => {
	const dir = await makeKeysDir({
		"telegram-bot-token.txt": "123:SECRET-BOT-TOKEN",
		"telegram-chat-id.txt": "SECRET-CHAT-ID",
		"typesafe-api-key.txt": "SECRET-TYPESAFE-KEY",
	});
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const fixes = formatKeyFileFixes(audit.missing, dir);
		assert.ok(fixes.length > 0, "there is something to fix");
		for (const fix of fixes) {
			// A fix is either a prose hint (where the credential comes from)
			// or a command with a placeholder - never the file content.
			if (!fix.startsWith("echo ")) continue;
			assert.match(
				fix,
				/^echo "<[^">]+>" > \S+$/,
				`the fix is a placeholder command only: ${fix}`,
			);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("only the primary file of an empty credential carries the empty note", async () => {
	const dir = await makeKeysDir({ "relay-auth-token.txt": "   " });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const relay = audit.byFeature.get("Relay") ?? [];
		const fixes = formatKeyFileFixes(relay, dir);
		const primary = fixes.find((fix) => fix.includes("relay-auth-token.txt"));
		const alternate = fixes.find((fix) => fix.includes("telegram-webhook-secret.txt"));
		assert.ok(primary, "the primary file is listed");
		assert.ok(alternate, "the alternate file is listed");
		assert.match(primary, /empty/, "the primary file is marked as empty");
		assert.ok(
			!alternate.includes("empty"),
			`the alternate is not marked as empty: ${alternate}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the telegram chat id file also satisfies the allowed user ids", async () => {
	// harness/telegram-auth.ts falls back to telegram-chat-id.txt when
	// telegram-allowed-users.txt is absent - the audit must not report a
	// missing allowlist in that case.
	const dir = await makeKeysDir({ "telegram-chat-id.txt": "123456\n" });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const telegram = audit.byFeature.get("Telegram") ?? [];
		const labels = telegram.map((entry) => entry.requirement.label);
		assert.ok(
			!labels.includes("allowed user ids"),
			`the chat id file satisfies the allowlist, got ${JSON.stringify(labels)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a key file the reader would reject does not satisfy the requirement", async () => {
	// packages/skills/src/loader.ts ignores a key file with 5 characters or
	// less - the audit must not call such a credential present.
	const dir = await makeKeysDir({ "qdrant-api-key.txt": "abc" });
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const qdrant = audit.byFeature.get("Qdrant") ?? [];
		const labels = qdrant.map((entry) => entry.requirement.label);
		assert.ok(
			labels.includes("API key"),
			`a too short key file does not satisfy the API key, got ${JSON.stringify(labels)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("an optional credential is not reported as missing", async () => {
	// The Paperclip integration has no startup line - a fix command for it
	// would never reach the user.
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const features = [...audit.byFeature.keys()];
		assert.ok(
			!features.includes("Paperclip"),
			`the optional credential is not reported, got ${JSON.stringify(features)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the hint of a credential is part of the fix list", async () => {
	const dir = await makeKeysDir();
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const telegram = audit.byFeature.get("Telegram") ?? [];
		const fixes = formatKeyFileFixes(telegram, dir);
		assert.ok(
			fixes.some((fix) => fix.includes("@BotFather")),
			`the hint reaches the user, got ${JSON.stringify(fixes)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the fallback lists the fix commands of a feature", async () => {
	const dir = await makeKeysDir();
	try {
		const fixes = fallbackKeyFileFixes("Telegram", ["bot token"], dir);
		assert.equal(fixes.length, 1);
		assert.match(fixes[0], /telegram-bot-token\.txt/);
		assert.match(fixes[0], /<TOKEN>/);
		assert.ok(
			!fixes.some((fix) => fix.includes("telegram-chat-id.txt")),
			"only the requested credential is listed",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the fix commands never contain a credential value", async () => {
	const secret = "super-secret-value-that-must-not-leak";
	const dir = await makeKeysDir({
		"telegram-bot-token.txt": secret,
		"relay-auth-token.txt": secret,
	});
	try {
		const audit = auditKeyFiles({ keysDir: dir, env: {} });
		const fixes = formatKeyFileFixes(audit.missing, dir);
		assert.ok(fixes.length > 0, "there is something to fix");
		for (const fix of fixes) {
			assert.ok(
				!fix.includes(secret),
				`the fix command leaks the credential: ${fix}`,
			);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("an allowed-user list of garbage does not satisfy the requirement", async () => {
	const dir = await makeKeysDir({ "telegram-allowed-users.txt": "not-an-id" });
	const audit = auditKeyFiles({ keysDir: dir, env: {} });
	const entry = audit.missing.find(
		(item) => item.requirement.feature === "Telegram" && item.requirement.label === "allowed user ids",
	);
	assert.ok(entry, "a list the reader cannot parse counts as missing");
	assert.equal(entry.reason, "invalid");
	assert.match(
		formatKeyFileFixes([entry], dir).find((fix) => fix.startsWith("echo ")) ?? "",
		/not accepted/,
	);
	await rm(dir, { recursive: true, force: true });
});

test("an allowed-user list with one usable id satisfies the requirement", async () => {
	const dir = await makeKeysDir({ "telegram-allowed-users.txt": "garbage, 1234567890" });
	const audit = auditKeyFiles({ keysDir: dir, env: {} });
	const entry = audit.missing.find(
		(item) => item.requirement.feature === "Telegram" && item.requirement.label === "allowed user ids",
	);
	assert.equal(entry, undefined);
	await rm(dir, { recursive: true, force: true });
});

test("the qdrant embedding key does not accept the key of another provider", async () => {
	// The embeddings endpoint of OpenAI accepts only an OpenAI key: a
	// TypeSafe or an OpenRouter key is a different credential.
	const dir = await makeKeysDir({});
	const audit = auditKeyFiles({
		keysDir: dir,
		env: { TYPESAFE_API_KEY: "a-key-from-the-environment" },
	});
	const entry = audit.missing.find(
		(item) => item.requirement.feature === "Qdrant" && item.requirement.label === "embedding key",
	);
	assert.ok(entry, "the key of another provider does not satisfy the requirement");
	assert.equal(entry.requirement.env, "OPENAI_API_KEY");
	await rm(dir, { recursive: true, force: true });
});

test("a credential is only listed once even when the key directory is relative", () => {
	// The de-duplication must not depend on the directory containing a "/".
	const entries = KEY_REQUIREMENTS.filter((requirement) => requirement.feature === "Telegram").map(
		(requirement) => ({
			requirement,
			file: requirement.fixFile,
			reason: "missing",
		}),
	);
	const fixes = formatKeyFileFixes(entries, "keys");
	const commands = fixes.filter((fix) => fix.startsWith("echo "));
	assert.equal(new Set(commands).size, commands.length, "no command is listed twice");
});

test("the LINE channel secret is optional and never reported", async () => {
	const dir = await makeKeysDir({});
	const audit = auditKeyFiles({ keysDir: dir, env: {} });
	const entry = audit.missing.find((item) => item.requirement.file === "line-channel-secret.txt");
	assert.equal(entry, undefined, "no startup line owns the channel secret");
	await rm(dir, { recursive: true, force: true });
});

test("a key file with a value the reader ignores counts as missing", async () => {
	// The skills loader ignores a key of five characters or less, so such a
	// file does not satisfy the requirement - it must not be reported as
	// "empty" either: the file holds something, just not enough.
	const dir = await makeKeysDir({ "qdrant-cluster-url.txt": "http" });
	const audit = auditKeyFiles({ keysDir: dir, env: {} });
	const entry = audit.missing.find(
		(item) => item.requirement.feature === "Qdrant" && item.requirement.label === "cluster endpoint",
	);
	assert.ok(entry, "a value the reader ignores counts as missing");
	assert.equal(entry.reason, "too short");
	const fix = formatKeyFileFixes([entry], dir).find((line) => line.startsWith("echo ")) ?? "";
	assert.match(fix, /not accepted/, `the reason is shown: ${fix}`);
	assert.ok(!/is empty/.test(fix), "the file is not empty, it is too short");
	await rm(dir, { recursive: true, force: true });
});

test("an environment value the reader would reject does not satisfy the requirement", async () => {
	// The reader applies the same check to the environment value as to the
	// file content - a list of garbage yields no usable id.
	const dir = "/tmp/does-not-exist-keys";
	const audit = auditKeyFiles({
		keysDir: dir,
		env: { TELEGRAM_ALLOWED_USERS: "not-an-id" },
		exists: () => false,
		readFile: () => undefined,
	});
	const entry = audit.missing.find(
		(item) => item.requirement.feature === "Telegram" && item.requirement.label === "allowed user ids",
	);
	assert.ok(entry, "a garbage list in the environment does not satisfy the requirement");
});

test("the fallback never overwrites a credential that is already there", async () => {
	// The runtime could not use the credential (a wrong key, a rate limit) -
	// the fallback must not offer an echo that would replace a working
	// secret with a placeholder.
	const dir = await makeKeysDir({ "typesafe-api-key.txt": "apikey_live_value_123456" });
	const fixes = fallbackKeyFileFixes("Jev", ["API key"], dir);
	assert.ok(fixes.length > 0, "the fallback says something");
	for (const fix of fixes) {
		assert.ok(
			!fix.startsWith("echo "),
			`the fallback does not overwrite an existing credential: ${fix}`,
		);
		assert.match(fix, /typesafe-api-key\.txt/, "the fallback points at the file");
	}
	await rm(dir, { recursive: true, force: true });
});

test("the fallback offers the command when the file is really missing", async () => {
	const dir = await makeKeysDir({});
	const fixes = fallbackKeyFileFixes("Jev", ["API key"], dir);
	assert.ok(
		fixes.some((fix) => fix.startsWith("echo ") && fix.includes("typesafe-api-key.txt")),
		`the fallback creates the missing file: ${JSON.stringify(fixes)}`,
	);
	await rm(dir, { recursive: true, force: true });
});

test("a relay url that the resolver would reject does not satisfy the requirement", () => {
	// The resolver rejects a URL that is not a ws:// or wss:// endpoint and one
	// that carries credentials or a query string.
	const dir = "/tmp/does-not-exist-keys";
	const rejected = ["not-a-url", "https://example.com/ws", "wss://user:pass@example.com/ws", "wss://example.com/ws?token=x"];
	for (const value of rejected) {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: { RELAY_WS_URL: value },
			exists: () => false,
			readFile: () => undefined,
		});
		const entry = audit.missing.find(
			(item) => item.requirement.feature === "Relay" && item.requirement.label === "WebSocket URL",
		);
		assert.ok(entry, `the rejected url counts as missing: ${value}`);
	}
	// The environment only accepts the ws endpoint itself.
	for (const value of ["ws://127.0.0.1:8444/ws", "wss://example.com/ws"]) {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: { RELAY_WS_URL: value },
			exists: () => false,
			readFile: () => undefined,
		});
		const entry = audit.missing.find(
			(item) => item.requirement.feature === "Relay" && item.requirement.label === "WebSocket URL",
		);
		assert.equal(entry, undefined, `the accepted url satisfies the requirement: ${value}`);
	}
});

test("the webhook url file may hold the https url the ws url is derived from", async () => {
	// telegram-webhook-url.txt holds the https URL - the resolver derives the
	// ws URL from it, so it satisfies the requirement.
	const dir = await makeKeysDir({ "telegram-webhook-url.txt": "https://example.com/telegram" });
	const audit = auditKeyFiles({ keysDir: dir, env: {} });
	const entry = audit.missing.find(
		(item) => item.requirement.feature === "Relay" && item.requirement.label === "WebSocket URL",
	);
	assert.equal(entry, undefined, "the webhook url satisfies the relay url requirement");
	await rm(dir, { recursive: true, force: true });
});

test("every feature of the audit can produce a fix command", () => {
	// The runtime guarantee behind the startup summary: when a feature
	// cannot resolve a credential, the summary must be able to show the
	// command that fixes it.
	const features = new Set(KEY_REQUIREMENTS.map((requirement) => requirement.feature));
	assert.ok(features.size >= 5, `the audit knows ${features.size} features`);
	for (const feature of features) {
		const entries = KEY_REQUIREMENTS.filter((requirement) => requirement.feature === feature)
			.map((requirement) => ({
				requirement,
				file: requirement.fixFile,
				reason: "missing",
			}));
		const fixes = formatKeyFileFixes(entries, "/home/user/.pi-harness-runtime/keys");
		assert.ok(
			fixes.some((fix) => /^echo "[^"]+" > /.test(fix)),
			`the ${feature} feature produces an echo command: ${JSON.stringify(fixes)}`,
		);
	}
});

test("a command for an existing file says that the file is replaced", () => {
	const fix = formatKeyFileFix(
		{
			requirement: KEY_REQUIREMENTS.find((requirement) => requirement.fixFile === "telegram-bot-token.txt"),
			file: "telegram-bot-token.txt",
			reason: "empty",
		},
		"/home/user/.pi-harness-runtime/keys",
	);
	assert.match(fix, /the file exists but is empty/);
	assert.match(fix, /replaces it/);
});

// The mode of a key file.
//
// A key file is a secret. The harness reads its own key files, so a file
// that the group or the others can read works perfectly - and is published
// to every account on the machine. Nothing else in the harness notices,
// because nothing fails.

test("a key file that other users can read is reported", async () => {
	const dir = await makeKeysDir({ "telegram-bot-token.txt": "123:abc\n" });
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: {},
			readdir: () => ["telegram-bot-token.txt"],
			stat: () => ({ mode: 0o644, isFile: true }),
		});
		assert.equal(audit.exposed.length, 1);
		assert.equal(audit.exposed[0].file, "telegram-bot-token.txt");
		assert.equal(audit.exposed[0].mode, "644");
		// 644 is the mode a key file usually ends up with: the group and
		// the others can read it.
		assert.equal(audit.exposed[0].readableBy, "group and others");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a key file that only the others can read names the others", async () => {
	const dir = await makeKeysDir({ "telegram-bot-token.txt": "123:abc\n" });
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: {},
			readdir: () => ["telegram-bot-token.txt"],
			stat: () => ({ mode: 0o604, isFile: true }),
		});
		assert.equal(audit.exposed[0].readableBy, "others");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a key file that only the owner can read is not reported", async () => {
	const dir = await makeKeysDir({ "telegram-bot-token.txt": "123:abc\n" });
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: {},
			readdir: () => ["telegram-bot-token.txt"],
			stat: () => ({ mode: 0o600, isFile: true }),
		});
		assert.deepEqual(audit.exposed, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a file that the group can read names the group", async () => {
	const dir = await makeKeysDir({ "openai-api-key.txt": "sk-example\n" });
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: {},
			readdir: () => ["openai-api-key.txt"],
			stat: () => ({ mode: 0o640, isFile: true }),
		});
		assert.equal(audit.exposed[0].readableBy, "group");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a file that everybody can read names both", async () => {
	const dir = await makeKeysDir({ "openai-api-key.txt": "sk-example\n" });
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: {},
			readdir: () => ["openai-api-key.txt"],
			stat: () => ({ mode: 0o646, isFile: true }),
		});
		assert.equal(audit.exposed[0].readableBy, "group and others");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a directory in the key directory is not a key file", async () => {
	const dir = await makeKeysDir();
	try {
		await mkdir(join(dir, "sub"), { recursive: true });
		const exposed = scanExposedKeyFiles({
			keysDir: dir,
			readdir: () => ["sub"],
			stat: () => ({ mode: 0o755, isFile: false }),
		});
		assert.deepEqual(exposed, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the mode of a real key file is what decides", async () => {
	const dir = await makeKeysDir({ "openai-api-key.txt": "sk-example\n" });
	try {
		await chmod(join(dir, "openai-api-key.txt"), 0o644);
		const exposed = scanExposedKeyFiles({ keysDir: dir });
		assert.equal(exposed.length, 1);
		assert.equal(exposed[0].file, "openai-api-key.txt");
		assert.equal(exposed[0].mode, "644");

		await chmod(join(dir, "openai-api-key.txt"), 0o600);
		assert.deepEqual(scanExposedKeyFiles({ keysDir: dir }), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a key file that other users can read gets a command that makes it private", async () => {
	const dir = await makeKeysDir({ "openai-api-key.txt": "sk-example\n" });
	try {
		const audit = auditKeyFiles({
			keysDir: dir,
			env: {},
			readdir: () => ["openai-api-key.txt"],
			stat: () => ({ mode: 0o644, isFile: true }),
		});
		const fixes = formatExposedKeyFileFixes(audit.exposed, dir);
		assert.equal(fixes.length, 1);
		assert.match(fixes[0], /^chmod 600 /);
		assert.match(fixes[0], /openai-api-key\.txt$/);
		// The command changes the mode, not the value.
		assert.equal(fixes[0].includes("sk-example"), false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a single key file gets a command of its own", () => {
	const fix = formatExposedKeyFileFix(
		{ file: "openai-api-key.txt", mode: "644", readableBy: "others" },
		"/home/user/.pi-harness-runtime/keys",
	);
	assert.equal(fix, "chmod 600 /home/user/.pi-harness-runtime/keys/openai-api-key.txt");
});

// The mode of the key directory.
//
// A directory of mode 755 hands the NAME of every key file to every
// account on the machine, and a nested directory does the same for the
// secrets below it. The key directory itself is therefore part of the
// audit - it is the directory the harness creates, so its mode is the
// mode the harness chose.

test("a key directory that others can read is reported", async () => {
	const dir = await makeKeysDir();
	try {
		await chmod(dir, 0o755);
		const directories = scanExposedKeyDirectories({ keysDir: dir });
		assert.equal(directories.length, 1);
		// The key directory itself is ".".
		assert.equal(directories[0].name, ".");
		assert.equal(directories[0].mode, "755");
		assert.equal(directories[0].readableBy, "group and others");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a private key directory is not reported", async () => {
	const dir = await makeKeysDir();
	try {
		await chmod(dir, 0o700);
		assert.deepEqual(scanExposedKeyDirectories({ keysDir: dir }), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a nested directory that others can reach is reported", async () => {
	const dir = await makeKeysDir();
	try {
		await mkdir(join(dir, "sub"), { recursive: true });
		await chmod(join(dir, "sub"), 0o755);
		await chmod(dir, 0o700);
		const directories = scanExposedKeyDirectories({ keysDir: dir });
		assert.equal(directories.length, 1);
		assert.equal(directories[0].name, "sub");
		assert.equal(directories[0].mode, "755");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a key file in a nested directory is audited", async () => {
	const dir = await makeKeysDir();
	try {
		await mkdir(join(dir, "sub"), { recursive: true });
		await writeFile(join(dir, "sub", "openai-api-key.txt"), "sk-example\n", "utf8");
		await chmod(join(dir, "sub", "openai-api-key.txt"), 0o644);
		await chmod(join(dir, "sub"), 0o700);
		await chmod(dir, 0o700);
		const exposed = scanExposedKeyFiles({ keysDir: dir });
		assert.equal(exposed.length, 1);
		assert.equal(exposed[0].file, "sub/openai-api-key.txt");
		assert.equal(exposed[0].mode, "644");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a symbolic link is never followed and never a key file", async () => {
	const dir = await makeKeysDir();
	try {
		await writeFile(join(dir, "secret.txt"), "sk-example\n", "utf8");
		await chmod(join(dir, "secret.txt"), 0o644);
		await symlink(join(dir, "secret.txt"), join(dir, "link.txt"));
		await chmod(dir, 0o700);
		const exposed = scanExposedKeyFiles({ keysDir: dir });
		// The link is not a second entry: only the file it points at.
		assert.equal(exposed.length, 1);
		assert.equal(exposed[0].file, "secret.txt");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a symbolic link to a directory is not walked", async () => {
	const dir = await makeKeysDir();
	try {
		await mkdir(join(dir, "real"), { recursive: true });
		await writeFile(join(dir, "real", "openai-api-key.txt"), "sk-example\n", "utf8");
		await chmod(join(dir, "real", "openai-api-key.txt"), 0o644);
		await chmod(join(dir, "real"), 0o755);
		await symlink(join(dir, "real"), join(dir, "linkdir"));
		await chmod(dir, 0o700);
		const directories = scanExposedKeyDirectories({ keysDir: dir });
		assert.ok(
			directories.every((entry) => entry.name !== "linkdir"),
			`a link is not a directory of the key tree: ${JSON.stringify(directories)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a missing key directory is not an exposure", async () => {
	const missing = join(tmpdir(), "key-audit-does-not-exist-4711");
	assert.deepEqual(scanExposedKeyFiles({ keysDir: missing }), []);
	assert.deepEqual(scanExposedKeyDirectories({ keysDir: missing }), []);
});

// The repair.
//
// The summary shows ONE command for the whole key tree. A list of one
// `chmod` per file is a list nobody runs, and a command that names every
// file is a command that breaks on the first file name with a space.

test("the repair of the key tree is one batch command", () => {
	const fixes = formatKeyPermissionFixes({
		keysDir: "/home/user/.pi-harness-runtime/keys",
		platform: "linux",
	});
	assert.equal(fixes.length, 1);
	const command = fixes[0];
	assert.match(command, /^chmod 700 /);
	assert.match(command, /-type d -exec chmod 700 \{\} \+/);
	assert.match(command, /-type f -exec chmod 600 \{\} \+/);
	// The command is one line, not a list.
	assert.equal(command.includes("\n"), false);
});

test("the batch command quotes the key directory", () => {
	const command = formatKeyPermissionFix(
		"/home/user/my keys/.pi-harness-runtime/keys",
		"linux",
	);
	assert.match(command, /'[^']*my keys/);
	// The name is inside the quotes, not outside.
	assert.equal(command.includes("/home/user/my keys/.pi-harness-runtime/keys'"), true);
});

test("a quote in the key directory cannot escape the command", () => {
	const command = formatKeyPermissionFix("/home/o'brien/keys", "linux");
	// The single quote is closed, escaped and opened again, so the shell
	// reads exactly one path.
	assert.equal(command.includes("'/home/o'\\''brien/keys'"), true);
	assert.equal(command.includes("; rm"), false);
});

test("Windows gets Windows guidance and no Unix command", () => {
	const fixes = formatKeyPermissionFixes({
		keysDir: "C:\\Users\\user\\.pi-harness-runtime\\keys",
		platform: "win32",
	});
	assert.ok(fixes.length >= 1);
	const text = fixes.join("\n");
	assert.equal(text.includes("chmod"), false);
	assert.match(text, /icacls/);
	assert.match(text, /Windows/);
});

test("the repair never names a value", () => {
	const command = formatKeyPermissionFix("/home/user/.pi-harness-runtime/keys", "linux");
	assert.equal(command.includes("sk-"), false);
});
