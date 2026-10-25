/**
 * SSH Hang Recovery — tests for the shell-safety helpers.
 *
 * The host, the user and the command all reach a shell. A value that is
 * quoted cannot end the quote, and a value that does not look like a host
 * is rejected before it is ever passed on.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { shellQuote, assertSafeSshTarget } from "./ssh-hang-recovery.js";

describe("shellQuote", () => {
	it("wraps a plain value in single quotes", () => {
		assert.strictEqual(shellQuote("pm2 status"), "'pm2 status'");
	});

	it("neutralizes a value that would close the quote", () => {
		// The classic breakout: ' ; rm -rf / ; '
		const payload = "'; rm -rf / ; '";
		const quoted = shellQuote(payload);
		// Every ' of the payload is closed, escaped and reopened, so the
		// payload can never leave the quoted string.
		assert.strictEqual(quoted, "''\\''; rm -rf / ; '\\'''");
		// The quoted form has an even number of quotes: it parses as one
		// literal string, whatever the payload was.
		assert.strictEqual((quoted.match(/'/g) || []).length % 2, 0);
	});

	it("neutralizes a command substitution", () => {
		const quoted = shellQuote("$(whoami)");
		assert.strictEqual(quoted, "'$(whoami)'");
	});

	it("neutralizes a backtick substitution", () => {
		const quoted = shellQuote("`id`");
		assert.strictEqual(quoted, "'`id`'");
	});

	it("keeps a newline inside the quotes", () => {
		const quoted = shellQuote("a\nb");
		assert.strictEqual(quoted, "'a\nb'");
	});
});

describe("assertSafeSshTarget", () => {
	it("accepts a DNS name", () => {
		assert.doesNotThrow(() => assertSafeSshTarget("example.com", "deploy"));
	});

	it("accepts an IPv4 address", () => {
		assert.doesNotThrow(() => assertSafeSshTarget("203.0.113.10", "deploy"));
	});

	it("accepts a bracketed IPv6 address", () => {
		assert.doesNotThrow(() => assertSafeSshTarget("[2001:db8::1]", "deploy"));
	});

	it("rejects a host that carries a command", () => {
		assert.throws(
			() => assertSafeSshTarget("example.com; rm -rf /", "deploy"),
			/invalid ssh host/,
		);
	});

	it("rejects a host that carries a substitution", () => {
		assert.throws(
			() => assertSafeSshTarget("$(whoami).example.com", "deploy"),
			/invalid ssh host/,
		);
	});

	it("rejects a host with a space", () => {
		assert.throws(() => assertSafeSshTarget("a b", "deploy"), /invalid ssh host/);
	});

	it("rejects a user that carries a command", () => {
		assert.throws(
			() => assertSafeSshTarget("example.com", "root; rm -rf /"),
			/invalid ssh user/,
		);
	});

	it("rejects a user with a shell metacharacter", () => {
		assert.throws(() => assertSafeSshTarget("example.com", "a$b"), /invalid ssh user/);
	});
});
