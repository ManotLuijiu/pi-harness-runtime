import { describe, expect, test } from "bun:test";
import {
	deriveRelayWsUrl,
	describeRelayEndpoint,
	isRelayWsUrl,
	resolveRelayEndpoint,
} from "../src/relay-endpoint.js";

/** Build a fake key directory reader. */
function makeKeys(files: Record<string, string>) {
	return (path: string): string | undefined => {
		const name = path.split("/").pop() ?? path;
		return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : undefined;
	};
}

describe("deriveRelayWsUrl", () => {
	test("maps an https webhook url to the relay websocket url", () => {
		expect(deriveRelayWsUrl("https://webhook.bunchee.online/telegram")).toBe(
			"wss://webhook.bunchee.online/ws",
		);
	});

	test("documents the direct-app case: the relay listens on WS_PORT, not on the webhook port", () => {
		// Behind a proxy (nginx `location /ws -> 127.0.0.1:8444`) the derived
		// URL is correct. When the webhook URL addresses the app DIRECTLY the
		// relay listens on WS_PORT (default 8444), so the derived URL is only
		// a starting point - resolveRelayEndpoint() adds a note about it.
		expect(deriveRelayWsUrl("http://127.0.0.1:8443/telegram")).toBe("ws://127.0.0.1:8443/ws");
	});

	test("keeps a wss url on the same host", () => {
		expect(deriveRelayWsUrl("wss://webhook.bunchee.online/ws")).toBe("wss://webhook.bunchee.online/ws");
	});

	test("returns null for garbage", () => {
		expect(deriveRelayWsUrl("not a url")).toBeNull();
		expect(deriveRelayWsUrl("")).toBeNull();
	});
});

describe("isRelayWsUrl", () => {
	test("accepts ws and wss urls only", () => {
		expect(isRelayWsUrl("ws://127.0.0.1:8444/ws")).toBe(true);
		expect(isRelayWsUrl("wss://host/ws")).toBe(true);
		expect(isRelayWsUrl("https://host/telegram")).toBe(false);
		expect(isRelayWsUrl("")).toBe(false);
	});

	test("rejects urls that carry credentials or a query string", () => {
		expect(isRelayWsUrl("wss://user:pass@host/ws")).toBe(false);
		expect(isRelayWsUrl("wss://host/ws?token=secret")).toBe(false);
	});
});

