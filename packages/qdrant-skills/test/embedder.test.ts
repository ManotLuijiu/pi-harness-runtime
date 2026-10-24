/**
 * The OpenAI key of the embedder.
 *
 * The embeddings endpoint of OpenAI accepts only an OpenAI key. The key of
 * another provider is a different credential and must never be sent there.
 * The loader must also work in ESM, where `require` does not exist.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOpenAIApiKey } from "../src/embedder.js";

/** The environment variables the loader looks at. */
const ENV_KEYS = [
	"OPENAI_API_KEY",
	"TYPESAFE_API_KEY",
	"OPENROUTER_API_KEY",
	"HOME",
	"USERPROFILE",
] as const;

let saved: Record<string, string | undefined> = {};
let tempHome: string;

beforeEach(() => {
	saved = {};
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	// The home directory points at a fresh directory, so the test never
	// reads the key of the machine it runs on.
	tempHome = mkdtempSync(join(homedir(), ".test-qdrant-embedder-"));
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	rmSync(tempHome, { recursive: true, force: true });
});

/** Write a key file of the installation. */
function writeKeyFile(name: string, content: string): void {
	const dir = join(tempHome, ".pi-harness-runtime", "keys");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), content, "utf8");
}

describe("the OpenAI key of the embedder", () => {
	it("takes the key of the environment", () => {
		process.env.OPENAI_API_KEY = "sk-openai-from-env";
		expect(getOpenAIApiKey()).toBe("sk-openai-from-env");
	});

	it("takes the key file of the installation", () => {
		writeKeyFile("openai-api-key.txt", "sk-openai-from-file\n");
		expect(getOpenAIApiKey()).toBe("sk-openai-from-file");
	});

	it("takes the token of a pi.dev login", () => {
		const dir = join(tempHome, ".pi", "agent");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({ openai: { access: "openai-oauth-token" } }),
			"utf8",
		);
		expect(getOpenAIApiKey()).toBe("openai-oauth-token");
	});

	it("never takes the key of another provider", () => {
		// A TypeSafe key and an OpenRouter key are different credentials:
		// the embeddings endpoint of OpenAI rejects them.
		process.env.TYPESAFE_API_KEY = "ts-key-of-another-provider";
		expect(getOpenAIApiKey()).toBeNull();

		process.env.OPENROUTER_API_KEY = "or-key-of-another-provider";
		expect(getOpenAIApiKey()).toBeNull();
	});

	it("prefers the OpenAI key over the key of another provider", () => {
		process.env.OPENAI_API_KEY = "sk-openai-from-env";
		process.env.TYPESAFE_API_KEY = "ts-key-of-another-provider";
		process.env.OPENROUTER_API_KEY = "or-key-of-another-provider";
		expect(getOpenAIApiKey()).toBe("sk-openai-from-env");
	});

	it("finds no key when there is none", () => {
		expect(getOpenAIApiKey()).toBeNull();
	});
});
