/**
 * Prompt Versioning — Core (RFC-0019)
 */

import type {
	PromptVersion,
	PromptRecord,
	VersionDiff,
	RollbackResult,
	PromptVersioningConfig,
} from "./types.js";

let _counter = 0;
function nextId(): string {
	return `pv-${Date.now()}-${++_counter}`;
}

export class PromptVersioning {
	private prompts = new Map<string, PromptRecord>();
	private config: Required<PromptVersioningConfig>;

	constructor(config: PromptVersioningConfig = {}) {
		this.config = {
			maxVersions: config.maxVersions ?? 50,
			allowDelete: config.allowDelete ?? false,
			onVersionCreated: config.onVersionCreated ?? (() => {}),
		};
	}

	createPrompt(name: string, initialPrompt: string, createdBy?: string): PromptRecord {
		const v = this.makeVersion(initialPrompt, createdBy);
		const record: PromptRecord = {
			id: nextId(),
			name,
			versions: [v],
			activeVersion: v.version,
		};
		this.prompts.set(record.id, record);
		return record;
	}

	addVersion(promptId: string, prompt: string, createdBy?: string, tags?: string[]): PromptVersion {
		const record = this.getOrThrow(promptId);
		const v = this.makeVersion(prompt, createdBy, tags);
		record.versions.push(v);
		record.activeVersion = v.version;
		this.enforceMaxVersions(record);
		this.config.onVersionCreated(v);
		return v;
	}

	getVersion(promptId: string, version?: string): PromptVersion | null {
		const record = this.prompts.get(promptId);
		if (!record) return null;
		if (!version) {
			return record.versions.find((v) => v.version === record.activeVersion) ?? null;
		}
		return record.versions.find((v) => v.version === version) ?? null;
	}

	listVersions(promptId: string): PromptVersion[] {
		return this.get(promptId)?.versions ?? [];
	}

	diff(promptId: string, from: string, to: string): VersionDiff | null {
		const record = this.prompts.get(promptId);
		if (!record) return null;
		const fromV = record.versions.find((v) => v.version === from);
		const toV = record.versions.find((v) => v.version === to);
		if (!fromV || !toV) return null;

		const fromLines = fromV.prompt.split("\n");
		const toLines = toV.prompt.split("\n");
		const fromSet = new Set(fromLines);
		const toSet = new Set(toLines);

		const addedLines = toLines.filter((l) => !fromSet.has(l));
		const removedLines = fromLines.filter((l) => !toSet.has(l));

		return {
			from,
			to,
			added: addedLines.length,
			removed: removedLines.length,
			addedLines: addedLines.slice(0, 20),
			removedLines: removedLines.slice(0, 20),
		};
	}

	rollback(promptId: string, targetVersion: string): RollbackResult | null {
		const record = this.prompts.get(promptId);
		if (!record) return null;
		const target = record.versions.find((v) => v.version === targetVersion);
		if (!target) return null;

		const previous = record.activeVersion;
		record.activeVersion = targetVersion;
		return {
			promptId,
			rolledBackTo: targetVersion,
			currentVersion: record.activeVersion,
			previousVersion: previous,
		};
	}

	delete(promptId: string): boolean {
		if (!this.config.allowDelete) return false;
		return this.prompts.delete(promptId);
	}

	listPrompts(): PromptRecord[] {
		return [...this.prompts.values()];
	}

	getStats(promptId: string): { versionCount: number; activeVersion: string } | null {
		const r = this.prompts.get(promptId);
		return r ? { versionCount: r.versions.length, activeVersion: r.activeVersion } : null;
	}

	private makeVersion(prompt: string, createdBy?: string, tags?: string[]): PromptVersion {
		const version = `v${Date.now()}-${++_counter}`;
		const v: PromptVersion = {
			version,
			prompt,
			createdAt: new Date().toISOString(),
			createdBy,
			tags,
		};
		return v;
	}

	private enforceMaxVersions(record: PromptRecord): void {
		while (record.versions.length > this.config.maxVersions) {
			const oldest = record.versions[0];
			if (oldest.version === record.activeVersion) break;
			record.versions.shift();
		}
	}

	private get(promptId: string): PromptRecord | undefined {
		return this.prompts.get(promptId);
	}

	private getOrThrow(promptId: string): PromptRecord {
		const r = this.prompts.get(promptId);
		if (!r) throw new Error(`Prompt not found: ${promptId}`);
		return r;
	}
}
