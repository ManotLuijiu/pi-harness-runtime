/**
 * The approval of a scope proposal.
 *
 * A proposal of the backlog is a question that waits for an answer: every
 * channel that shows the question shows the same facts - the named issues
 * and the deadline - so the human knows what an approval would start.
 *
 * The network is captured instead of the adapter: a mocked adapter would
 * leak into every test file that is loaded after this one.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import { formatDetailLines } from "../src/adapters/detail-format.js";
import type { NotificationConfig } from "../src/types.js";

interface CapturedRequest {
	url: string;
	body: Record<string, any>;
}

let captured: CapturedRequest[] = [];
let originalFetch: typeof globalThis.fetch;

function createCenter(): NotificationCenter {
	const config: NotificationConfig = {
		channels: [
			{
				id: "telegram",
				type: "telegram",
				enabled: true,
				config: {
					botToken: "test-bot-token",
					chatId: "12345",
					enableInlineKeyboard: true,
				},
			},
			{
				id: "line",
				type: "line",
				enabled: true,
				config: { channelAccessToken: "test-line-token", userId: "U-test" },
			},
		],
	};
	return new NotificationCenter(config);
}

function lineRequests(): CapturedRequest[] {
	return captured.filter((request) => request.url.includes("api.line.me"));
}

beforeEach(() => {
	captured = [];
	originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: any, init?: any) => {
		const url = typeof input === "string" ? input : (input?.url ?? "");
		let body: any = {};
		try {
			body = JSON.parse(init?.body ?? "{}");
		} catch {
			body = {};
		}
		captured.push({ url, body });
		return new Response(JSON.stringify({ ok: true, result: {} }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("the approval of a scope proposal", () => {
	it("carries the named issues and the deadline on LINE", async () => {
		const center = createCenter();
		await center.notifyWithApproval("ScopeProposal", {
			jobId: "scope-1-bd-1",
			questionId: "q-scope-1",
			requirement: "work on bd-1 and bd-2",
			scopeIds: ["bd-1", "bd-2"],
			scopeDeadline: "2026-11-11T12:05:00.000Z",
		});

		const line = lineRequests()[0];
		expect(line).toBeDefined();
		const text = JSON.stringify(line.body);
		expect(text).toContain("bd-1");
		expect(text).toContain("bd-2");
		expect(text).toContain("2026-11-11T12:05:00.000Z");
	});

	it("renders the named issues and the deadline with the shared format", () => {
		const lines = formatDetailLines(
			{
				scopeIds: ["bd-1", "bd-2"],
				scopeDeadline: "2026-11-11T12:05:00.000Z",
			},
			"ScopeProposal",
		);
		expect(lines.map((line) => line.label)).toEqual(["Issues", "Deadline"]);
	});
});
