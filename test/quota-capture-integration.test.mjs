/**
 * The forced quota capture of a provider recovery.
 *
 * The recovery decides when to continue from the row of the mirror, and
 * the row of the mirror can be hours old. This suite wires the pieces the
 * way the harness wires them: a capture that refreshes the mirror, a
 * recovery that reads the refreshed row, and a capture that failed, which
 * proves nothing.
 *
 * The clock and the timers are injected, so every deadline here is exact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MirrorStore } from "../mirror.ts";
import { QuotaCaptureController } from "../harness/quota-capture.ts";
import { ProviderRecoveryRuntime } from "../harness/provider-recovery-runtime.ts";
import {
	confirmedQuotaReset,
	QUOTA_RESET_BUFFER_MS,
} from "../harness/provider-quota-reset.ts";
import { classifyProviderFailure } from "../harness/provider-failure.ts";
import { createProviderRecoveryController } from "../harness/provider-recovery.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

/** The failure of MiniMax that ran out of its plan. */
const USAGE_LIMIT = "MiniMax usage limit reached (2067)";

/** A mirror in a temporary directory. */
function tempMirror() {
	const dir = mkdtempSync(join(tmpdir(), "quota-capture-"));
	const store = new MirrorStore(join(dir, "mirror.json"));
	return { dir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A row of the mirror that is old enough to prove nothing. */
function staleRow(now) {
	return {
		synced_at: new Date(now - 45 * MINUTE).toISOString(),
		provider: "minimax",
		source: "scrape",
		h5_used_pct: 100,
		h5_resets_at_epoch: now + 102 * MINUTE,
	};
}

/** A row of the mirror that a fresh capture wrote. */
function freshRow(now) {
	return {
		synced_at: new Date(now).toISOString(),
		provider: "minimax",
		source: "scrape",
		h5_used_pct: 100,
		h5_resets_at_epoch: now + 102 * MINUTE,
	};
}

/**
 * The runtime, the capture and the mirror, wired the way the harness wires
 * them.
 */
function createWiring(overrides = {}) {
	const actions = createPendingActionRegistry();
	const controller = createProviderRecoveryController({ now: () => NOW });
	const dispatched = [];
	const state = { now: NOW, captureCalls: 0, capture: overrides.capture };

	const captureController = new QuotaCaptureController({
		capture: async (provider) => {
			state.captureCalls += 1;
			if (state.capture) return state.capture(provider, state);
			return true;
		},
		now: () => state.now,
		log: () => {},
		waitMs: overrides.waitMs ?? 50,
	});

	const runtime = new ProviderRecoveryRuntime({
		controller,
		actions,
		recoveryActionId: "provider-recovery",
		blockedActionId: "provider-blocked",
		overloadActionId: "provider-overload-resume",
		maxAttempts: 4,
		now: () => state.now,
		setTimeout: () => 1,
		clearTimeout: () => {},
		context: () => ({
			sessionId: "s-1",
			explicitlyPaused: false,
			questionPending: false,
			sessionBusy: false,
		}),
		// The evidence of the harness: a failed capture proves nothing, a
		// fresh row of the mirror decides.
		quotaResetEvidence: (failure, provider) => {
			if (captureController.failed(provider)) return undefined;
			return confirmedQuotaReset(
				failure,
				provider,
				store.readProvider(provider.toLowerCase()),
				state.now,
			);
		},
		dispatch: (reason) => {
			dispatched.push(reason);
		},
	});

	// eslint-disable-next-line no-undef
	const store = overrides.store;
	return { runtime, actions, dispatched, captureController, state, store };
}

test("a stale row of the mirror proves no deadline", () => {
	const { store, cleanup } = tempMirror();
	try {
		store.writeProvider("minimax", staleRow(NOW));
		const failure = classifyProviderFailure(USAGE_LIMIT);
		assert.equal(
			confirmedQuotaReset(failure, "minimax", store.readProvider("minimax"), NOW),
			undefined,
			"the row is too old to be evidence",
		);
	} finally {
		cleanup();
	}
});

test("the capture refreshes the mirror and the recovery waits for the reset", async () => {
	const { store, cleanup } = tempMirror();
	try {
		store.writeProvider("minimax", staleRow(NOW));
		const { runtime, actions, captureController, state } = createWiring({
			store,
			capture: async () => {
				store.writeProvider("minimax", freshRow(state.now));
				return true;
			},
		});

		const failure = classifyProviderFailure(USAGE_LIMIT);
		runtime.noteFailure(failure, "quota", { provider: "minimax", boundedEligible: true });
		// The harness starts the capture with the failure and waits for it
		// at the settled boundary.
		captureController.begin("minimax");
		await captureController.wait();
		runtime.noteSettled();

		const row = actions.get("provider-recovery");
		assert.equal(row.dueAt, NOW + 102 * MINUTE + QUOTA_RESET_BUFFER_MS);
		assert.equal(row.attempt, undefined, "the reset is not a short retry");
	} finally {
		cleanup();
	}
});

test("without the capture the recovery keeps the bounded cycle", async () => {
	const { store, cleanup } = tempMirror();
	try {
		store.writeProvider("minimax", staleRow(NOW));
		const { runtime, actions } = createWiring({ store });

		const failure = classifyProviderFailure(USAGE_LIMIT);
		runtime.noteFailure(failure, "quota", { provider: "minimax", boundedEligible: true });
		runtime.noteSettled();

		const row = actions.get("provider-recovery");
		assert.equal(row.attempt, 1, "the stale row did not decide the deadline");
	} finally {
		cleanup();
	}
});

test("a capture that failed proves nothing", async () => {
	const { store, cleanup } = tempMirror();
	try {
		store.writeProvider("minimax", staleRow(NOW));
		const { runtime, actions, captureController, state } = createWiring({
			store,
			capture: async () => {
				// The capture reports a fresh row, but it fails afterwards.
				store.writeProvider("minimax", freshRow(state.now));
				return false;
			},
		});

		const failure = classifyProviderFailure(USAGE_LIMIT);
		runtime.noteFailure(failure, "quota", { provider: "minimax", boundedEligible: true });
		captureController.begin("minimax");
		await captureController.wait();
		runtime.noteSettled();

		const row = actions.get("provider-recovery");
		assert.equal(row.attempt, 1, "a failed capture cannot prove a deadline");
	} finally {
		cleanup();
	}
});

test("a capture that throws is a failed capture, not a crash", async () => {
	const { store, cleanup } = tempMirror();
	try {
		store.writeProvider("minimax", staleRow(NOW));
		const { runtime, actions, captureController } = createWiring({
			store,
			capture: async () => {
				throw new Error("the browser is gone");
			},
		});

		const failure = classifyProviderFailure(USAGE_LIMIT);
		runtime.noteFailure(failure, "quota", { provider: "minimax", boundedEligible: true });
		captureController.begin("minimax");
		await captureController.wait();
		runtime.noteSettled();

		assert.equal(captureController.failed("minimax"), true);
		assert.equal(actions.get("provider-recovery").attempt, 1);
	} finally {
		cleanup();
	}
});

test("a capture that takes too long does not stop the recovery", async () => {
	const { store, cleanup } = tempMirror();
	try {
		store.writeProvider("minimax", staleRow(NOW));
		const { runtime, actions, captureController } = createWiring({
			store,
			waitMs: 20,
			capture: () => new Promise(() => {}),
		});

		const failure = classifyProviderFailure(USAGE_LIMIT);
		runtime.noteFailure(failure, "quota", { provider: "minimax", boundedEligible: true });
		captureController.begin("minimax");
		await captureController.wait();
		runtime.noteSettled();

		const row = actions.get("provider-recovery");
		assert.equal(row.attempt, 1, "the bounded cycle continues without a capture");
	} finally {
		cleanup();
	}
});
