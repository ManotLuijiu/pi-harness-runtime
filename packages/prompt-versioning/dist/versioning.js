/**
 * Prompt Versioning — Core (RFC-0019)
 */
let _counter = 0;
function nextId() {
    return `pv-${Date.now()}-${++_counter}`;
}
export class PromptVersioning {
    prompts = new Map();
    config;
    constructor(config = {}) {
        this.config = {
            maxVersions: config.maxVersions ?? 50,
            allowDelete: config.allowDelete ?? false,
            onVersionCreated: config.onVersionCreated ?? (() => { }),
        };
    }
    createPrompt(name, initialPrompt, createdBy) {
        const v = this.makeVersion(initialPrompt, createdBy);
        const record = {
            id: nextId(),
            name,
            versions: [v],
            activeVersion: v.version,
        };
        this.prompts.set(record.id, record);
        return record;
    }
    addVersion(promptId, prompt, createdBy, tags) {
        const record = this.getOrThrow(promptId);
        const v = this.makeVersion(prompt, createdBy, tags);
        record.versions.push(v);
        record.activeVersion = v.version;
        this.enforceMaxVersions(record);
        this.config.onVersionCreated(v);
        return v;
    }
    getVersion(promptId, version) {
        const record = this.prompts.get(promptId);
        if (!record)
            return null;
        if (!version) {
            return record.versions.find((v) => v.version === record.activeVersion) ?? null;
        }
        return record.versions.find((v) => v.version === version) ?? null;
    }
    listVersions(promptId) {
        return this.get(promptId)?.versions ?? [];
    }
    diff(promptId, from, to) {
        const record = this.prompts.get(promptId);
        if (!record)
            return null;
        const fromV = record.versions.find((v) => v.version === from);
        const toV = record.versions.find((v) => v.version === to);
        if (!fromV || !toV)
            return null;
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
    rollback(promptId, targetVersion) {
        const record = this.prompts.get(promptId);
        if (!record)
            return null;
        const target = record.versions.find((v) => v.version === targetVersion);
        if (!target)
            return null;
        const previous = record.activeVersion;
        record.activeVersion = targetVersion;
        return {
            promptId,
            rolledBackTo: targetVersion,
            currentVersion: record.activeVersion,
            previousVersion: previous,
        };
    }
    delete(promptId) {
        if (!this.config.allowDelete)
            return false;
        return this.prompts.delete(promptId);
    }
    listPrompts() {
        return [...this.prompts.values()];
    }
    getStats(promptId) {
        const r = this.prompts.get(promptId);
        return r ? { versionCount: r.versions.length, activeVersion: r.activeVersion } : null;
    }
    makeVersion(prompt, createdBy, tags) {
        const version = `v${Date.now()}-${++_counter}`;
        const v = {
            version,
            prompt,
            createdAt: new Date().toISOString(),
            createdBy,
            tags,
        };
        return v;
    }
    enforceMaxVersions(record) {
        while (record.versions.length > this.config.maxVersions) {
            const oldest = record.versions[0];
            if (oldest.version === record.activeVersion)
                break;
            record.versions.shift();
        }
    }
    get(promptId) {
        return this.prompts.get(promptId);
    }
    getOrThrow(promptId) {
        const r = this.prompts.get(promptId);
        if (!r)
            throw new Error(`Prompt not found: ${promptId}`);
        return r;
    }
}
//# sourceMappingURL=versioning.js.map