describe("resolveRelayEndpoint", () => {
	test("prefers the environment over the key files", () => {
		const resolution = resolveRelayEndpoint({
			env: { RELAY_WS_URL: "wss://from-env/ws", RELAY_AUTH_TOKEN: "env-token" },
			keysDir: "/keys",
			readFile: makeKeys({
				"relay-ws-url.txt": "wss://from-file/ws",
				"relay-auth-token.txt": "file-token",
			}),
		});

		expect(resolution.url).toBe("wss://from-env/ws");
		expect(resolution.urlSource).toBe("env RELAY_WS_URL");
		expect(resolution.token).toBe("env-token");
		expect(resolution.tokenSource).toBe("env RELAY_AUTH_TOKEN");
		expect(resolution.missing).toEqual([]);
	});

	test("falls back to the dedicated key files", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"relay-ws-url.txt": "wss://from-file/ws",
				"relay-auth-token.txt": "file-token",
			}),
		});

		expect(resolution.url).toBe("wss://from-file/ws");
		expect(resolution.urlSource).toBe("keys/relay-ws-url.txt");
		expect(resolution.token).toBe("file-token");
		expect(resolution.tokenSource).toBe("keys/relay-auth-token.txt");
		expect(resolution.missing).toEqual([]);
	});

	test("derives the url from the telegram webhook url and the token from the webhook secret", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"telegram-webhook-url.txt": "https://webhook.bunchee.online/telegram",
				"telegram-webhook-secret.txt": "shared-secret",
			}),
		});

		expect(resolution.url).toBe("wss://webhook.bunchee.online/ws");
		expect(resolution.urlSource).toBe("keys/telegram-webhook-url.txt (derived)");
		expect(resolution.token).toBe("shared-secret");
		expect(resolution.tokenSource).toBe("keys/telegram-webhook-secret.txt");
		expect(resolution.missing).toEqual([]);
		expect(resolution.notes).toEqual([]);
	});

	test("reports what is missing when nothing is configured", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({}),
		});

		expect(resolution.url).toBeNull();
		expect(resolution.token).toBeNull();
		expect(resolution.missing).toHaveLength(2);
		expect(resolution.missing[0]).toContain("url");
		expect(resolution.missing[1]).toContain("token");
	});

	test("treats a blank key file as missing", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"relay-ws-url.txt": "   \n",
				"relay-auth-token.txt": "",
			}),
		});

		expect(resolution.url).toBeNull();
		expect(resolution.token).toBeNull();
		expect(resolution.missing).toHaveLength(2);
	});

	test("ignores a key file that does not hold a websocket url", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"relay-ws-url.txt": "https://webhook.bunchee.online/telegram",
				"telegram-webhook-url.txt": "https://webhook.bunchee.online/telegram",
			}),
		});

		expect(resolution.url).toBe("wss://webhook.bunchee.online/ws");
		expect(resolution.urlSource).toBe("keys/telegram-webhook-url.txt (derived)");
		expect(resolution.missing.join(" ")).toContain(
			"rejected source: keys/relay-ws-url.txt (not a ws:// or wss:// URL)",
		);
	});

	test("rejects an env url that carries credentials", () => {
		const resolution = resolveRelayEndpoint({
			env: { RELAY_WS_URL: "wss://user:pass@host/ws" },
			keysDir: "/keys",
			readFile: makeKeys({ "relay-ws-url.txt": "wss://from-file/ws" }),
		});

		expect(resolution.url).toBe("wss://from-file/ws");
		expect(resolution.missing.join(" ")).toContain("rejected source: env RELAY_WS_URL");
		// The rejected value must not be echoed back - it may hold a secret.
		expect(resolution.missing.join(" ")).not.toContain("user:pass");
		expect(describeRelayEndpoint(resolution)).not.toContain("user:pass");
	});

	test("warns when a remote host would be used over plaintext ws", () => {
		const resolution = resolveRelayEndpoint({
			env: { RELAY_WS_URL: "ws://relay.example.com/ws" },
			keysDir: "/keys",
			readFile: makeKeys({}),
		});

		expect(resolution.url).toBe("ws://relay.example.com/ws");
		expect(resolution.notes.join(" ")).toContain("plaintext");
	});

	test("does not warn about a plaintext ws url on the loopback interface", () => {
		const resolution = resolveRelayEndpoint({
			env: { RELAY_WS_URL: "ws://127.0.0.1:8444/ws" },
			keysDir: "/keys",
			readFile: makeKeys({}),
		});

		expect(resolution.notes.join(" ")).not.toContain("plaintext");
	});

	test("never leaks the token in the description", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"relay-ws-url.txt": "wss://host/ws",
				"relay-auth-token.txt": "super-secret-token",
			}),
		});

		const description = describeRelayEndpoint(resolution);
		expect(description).toContain("url from keys/relay-ws-url.txt");
		expect(description).toContain("token from keys/relay-auth-token.txt");
		expect(description).not.toContain("super-secret-token");
	});

	test("describes a missing endpoint without a secret", () => {
		const resolution = resolveRelayEndpoint({ env: {}, keysDir: "/keys", readFile: makeKeys({}) });
		const description = describeRelayEndpoint(resolution);
		expect(description).toContain("url NOT resolved");
		expect(description).toContain("token NOT resolved");
		// The source list lives in `missing`; the description must not repeat it.
		expect(description).not.toContain("looked at");
	});

	test("records a rejected env url so the operator can see why it was skipped", () => {
		const resolution = resolveRelayEndpoint({
			env: { RELAY_WS_URL: "https://host/telegram" },
			keysDir: "/keys",
			readFile: makeKeys({ "relay-ws-url.txt": "wss://from-file/ws" }),
		});

		expect(resolution.url).toBe("wss://from-file/ws");
		expect(resolution.urlSource).toBe("keys/relay-ws-url.txt");
		expect(resolution.missing.join(" ")).toContain("rejected source: env RELAY_WS_URL");
	});

	test("treats an unreadable key file as absent", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: () => {
				throw new Error("EACCES");
			},
		});

		expect(resolution.url).toBeNull();
		expect(resolution.token).toBeNull();
		expect(resolution.missing).toHaveLength(2);
	});

	test("resolves nothing when the keys directory does not exist", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/definitely/not/a/keys/dir",
		});

		expect(resolution.url).toBeNull();
		expect(resolution.token).toBeNull();
		expect(resolution.missing).toHaveLength(2);
	});

	test("trims a token that ends with CRLF", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"relay-ws-url.txt": "wss://host/ws",
				"relay-auth-token.txt": "token-with-crlf\r\n",
			}),
		});

		expect(resolution.token).toBe("token-with-crlf");
	});

	test("warns when the derived url points at a loopback host", () => {
		const resolution = resolveRelayEndpoint({
			env: {},
			keysDir: "/keys",
			readFile: makeKeys({
				"telegram-webhook-url.txt": "http://127.0.0.1:8443/telegram",
			}),
		});

		expect(resolution.url).toBe("ws://127.0.0.1:8443/ws");
		expect(resolution.notes.join(" ")).toContain("WS_PORT");
		expect(describeRelayEndpoint(resolution)).toContain("WS_PORT");
	});
});
