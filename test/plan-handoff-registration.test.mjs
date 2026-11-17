/**
 * The registration of the running Pi instance.
 *
 * The instance writes a registration into the store of the plan handoff, so
 * a sender can find the recipient of a plan in the same workspace.
 *
 * The tests use a temporary directory and a fake clock: no real session, no
 * real store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startPlanHandoffRegistration } from "../harness/plan-handoff-registration.ts";
import { RegistrationStore, resolveRecipient } from "../packages/plan-handoff/dist/index.js";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "plan-handoff-registration-"));
}

test("the instance registers itself in its workspace", () => {
	const directory = join(temporary(), "agents");
	const generationFile = join(temporary(), "generation.json");
	const workspace = join(temporary(), "workspace");
	const agent = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace,
		host: "host-a",
		modelLabel: "minimax",
		generationFile,
		store: new RegistrationStore(directory, { now: () => 1_000 }),
		now: () => 1_000,
	});

	try {
		const registrations = new RegistrationStore(directory).list();
		assert.equal(registrations.length, 1);
		assert.equal(registrations[0].agentId, agent.agentId);
		assert.equal(registrations[0].sessionId, "session-1");
		assert.equal(registrations[0].modelLabel, "minimax");
		assert.equal(registrations[0].host, "host-a");
	} finally {
		agent.stop();
	}
});

test("the registration is removed when the instance stops", () => {
	const directory = join(temporary(), "agents");
	const generationFile = join(temporary(), "generation.json");
	const agent = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace: join(temporary(), "workspace"),
		generationFile,
		store: new RegistrationStore(directory, { now: () => 1_000 }),
		now: () => 1_000,
	});

	assert.equal(new RegistrationStore(directory).list().length, 1);
	agent.stop();
	assert.equal(new RegistrationStore(directory).list().length, 0);
});

test("a restart raises the generation", () => {
	const generationFile = join(temporary(), "generation.json");
	const first = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace: join(temporary(), "workspace"),
		generationFile,
		store: new RegistrationStore(join(temporary(), "agents"), {
			now: () => 1_000,
		}),
		now: () => 1_000,
	});
	first.stop();

	const second = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace: join(temporary(), "workspace"),
		generationFile,
		store: new RegistrationStore(join(temporary(), "agents"), {
			now: () => 1_000,
		}),
		now: () => 1_000,
	});
	try {
		assert.ok(second.generation > first.generation);
	} finally {
		second.stop();
	}
});

test("the generation counter survives the end of a session", () => {
	const generationFile = join(temporary(), "generation.json");
	const agent = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace: join(temporary(), "workspace"),
		generationFile,
		store: new RegistrationStore(join(temporary(), "agents"), {
			now: () => 1_000,
		}),
		now: () => 1_000,
	});
	agent.stop();

	assert.ok(existsSync(generationFile));
	const written = JSON.parse(readFileSync(generationFile, "utf8"));
	assert.equal(typeof written.generation, "number");
});

test("the registered instance is the recipient of a plan of its workspace", () => {
	const directory = join(temporary(), "agents");
	const workspace = join(temporary(), "workspace");
	const agent = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace,
		host: "host-a",
		generationFile: join(temporary(), "generation.json"),
		store: new RegistrationStore(directory, { now: () => 1_000 }),
		now: () => 1_000,
	});

	try {
		const result = resolveRecipient({
			workspace,
			host: "host-a",
			registrations: new RegistrationStore(directory, { now: () => 1_000 }).live(
				1_000,
			),
		});
		assert.equal(result.status, "selected");
		assert.equal(result.registration?.agentId, agent.agentId);
	} finally {
		agent.stop();
	}
});

test("a plan of another workspace never reaches the instance", () => {
	const directory = join(temporary(), "agents");
	const workspace = join(temporary(), "workspace");
	const agent = startPlanHandoffRegistration({
		sessionId: "session-1",
		workspace,
		host: "host-a",
		generationFile: join(temporary(), "generation.json"),
		store: new RegistrationStore(directory, { now: () => 1_000 }),
		now: () => 1_000,
	});

	try {
		const result = resolveRecipient({
			workspace: join(temporary(), "other-workspace"),
			host: "host-a",
			registrations: new RegistrationStore(directory, { now: () => 1_000 }).live(
				1_000,
			),
		});
		assert.equal(result.status, "awaiting");
		assert.equal(result.registration, undefined);
	} finally {
		agent.stop();
	}
});
