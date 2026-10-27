/**
 * Tests for the startup messages that report a missing credential.
 *
 * These are the rules the user sees:
 * - a warning must carry at least one `echo` command,
 * - the Jev line must keep its fix commands (a later message with the same
 *   label would drop them),
 * - LINE must never be reported as configured when the audit could not run,
 * - LINE must stay silent for a user who never touched LINE.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	exposedKeyFilesReport,
	jevMissingKeyReport,
	lineConfigurationReport,
	relayEndpointReport,
	relayShouldBeReported,
	oneLineError,
} from "../harness/startup-report.ts";
import { auditKeyFiles } from "../harness/key-file-audit.ts";

function auditWith(files, env = {}) {
	const dir = "/tmp/does-not-exist-keys";
	const exists = (path) => files[path.split("/").pop()] !== undefined;
	const readFile = (path) => files[path.split("/").pop()];
	return auditKeyFiles({ keysDir: dir, env, exists, readFile });
}

test("the Jev line keeps the fix commands", () => {
	const report = jevMissingKeyReport(['echo "<API_KEY>" > ~/.pi-harness-runtime/keys/typesafe-api-key.txt']);
	assert.equal(report.label, "Jev");
	assert.equal(report.status, "warn");
	assert.ok(
		report.details.some((detail) => detail.startsWith('echo "<API_KEY>"')),
		"the fix command must survive in the Jev line",
	);
	assert.ok(report.details.length >= 1);
});

test("the Jev line still has a command when the audit has nothing to offer", () => {
	const report = jevMissingKeyReport([]);
	assert.equal(report.status, "warn");
	// Nothing to show - the caller always passes the fallback, but the
	// report must not crash on an empty list.
	assert.ok(Array.isArray(report.details));
});

test("the relay line names what is missing", () => {
	const both = relayEndpointReport({
		missingUrl: true,
		missingToken: true,
		reasons: [],
		fixes: [],
	});
	assert.match(both.text, /no relay endpoint configured/);

	const token = relayEndpointReport({
		missingUrl: false,
		missingToken: true,
		reasons: [],
		fixes: [],
	});
	assert.match(token.text, /no relay auth token configured/);

	const url = relayEndpointReport({
		missingUrl: true,
		missingToken: false,
		reasons: [],
		fixes: [],
	});
	assert.match(url.text, /no relay URL configured/);
});

test("the relay line keeps the real cause and the fix commands", () => {
	const report = relayEndpointReport({
		missingUrl: false,
		missingToken: true,
		reasons: ["rejected source: env RELAY_WS_URL (not a ws:// or wss:// URL)"],
		fixes: ['echo "<TOKEN>" > ~/.pi-harness-runtime/keys/relay-auth-token.txt'],
	});
	assert.ok(report.details[0].startsWith("rejected source:"));
	assert.ok(report.details.some((detail) => detail.startsWith('echo "<TOKEN>"')));
});

test("LINE is reported on a fresh install", () => {
	// A user who never touched LINE must still see that LINE is one of the
	// two notification channels - and how to set it up. The row is never
	// missing.
	const report = lineConfigurationReport({
		audit: auditWith({}),
		channelState: "not-started",
		fixes: [],
	});
	assert.ok(report, "the LINE row must always be reported");
	assert.equal(report.label, "LINE");
	assert.equal(report.status, "warn");
	assert.match(report.text, /credentials missing/);
});

test("the missing LINE credentials carry the setup steps and both commands", () => {
	const report = lineConfigurationReport({
		audit: auditWith({}),
		channelState: "not-started",
		fixes: [
			'echo "<ACCESS_TOKEN>" > ~/.pi-harness-runtime/keys/line-access-token.txt',
			'echo "<USER_ID>" > ~/.pi-harness-runtime/keys/line-user-id.txt',
		],
	});
	assert.ok(report);
	// The two steps that produce the values.
	assert.ok(
		report.details.some((detail) => /LINE Developers Console/.test(detail)),
		"the LINE setup step must be shown",
	);
	assert.ok(
		report.details.some((detail) => /Long-term channel access token/.test(detail)),
		"the token step must be shown",
	);
	// The command for BOTH files.
	assert.ok(
		report.details.some((detail) => detail.includes("line-access-token.txt")),
		"the access token command must be shown",
	);
	assert.ok(
		report.details.some((detail) => detail.includes("line-user-id.txt")),
		"the user id command must be shown",
	);
	assert.ok(
		report.details.some((detail) => /reload Pi/.test(detail)),
		"the warning must say what to do next",
	);
});

test("an explicit LINE opt-out is an information, not a warning", () => {
	const report = lineConfigurationReport({
		audit: auditWith({}),
		disabled: true,
		channelState: "not-started",
		fixes: [],
	});
	assert.ok(report);
	assert.equal(report.status, "info");
	assert.match(report.text, /disabled/);
});

test("a missing LINE credential is never reported as disabled", () => {
	// "Disabled" and "not configured" are different states. Only an
	// explicit opt-out may say "disabled".
	const report = lineConfigurationReport({
		audit: auditWith({}),
		disabled: false,
		channelState: "not-started",
		fixes: [],
	});
	assert.ok(report);
	assert.notEqual(report.status, "info");
	assert.doesNotMatch(report.text, /disabled/);
});

test("LINE is reported as not configured once a client key file exists", () => {
	const audit = auditWith({ "line-access-token.txt": "token-value" });
	const report = lineConfigurationReport({
		audit,
		channelState: "not-started",
		fixes: ['echo "<USER_ID>" > ~/.pi-harness-runtime/keys/line-user-id.txt'],
	});
	assert.ok(report);
	assert.equal(report.status, "warn");
	assert.match(report.text, /credentials missing/);
	assert.ok(report.details.some((detail) => detail.startsWith('echo "<USER_ID>"')));
});

test("LINE is not reported twice when the channel was started", () => {
	// initTelegram() reports the green "configured and enabled" line itself -
	// a second LINE line would only overwrite it.
	const audit = auditWith({
		"line-access-token.txt": "token-value",
		"line-user-id.txt": "U1234567890",
	});
	const report = lineConfigurationReport({
		audit,
		channelState: "started",
		fixes: [],
	});
	assert.equal(report, null);
});


test("LINE is not reported as configured when the channel was never started", () => {
	// The key files exist but the runtime did not start the LINE channel
	// (the extension is initialised once per load). A green line would be
	// a lie - the user would wait for a LINE reply that never comes.
	const audit = auditWith({
		"line-access-token.txt": "token-value",
		"line-user-id.txt": "U1234567890",
	});
	const report = lineConfigurationReport({
		audit,
		channelState: "not-started",
		telegramConfigured: true,
		fixes: [],
	});
	assert.ok(report);
	assert.notEqual(report.status, "ok");
	// With a working Telegram channel a reload is what starts the channel.
	assert.match(report.text, /reload Pi/);
});

test("LINE names the real cause when Telegram is not configured", () => {
	// A reload does not help when Telegram is missing - the LINE channel
	// starts together with the Telegram channel.
	const audit = auditWith({
		"line-access-token.txt": "token-value",
		"line-user-id.txt": "U1234567890",
	});
	const report = lineConfigurationReport({
		audit,
		channelState: "not-started",
		telegramConfigured: false,
		fixes: [],
	});
	assert.ok(report);
	assert.notEqual(report.status, "ok");
	assert.match(report.text, /Telegram/);
	assert.doesNotMatch(report.text, /reload Pi/, "a reload would not help");
});

test("LINE reports a failed channel instead of a green line", () => {
	// The credentials are there but the channel did not initialize - the
	// credentials themselves are the likely cause, so the fix commands are
	// shown together with the path to check.
	const audit = auditWith({
		"line-access-token.txt": "token-value",
		"line-user-id.txt": "user-id",
	});
	const report = lineConfigurationReport({
		audit,
		channelState: "failed",
		fixes: ['echo "<ACCESS_TOKEN>" > ~/.pi-harness-runtime/keys/line-access-token.txt'],
	});
	assert.ok(report);
	assert.equal(report.status, "warn");
	assert.match(report.text, /did not start/);
	assert.ok(report.details.some((detail) => detail.startsWith('echo "<ACCESS_TOKEN>"')));
});

test("LINE is never reported as configured when the audit failed", () => {
	const report = lineConfigurationReport({
		audit: null,
		channelState: "not-started",
		fixes: ['echo "<ACCESS_TOKEN>" > ~/.pi-harness-runtime/keys/line-access-token.txt'],
	});
	assert.ok(report);
	assert.notEqual(report.status, "ok");
	assert.match(report.text, /could not read the key files/);
	assert.ok(report.details.some((detail) => detail.startsWith('echo "<ACCESS_TOKEN>"')));
});

test("the LINE channel secret alone does not trigger the LINE warning", () => {
	// The channel secret is only needed on the host that runs the webhook
	// server - it must not put a LINE warning on every other machine.
	const audit = auditWith({ "line-channel-secret.txt": "secret-value" });
	const missing = audit.byFeature.get("LINE") ?? [];
	assert.deepEqual(
		missing.map((entry) => entry.requirement.label).sort(),
		["channel access token", "user id"],
		"the client credentials are missing - the channel secret is not one of them",
	);
	// The channel secret itself is optional - it is never reported.
	const secret = audit.missing.find(
		(entry) => entry.requirement.file === "line-channel-secret.txt",
	);
	assert.equal(secret, undefined);
});

test("every warning report carries an actionable instruction", () => {
	// The runtime-level counterpart of the source scan in
	// test/startup-guidance.test.mjs: a report that is shown as a warning
	// must tell the user what to do - a command, the file to look at, or an
	// imperative instruction.
	const actionable = [
		/echo\s+"[^"]*"\s*>/,
		/\.pi-harness-runtime\/keys\//,
		/^(How to fix|Check |Reload|Replace|Unset|Set |Create |Add |Restart|Run |Or |Then )/,
		/reload Pi/i,
		/in the environment/i,
	];
	const reports = [
		jevMissingKeyReport(['echo "<API_KEY>" > ~/.pi-harness-runtime/keys/typesafe-api-key.txt']),
		jevMissingKeyReport([]),
		relayEndpointReport({
			missingUrl: true,
			missingToken: true,
			reasons: ["rejected source: env RELAY_WS_URL (not a ws:// or wss:// URL)"],
			fixes: ['echo "<WS_URL>" > ~/.pi-harness-runtime/keys/relay-ws-url.txt'],
		}),
		relayEndpointReport({ missingUrl: false, missingToken: true, reasons: [], fixes: [] }),
	];
	const lineReports = [
		lineConfigurationReport({
			audit: auditWith({}),
			clientKeyFilePresent: true,
			channelState: "not-started",
			telegramConfigured: false,
			fixes: ['echo "<TOKEN>" > ~/.pi-harness-runtime/keys/line-access-token.txt'],
		}),
		lineConfigurationReport({
			audit: auditWith({}),
			clientKeyFilePresent: true,
			channelState: "failed",
			telegramConfigured: true,
			fixes: [],
		}),
		// The LINE credentials are there, Telegram is missing: the LINE
		// channel cannot start - the user needs the Telegram commands.
		lineConfigurationReport({
			audit: auditWith({
				"line-access-token.txt": "token-value",
				"line-user-id.txt": "U1234567890",
			}),
			clientKeyFilePresent: true,
			channelState: "not-started",
			telegramConfigured: false,
			fixes: [],
			telegramFixes: ['echo "<TOKEN>" > ~/.pi-harness-runtime/keys/telegram-bot-token.txt'],
		}),
	];
	for (const report of [...reports, ...lineReports].filter(Boolean)) {
		if (report.status !== "warn" && report.status !== "err") continue;
		assert.ok(
			report.details.some((detail) => actionable.some((pattern) => pattern.test(detail))),
			`the "${report.label}: ${report.text}" report tells the user what to do (details: ${JSON.stringify(report.details)})`,
		);
	}
});

test("the relay is only reported for a user who wants it", () => {
	// The relay is optional: a user who never set it up and whose Telegram
	// channel does not work must not see a permanent warning.
	assert.equal(
		relayShouldBeReported({ hasRelayKeyFile: false, telegramConfigured: false }),
		false,
	);
	assert.equal(
		relayShouldBeReported({ hasRelayKeyFile: true, telegramConfigured: false }),
		true,
		"a relay key file means the user wants the relay",
	);
	assert.equal(
		relayShouldBeReported({ hasRelayKeyFile: false, telegramConfigured: true }),
		true,
		"a working Telegram channel wants the relay",
	);
});

test("the LINE report falls back to an instruction when the audit failed", () => {
	// The audit can fail (an unreadable key directory). The line must then
	// still tell the user what to check - a warning without an instruction
	// is useless.
	const report = lineConfigurationReport({
		audit: null,
		clientKeyFilePresent: true,
		channelState: "not-started",
		telegramConfigured: true,
		fixes: [],
	});
	assert.ok(report, "the LINE line is reported");
	assert.equal(report.status, "warn");
	assert.ok(
		report.details.some((detail) => /check/i.test(detail)),
		`the details carry an instruction: ${JSON.stringify(report.details)}`,
	);
});

test("the LINE details mention the reload only once", () => {
	// The line text already says "reload Pi to enable the channel" - a second
	// reload instruction in the details is noise.
	const audit = {
		missing: [],
		byFeature: new Map([["LINE Webhook", []]]),
	};
	const report = lineConfigurationReport({
		audit,
		clientKeyFilePresent: true,
		channelState: "not-started",
		telegramConfigured: true,
		fixes: [],
	});
	assert.ok(report, "the LINE line is reported");
	// The reload is named once - in the line text or in the details, not in
	// both.
	const reloads = [
		...report.details ?? [],
	]
		.concat(report.text)
		.filter((part) => /reload/i.test(part));
	assert.equal(reloads.length, 1, `one reload instruction: ${JSON.stringify(reloads)}`);
});

test("an error message is flattened, length limited and free of credentials", () => {
	// A relay client error can carry the url - and the url can carry the
	// auth token. The startup summary must never print it.
	const error = new Error("connect failed\nwss://relay.example.com/ws?token=s3cr3t-value&x=1");
	const line = oneLineError(error);
	assert.ok(!line.includes("\n"), `the message is one line: ${JSON.stringify(line)}`);
	assert.ok(!line.includes("s3cr3t-value"), `the token is redacted: ${JSON.stringify(line)}`);
	assert.ok(line.includes("<redacted>"), `the redaction is visible: ${JSON.stringify(line)}`);
	const long = oneLineError(new Error("x".repeat(400)));
	assert.ok(long.length <= 160, `the message is limited: ${long.length}`);
});

test("the LINE line carries the Telegram commands when Telegram is missing", () => {
	// The LINE channel starts together with the Telegram channel - without
	// Telegram the user needs the Telegram commands, not only an explanation.
	const report = lineConfigurationReport({
		audit: auditWith({
			"line-access-token.txt": "token-value",
			"line-user-id.txt": "U1234567890",
		}),
		clientKeyFilePresent: true,
		channelState: "not-started",
		telegramConfigured: false,
		fixes: [],
		telegramFixes: ['echo "<TOKEN>" > ~/.pi-harness-runtime/keys/telegram-bot-token.txt'],
	});
	assert.ok(report);
	assert.match(report.text, /Telegram/);
	const joined = report.details.join("\n");
	assert.ok(joined.includes("telegram-bot-token.txt"), `the Telegram command is shown: ${joined}`);
	assert.doesNotMatch(joined, /reload Pi/i, "a reload cannot help before Telegram works");
});

test("a credential in a url is redacted whatever the parameter is called", () => {
	// A relay client error can carry the url - and the url can carry the
	// token under many spellings.
	for (const parameter of ["token", "access_token", "api_key", "authToken", "jwt", "signature"]) {
		const line = oneLineError(new Error(`connect failed ws://relay.example.com/ws?${parameter}=SECRET-VALUE`));
		assert.ok(!line.includes("SECRET-VALUE"), `the ${parameter} is redacted: ${line}`);
	}
	const bearer = oneLineError(new Error("connect failed Authorization: Bearer eyJhbGciOi.SECRET"));
	assert.ok(!bearer.includes("eyJhbGciOi.SECRET"), `the bearer token is redacted: ${bearer}`);
});

test("a credential in a url path or a header is redacted too", () => {
	// The Telegram bot token travels in the url path, an api key in a
	// header - both must not reach the startup summary.
	const path = oneLineError(new Error("GET https://api.telegram.org/bot123456:ABC-DEF/getMe failed"));
	assert.ok(!path.includes("ABC-DEF"), `the bot token is redacted: ${path}`);
	assert.ok(path.includes("api.telegram.org"), `the useful part survives: ${path}`);
	const header = oneLineError(new Error("request failed X-Api-Key: SECRET-I"));
	assert.ok(!header.includes("SECRET-I"), `the header value is redacted: ${header}`);
	const pair = oneLineError(new Error("request failed token: SECRET-H"));
	assert.ok(!pair.includes("SECRET-H"), `the name/value pair is redacted: ${pair}`);
});

test("an ordinary message is not eaten by the redaction", () => {
	// The redaction must not swallow the diagnostic tail of a message that
	// has no credential in it.
	for (const message of [
		"connect failed: authorization failed for user bob",
		"Error: fetch failed ECONNREFUSED 127.0.0.1:8080 (after 3 tries, took 1200ms)",
		"ws://x/ws?timeout=5000 retry=3",
	]) {
		const line = oneLineError(new Error(message));
		assert.ok(
			line.includes(message.slice(0, 20)),
			`the message survives: ${JSON.stringify(line)}`,
		);
	}
});

test("a short header value is redacted and the rest of the url survives", () => {
	// A one character value is still a value - and the redaction must not
	// eat the rest of the url.
	const line = oneLineError(new Error("https://x/y?token=abc123&z=1"));
	assert.ok(!line.includes("abc123"), `the value is redacted: ${line}`);
	assert.ok(line.includes("&z=1"), `the rest of the url survives: ${line}`);
	for (const header of ["X-Api-Key: x", "token: x"]) {
		const redacted = oneLineError(new Error(`request failed ${header}`));
		assert.ok(!/: x$/.test(redacted), `the value is redacted: ${redacted}`);
	}
});

// The line for key files that other users on this machine can read.
//
// A key file is a secret, and the harness reads its own key files, so a
// file that everybody can read works perfectly. Nothing else notices, which
// makes this line the only place where the fact can surface.

test("a key file that other users can read gets a line with the command", () => {
	const report = exposedKeyFilesReport({
		exposed: [{ file: "openai-api-key.txt", mode: "644", readableBy: "group and others" }],
		fixes: ["chmod 600 ~/.pi-harness-runtime/keys/openai-api-key.txt"],
	});
	assert.ok(report, "the line is reported");
	assert.equal(report.label, "Keys");
	assert.equal(report.status, "warn");
	assert.match(report.text, /1 key file can be read by other users/);
	assert.equal(report.details.length, 1);
	assert.match(report.details[0], /^chmod 600 /);
});

test("several key files that other users can read are counted", () => {
	const report = exposedKeyFilesReport({
		exposed: [
			{ file: "openai-api-key.txt", mode: "644", readableBy: "group and others" },
			{ file: "telegram-bot-token.txt", mode: "660", readableBy: "group and others" },
		],
		fixes: ["chmod 600 ~/.pi-harness-runtime/keys/openai-api-key.txt"],
	});
	assert.ok(report);
	assert.match(report.text, /2 key files can be read by other users/);
});

test("no exposed key file means no line", () => {
	// A line that has nothing to say would push the real lines down.
	assert.equal(exposedKeyFilesReport({ exposed: [], fixes: [] }), null);
});

test("the line never names a value", () => {
	const report = exposedKeyFilesReport({
		exposed: [{ file: "openai-api-key.txt", mode: "644", readableBy: "others" }],
		fixes: ["chmod 600 ~/.pi-harness-runtime/keys/openai-api-key.txt"],
	});
	assert.ok(report);
	const text = [report.text, ...report.details].join("\n");
	assert.equal(text.includes("sk-"), false);
});

// The exposure line of the key tree.
//
// The line shows ONE command for the whole tree: a list of one `chmod` per
// file is a list nobody runs. The command is shown, never executed.

test("the exposure line shows one command for the whole key tree", () => {
	const report = exposedKeyFilesReport({
		exposed: [
			{ file: "openai-api-key.txt", mode: "644", readableBy: "group and others" },
			{ file: "telegram-bot-token.txt", mode: "644", readableBy: "group and others" },
			{ file: "line-access-token.txt", mode: "644", readableBy: "group and others" },
		],
		exposedDirectories: [],
		fixes: ["chmod 700 'keys' && find 'keys' -type d -exec chmod 700 {} + && find 'keys' -type f -exec chmod 600 {} +"],
	});
	assert.ok(report);
	assert.equal(report.details.length, 1);
	assert.match(report.details[0], /-type f -exec chmod 600 \{\} \+/);
});

test("a key directory that others can read is reported", () => {
	const report = exposedKeyFilesReport({
		exposed: [],
		exposedDirectories: [
			{ name: ".", mode: "755", readableBy: "group and others" },
		],
		fixes: ["chmod 700 'keys' && find 'keys' -type d -exec chmod 700 {} + && find 'keys' -type f -exec chmod 600 {} +"],
	});
	assert.ok(report, "the directory exposure is reported");
	assert.equal(report.label, "Keys");
	assert.equal(report.status, "warn");
	assert.match(report.text, /directory of the key tree can be read by other users/);
});

test("files and directories are counted together", () => {
	const report = exposedKeyFilesReport({
		exposed: [{ file: "openai-api-key.txt", mode: "644", readableBy: "others" }],
		exposedDirectories: [
			{ name: ".", mode: "755", readableBy: "group and others" },
			{ name: "sub", mode: "755", readableBy: "group and others" },
		],
		fixes: ["chmod 700 'keys'"],
	});
	assert.ok(report);
	assert.match(report.text, /1 key file\(s\) and 2 director\(y\/ies\)/);
});

test("a private key tree means no line", () => {
	assert.equal(
		exposedKeyFilesReport({ exposed: [], exposedDirectories: [], fixes: [] }),
		null,
	);
});
