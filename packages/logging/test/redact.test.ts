import { describe, expect, test } from "bun:test";
import {
	isSecretKey,
	isSensitiveValueKey,
	redactFields,
	redactText,
	redactValue,
} from "../src/redact.js";

describe("redactText", () => {
	test("replaces bearer tokens", () => {
		const out = redactText("Authorization: Bearer abcdef0123456789xyz");
		expect(out).not.toContain("abcdef0123456789xyz");
		expect(out).toContain("[REDACTED]");
	});

	test("replaces api keys", () => {
		const out = redactText("using sk-abcdefghijklmnopqrstuvwx now");
		expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
	});

	test("replaces credential assignments but keeps the key name", () => {
		const out = redactText("api_key=super-secret-value");
		expect(out).toContain("api_key=");
		expect(out).not.toContain("super-secret-value");
	});

	test("replaces JWTs", () => {
		const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
		expect(redactText(`token ${jwt}`)).not.toContain(jwt);
	});

	test("keeps ordinary text intact", () => {
		expect(redactText("service started in 42ms")).toBe("service started in 42ms");
	});
});

describe("isSecretKey", () => {
	test("detects credential key names", () => {
		expect(isSecretKey("apiKey")).toBe(true);
		expect(isSecretKey("openai_api_key")).toBe(true);
		expect(isSecretKey("authorization")).toBe(true);
		expect(isSecretKey("r2SecretAccessKey")).toBe(true);
		expect(isSecretKey("userId")).toBe(false);
		expect(isSecretKey("durationMs")).toBe(false);
	});
});

describe("isSensitiveValueKey", () => {
	test("detects content keys", () => {
		expect(isSensitiveValueKey("content")).toBe(true);
		expect(isSensitiveValueKey("raw")).toBe(true);
		expect(isSensitiveValueKey("messages")).toBe(true);
		expect(isSensitiveValueKey("durationMs")).toBe(false);
	});
});

describe("redactValue", () => {
	test("redacts secret fields of an object", () => {
		const out = redactValue({
			user: "alice",
			apiKey: "sk-should-not-appear",
			nested: { password: "hunter2", ok: 1 },
		}) as Record<string, unknown>;

		expect(out.user).toBe("alice");
		expect(out.apiKey).toBe("[REDACTED]");
		const nested = out.nested as Record<string, unknown>;
		expect(nested.password).toBe("[REDACTED]");
		expect(nested.ok).toBe(1);
	});

	test("redacts sensitive content fields", () => {
		const out = redactValue({ content: "long prompt", title: "ok" }) as Record<string, unknown>;
		expect(out.content).toBe("[REDACTED]");
		expect(out.title).toBe("ok");
	});

	test("truncates long strings", () => {
		const out = redactValue("word ".repeat(1000), { maxStringLength: 100 }) as string;
		expect(out.length).toBeLessThan(200);
		expect(out).toContain("[truncated:");
	});

	test("limits nesting depth", () => {
		let deep: Record<string, unknown> = { value: 1 };
		for (let i = 0; i < 10; i++) deep = { child: deep };
		const out = JSON.stringify(redactValue(deep, { maxDepth: 3 }));
		expect(out).toContain("[MAX_DEPTH]");
	});

	test("converts errors into a safe shape", () => {
		const out = redactValue(new Error("boom")) as Record<string, unknown>;
		expect(out.name).toBe("Error");
		expect(out.message).toBe("boom");
	});
});

describe("redactFields", () => {
	test("returns undefined for missing fields", () => {
		expect(redactFields(undefined)).toBeUndefined();
	});

	test("redacts a flat bag", () => {
		const out = redactFields({ token: "abc", count: 3 });
		expect(out?.token).toBe("[REDACTED]");
		expect(out?.count).toBe(3);
	});
});
