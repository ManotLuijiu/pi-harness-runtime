/**
 * SSH Detach Interceptor — Tests
 *
 * Key insight on quoting:
 * - `ssh user@host 'cmd &'` — & is INSIDE quotes → safe, SSH completes normally
 * - `ssh user@host "cmd" &` — & is OUTSIDE quotes → risky, backgrounds SSH itself
 * - `ssh user@host 'kill ... &' "2>/dev/null"` — & inside quotes, redirect outside → risky
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
	isSshCommand,
	isDetachedPattern,
	hasBareAmpersand,
	transformToDetached,
	detectSsh,
	isForegroundDaemonSsh,
	addSshTimeoutGuard,
	getDefaultSshTimeoutSeconds,
} from "./ssh-detach-interceptor.js";

describe("isSshCommand", () => {
	const cases: Array<[string, boolean]> = [
		["ssh user@host ls", true],
		["ssh -o StrictHostKeyChecking=no user@host ls", true],
		["echo 'pass' | ssh user@host ls", true],
		["curl https://example.com", false],
		["cd /home && ls", false],
		["ssh user@host 'echo test &'", true],
		["docker exec container ls", false],
	];
	cases.forEach(([cmd, expected]) => {
		it(`${cmd.slice(0, 50)} → ${expected}`, () => {
			assert.strictEqual(isSshCommand(cmd), expected);
		});
	});
});

describe("isDetachedPattern", () => {
	const cases: Array<[string, boolean]> = [
		// & is inside quotes → not detached (no nohup locally visible)
		["ssh user@host 'cmd > /tmp/log 2>&1 & echo DONE'", false],
		// bare & inside quotes → not detached
		["ssh user@host 'cmd &'", false],
		// nohup + redirect + echo DONE → detached
		["ssh user@host 'nohup cmd > /tmp/log 2>&1 & echo DONE'", true],
		// missing echo DONE → not detached
		["ssh user@host 'cmd > /tmp/log &'", false],
		// missing redirect → not detached
		["ssh user@host 'nohup cmd &'", false],
		// non-SSH → not detached
		["curl https://example.com", false],
	];
	cases.forEach(([cmd, expected]) => {
		it(`${cmd.slice(0, 55)} → ${expected}`, () => {
			assert.strictEqual(isDetachedPattern(cmd), expected);
		});
	});
});

describe("hasBareAmpersand", () => {
	// & outside quotes = risky (backgrounds SSH itself)
	const risky: Array<[string, boolean]> = [
		["ssh user@host 'cmd' &", true],
		["ssh user@host 'kill 123' &", true],
		["echo 'pass' | ssh user@host 'kill 123' &", true],
		["ssh user@host 'cmd > /tmp/log 2>&1' &", true],
	];
	// & inside quotes = safe (SSH completes, remote side backgrounds)
	const safe: Array<[string, boolean]> = [
		["ssh user@host 'cmd &'", false],
		["ssh user@host 'kill -9 123 && uvicorn &'", false],
		["ssh user@host 'nohup cmd &'", false],
		["ssh user@host 'cmd'", false],
		["curl https://example.com", false],
	];
	[...risky, ...safe].forEach(([cmd, expected]) => {
		it(`${cmd.slice(0, 50)} → ${expected}`, () => {
			assert.strictEqual(hasBareAmpersand(cmd), expected);
		});
	});
});

describe("transformToDetached", () => {
	it("leaves non-SSH commands unchanged", () => {
		const cmd = "curl https://example.com";
		assert.strictEqual(transformToDetached(cmd), cmd);
	});

	it("leaves already-detached SSH commands unchanged", () => {
		const cmd = "ssh user@host 'cmd > /tmp/log 2>&1 & echo DONE'";
		assert.strictEqual(transformToDetached(cmd), cmd);
	});

	it("transforms bare ssh 'cmd' & (risky: & outside quotes)", () => {
		const cmd = "ssh user@host 'kill -9 123; sleep 2; uvicorn' &";
		const result = transformToDetached(cmd);
		assert.notStrictEqual(result, cmd);
		assert.ok(result.includes("nohup"), "should add nohup");
		assert.ok(result.includes("/tmp/herdr-ssh.log"), "should add log redirect");
		assert.ok(result.includes("2>&1"), "should add stderr redirect");
		assert.ok(result.includes("echo 'SSH_DETACHED'"), "should add DONE echo");
	});

	it("transforms pipelined ssh with bare & (risky: & outside quotes)", () => {
		const cmd = "echo 'pass' | ssh user@host 'kill -9 123' &";
		const result = transformToDetached(cmd);
		assert.notStrictEqual(result, cmd);
		assert.ok(result.includes("nohup"));
		assert.ok(result.includes("echo 'SSH_DETACHED'"));
	});

	it("leaves & inside quotes unchanged (safe: SSH completes)", () => {
		const cmd = "ssh user@host 'kill -9 123; uvicorn &'";
		const result = transformToDetached(cmd);
		assert.strictEqual(result, cmd); // no transform needed
	});

	it("uses custom log file", () => {
		const cmd = "ssh user@host 'cmd' &";
		const result = transformToDetached(cmd, { logFile: "/var/log/my-ssh.log" });
		assert.ok(result.includes("/var/log/my-ssh.log"));
	});
});

describe("detectSsh", () => {
	it("warns on SSH with bare & outside quotes", () => {
		const result = detectSsh("ssh user@host 'cmd' &");
		assert.strictEqual(result.isSsh, true);
		assert.strictEqual(result.hasBareAmpersand, true);
		assert.strictEqual(result.isDetached, false);
		assert.ok(result.suggestion.includes("nohup"));
	});

	it("no warning for & inside quotes (SSH completes normally)", () => {
		const result = detectSsh("ssh user@host 'kill 123 && uvicorn &'");
		assert.strictEqual(result.isSsh, true);
		assert.strictEqual(result.isDetached, false);
		assert.strictEqual(result.hasBareAmpersand, false);
		assert.strictEqual(result.suggestion, "");
	});

	it("no detection for non-SSH", () => {
		const result = detectSsh("curl https://example.com");
		assert.strictEqual(result.isSsh, false);
		assert.strictEqual(result.suggestion, "");
	});
});

describe("isForegroundDaemonSsh", () => {
	// The exact command that caused the 1911.9s hang (2026-09-14)
	const HANG_CMD =
		"echo 'manlucha' | ssh -tt frappe@100.101.238.114 \"cd /home/frappe/amos-saas/backend/services/worker && AMOS_API_URL=https://api.ezsysbot.com AMOS_WORKER_API_KEY=test /home/frappe/amos-saas/backend/.venv/bin/python -m amos_worker --video 2>&1 | head -10\"";

	const risky: Array<[string, string]> = [
		[
			HANG_CMD,
			"foreground ssh -tt running amos_worker poller (real 1911.9s hang)",
		],
		[
			'ssh host "uvicorn main:app --host 0.0.0.0 --port 8100"',
			"foreground uvicorn",
		],
		["ssh host 'python -m celery worker'", "celery worker"],
		['ssh host "tail -f /var/log/app.log"', "tail -f"],
		['ssh host "npm run dev"', "npm run dev"],
		[
			'ssh host "python -m my_package.daemon --poll"',
			"python -m with daemon in module path",
		],
	];
	risky.forEach(([cmd, label]) => {
		it(`RISKY: ${label}`, () => {
			assert.strictEqual(isForegroundDaemonSsh(cmd), true, cmd.slice(0, 80));
		});
	});

	const safe: Array<[string, string]> = [
		["ssh host 'ls -la'", "plain remote command"],
		[
			"timeout 60s ssh -o BatchMode=yes host 'uvicorn main:app'",
			"local timeout guard",
		],
		[
			"ssh host 'timeout 30 python -m amos_worker --video'",
			"remote timeout guard",
		],
		[
			"ssh host 'nohup python -m amos_worker --video > /tmp/w.log 2>&1 & echo DONE'",
			"nohup detached",
		],
		["ssh -f host 'uvicorn main:app'", "ssh -f backgrounds itself"],
		[
			"python -m amos_worker --video",
			"local (non-ssh) daemon command — not our scope",
		],
		["curl https://example.com", "not ssh"],
	];
	safe.forEach(([cmd, label]) => {
		it(`SAFE: ${label}`, () => {
			assert.strictEqual(isForegroundDaemonSsh(cmd), false, cmd.slice(0, 80));
		});
	});
});

describe("addSshTimeoutGuard", () => {
	it("prefixes the ssh segment with timeout, preserving pipeline prefix", () => {
		const cmd = "echo 'x' | ssh -tt host \"python -m amos_worker --video\"";
		assert.strictEqual(
			addSshTimeoutGuard(cmd, 300),
			"echo 'x' | timeout 300s ssh -tt host \"python -m amos_worker --video\"",
		);
	});

	it("uses default seconds when omitted", () => {
		const cmd = "ssh host 'uvicorn main:app'";
		assert.ok(addSshTimeoutGuard(cmd).startsWith("timeout "));
		assert.ok(addSshTimeoutGuard(cmd).includes("s ssh host"));
	});

	it("invalid seconds returns command unchanged", () => {
		const cmd = "ssh host 'uvicorn main:app'";
		assert.strictEqual(addSshTimeoutGuard(cmd, 0), cmd);
		assert.strictEqual(addSshTimeoutGuard(cmd, NaN), cmd);
	});

	it("non-ssh command returns unchanged", () => {
		assert.strictEqual(addSshTimeoutGuard("ls -la"), "ls -la");
	});
});

describe("getDefaultSshTimeoutSeconds", () => {
	it("defaults to 300", () => {
		delete process.env.PI_HARNESS_SSH_TIMEOUT_S;
		assert.strictEqual(getDefaultSshTimeoutSeconds(), 300);
	});

	it("honours PI_HARNESS_SSH_TIMEOUT_S", () => {
		const prev = process.env.PI_HARNESS_SSH_TIMEOUT_S;
		try {
			process.env.PI_HARNESS_SSH_TIMEOUT_S = "120";
			assert.strictEqual(getDefaultSshTimeoutSeconds(), 120);
			process.env.PI_HARNESS_SSH_TIMEOUT_S = "bogus";
			assert.strictEqual(getDefaultSshTimeoutSeconds(), 300);
		} finally {
			if (prev === undefined) delete process.env.PI_HARNESS_SSH_TIMEOUT_S;
			else process.env.PI_HARNESS_SSH_TIMEOUT_S = prev;
		}
	});
});

describe("detectSsh (timeout guard)", () => {
	it("flags foreground daemon ssh with timeout suggestion", () => {
		const result = detectSsh("ssh -tt host 'python -m amos_worker --video'");
		assert.strictEqual(result.needsTimeoutGuard, true);
		assert.ok(result.suggestion.includes("timeout"));
	});

	it("no timeout flag for plain ssh", () => {
		const result = detectSsh("ssh host 'ls -la'");
		assert.strictEqual(result.needsTimeoutGuard, false);
	});
});
