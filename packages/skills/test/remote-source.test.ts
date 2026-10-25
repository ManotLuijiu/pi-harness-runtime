/**
 * The skills that live on the server.
 *
 * The vector store is an index - it says WHICH skill fits a question. The
 * service holds the authoritative files, so a machine without a local copy
 * can still use a skill.
 *
 * The states must stay apart: a service that refused the call needs a
 * different fix than a service that could not be reached, and both differ
 * from a service that holds nothing.
 *
 * The source is injected, so the test neither reaches the network nor
 * replaces a process-global module.
 */

import { describe, expect, it } from "bun:test";

import { createSkillRegistry } from "../src/loader.js";
import type { RemoteSkill, RemoteSkillSource } from "../src/remote-source.js";

/** A source that holds the given skills. */
class FakeSource implements RemoteSkillSource {
	/** The skills the source holds. */
	readonly skills: RemoteSkill[];
	/** The ids that were asked for. */
	readonly requested: string[] = [];
	/** The error the next call raises. */
	failure: { message: string; code: "denied" | "unavailable" } | null = null;

	constructor(skills: RemoteSkill[] = []) {
		this.skills = skills;
	}

	async list(): Promise<RemoteSkill[]> {
		if (this.failure) {
			const error = new Error(this.failure.message) as Error & {
				code: string;
			};
			error.code = this.failure.code;
			throw error;
		}
		return this.skills;
	}

	async get(id: string): Promise<RemoteSkill | null> {
		this.requested.push(id);
		if (this.failure) {
			const error = new Error(this.failure.message) as Error & {
				code: string;
			};
			error.code = this.failure.code;
			throw error;
		}
		return this.skills.find((skill) => skill.id === id) ?? null;
	}
}

describe("the skills of the server", () => {
	it("are listed by the registry", async () => {
		const source = new FakeSource([
			{
				id: "shared-skill",
				name: "shared-skill",
				description: "the shared skill",
				version: "1.2.0",
			},
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);

		const stats = await registry.refreshRemoteSkills();

		expect(stats.state).toBe("populated");
		expect(stats.count).toBe(1);
		expect(registry.listRemote().map((skill) => skill.id)).toEqual(["shared-skill"]);
		// The local count stays local.
		expect(registry.list()).toHaveLength(0);
	});

	it("are not local skills", async () => {
		const source = new FakeSource([
			{ id: "shared-skill", name: "shared-skill", description: "d", version: "1.0.0" },
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);
		await registry.refreshRemoteSkills();

		expect(registry.list()).toHaveLength(0);
		expect(registry.listRemote()).toHaveLength(1);
	});

	it("replace the cached skill when the version changed", async () => {
		const source = new FakeSource([
			{ id: "shared-skill", name: "shared-skill", description: "old", version: "1.0.0" },
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);
		await registry.refreshRemoteSkills();
		expect(registry.listRemote()[0].frontmatter.description).toBe("old");

		// The server publishes a new version.
		source.skills[0] = {
			id: "shared-skill",
			name: "shared-skill",
			description: "new",
			version: "1.1.0",
		};
		await registry.refreshRemoteSkills();

		expect(registry.listRemote()[0].frontmatter.description).toBe("new");
		expect(registry.listRemote()[0].frontmatter.version).toBe("1.1.0");
	});

	it("stay when the version is unknown", async () => {
		const source = new FakeSource([
			{ id: "shared-skill", name: "shared-skill", description: "known", version: "1.0.0" },
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);
		await registry.refreshRemoteSkills();

		// A record without a version is not evidence of a change.
		source.skills[0] = {
			id: "shared-skill",
			name: "shared-skill",
			description: "changed without a version",
		};
		await registry.refreshRemoteSkills();

		expect(registry.listRemote()[0].frontmatter.description).toBe("known");
	});

	it("are loaded completely from the service", async () => {
		const source = new FakeSource([
			{
				id: "shared-skill",
				name: "shared-skill",
				description: "the shared skill",
				version: "1.0.0",
				content: "the complete body of the skill",
				contentComplete: true,
			},
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);

		const loaded = await registry.load("shared-skill");

		expect(loaded).not.toBeNull();
		expect(loaded?.body).toBe("the complete body of the skill");
		expect(source.requested).toContain("shared-skill");
	});

	it("are not asked for again once the content is complete", async () => {
		const source = new FakeSource([
			{
				id: "shared-skill",
				name: "shared-skill",
				description: "d",
				version: "1.0.0",
				content: "the body",
				contentComplete: true,
			},
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);

		await registry.load("shared-skill");
		const afterFirst = source.requested.length;
		await registry.load("shared-skill");

		expect(source.requested.length).toBe(afterFirst);
	});

	it("are reported as empty when the service holds nothing", async () => {
		const registry = createSkillRegistry();
		registry.setRemoteSource(new FakeSource([]));

		const stats = await registry.refreshRemoteSkills();

		expect(stats.state).toBe("empty");
		expect(stats.count).toBe(0);
	});

	it("are reported as not configured without a service", async () => {
		const registry = createSkillRegistry();

		const stats = await registry.getRemoteStats();

		expect(stats.state).toBe("not-configured");
	});
});

describe("a service that does not answer", () => {
	it("reports a refusal as denied", async () => {
		const source = new FakeSource();
		source.failure = { message: "unauthorized", code: "denied" };
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);

		const stats = await registry.refreshRemoteSkills();

		expect(stats.state).toBe("denied");
		expect(stats.error).toContain("unauthorized");
	});

	it("reports an unreachable service as unavailable", async () => {
		const source = new FakeSource();
		source.failure = { message: "connection refused", code: "unavailable" };
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);

		const stats = await registry.refreshRemoteSkills();

		expect(stats.state).toBe("unavailable");
		expect(stats.error).toContain("connection refused");
	});

	it("keeps the cached skills after a failed refresh", async () => {
		const source = new FakeSource([
			{ id: "shared-skill", name: "shared-skill", description: "d", version: "1.0.0" },
		]);
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);
		await registry.refreshRemoteSkills();

		source.failure = { message: "connection refused", code: "unavailable" };
		const stats = await registry.refreshRemoteSkills();

		expect(stats.state).toBe("unavailable");
		// A failed refresh must not throw the cached skills away.
		expect(registry.listRemote()).toHaveLength(1);
	});

	it("does not put a credential into the message", async () => {
		const source = new FakeSource();
		source.failure = {
			message: "Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789 refused",
			code: "denied",
		};
		const registry = createSkillRegistry();
		registry.setRemoteSource(source);

		const stats = await registry.refreshRemoteSkills();

		expect(stats.error).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
	});
});
