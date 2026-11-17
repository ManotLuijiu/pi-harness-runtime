/**
 * The choice of the credential of a quota refresh.
 *
 * The browser profile is a logged-in session that needs no import. The
 * canonical cookie cache is the output of the sanitizer. They are
 * different credentials, and a failure of one is not a failure of the
 * other.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseQuotaCredential } from "../harness/quota-credential-choice.ts";

test("the browser profile is chosen when it answered", () => {
	const choice = chooseQuotaCredential({
		browserProfile: { ok: true },
		cookieStage: "imported",
	});
	assert.equal(choice.choice, "browser-profile");
	assert.equal(choice.reason, undefined);
});

test("the browser profile is chosen even when the drop file is malformed", () => {
	// The drop folder holds a file that was never imported. The profile
	// does not care about the drop folder.
	const choice = chooseQuotaCredential({
		browserProfile: { ok: true },
		cookieStage: "discovered",
	});
	assert.equal(choice.choice, "browser-profile");
});

test("the cookie cache is chosen when the profile did not answer", () => {
	const choice = chooseQuotaCredential({
		browserProfile: { ok: false, reason: "the browser profile is not signed in" },
		cookieStage: "imported",
	});
	assert.equal(choice.choice, "cookie-cache");
});

test("a file that was found but not imported gives nothing to read", () => {
	const choice = chooseQuotaCredential({
		browserProfile: { ok: false, reason: "the browser profile is not signed in" },
		cookieStage: "discovered",
	});
	assert.equal(choice.choice, "none");
	assert.ok(choice.reason?.includes("not imported"));
});

test("no credential at all names the reason of the profile", () => {
	const choice = chooseQuotaCredential({
		browserProfile: { ok: false, reason: "the browser profile is not signed in" },
		cookieStage: "none",
	});
	assert.equal(choice.choice, "none");
	assert.ok(choice.reason?.includes("the browser profile is not signed in"));
});

test("without a profile the reason names the missing cache", () => {
	const choice = chooseQuotaCredential({ cookieStage: "none" });
	assert.equal(choice.choice, "none");
	assert.ok(choice.reason?.includes("no imported cookie cache"));
});
