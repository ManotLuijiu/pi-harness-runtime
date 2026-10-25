/**
 * The server-held skills.
 *
 * The vector store holds an INDEX: the name, the description and a
 * truncated body. That is enough to FIND a skill, but not to use it - a
 * complete SKILL.md (with its references and examples) is larger than a
 * vector store payload should be.
 *
 * The remote source is therefore the authoritative store of the complete
 * skill content. It is reached through an authenticated service, so the
 * SERVER decides which skills this user may see. A client never decides
 * that on its own.
 */
/**
 * A skill from a remote record.
 *
 * The record carries the content, so the skill is usable without a local
 * copy. The path stays empty: a server skill has no directory on this
 * machine.
 */
export function skillFromRemote(record) {
    const version = record.version;
    return {
        id: record.id,
        path: "",
        frontmatter: {
            name: record.name,
            description: record.description,
            ...(version ? { version } : {}),
        },
        body: record.content ?? "",
        references: [],
        examples: [],
        metadata: {
            name: record.name,
            description: record.description,
            ...(version ? { version } : {}),
            ...(record.updatedAt ? { updated_at: record.updatedAt } : {}),
        },
        loaded: true,
    };
}
/**
 * The version of a cached remote skill.
 *
 * A skill without a version cannot be compared - the cache keeps it.
 */
export function remoteVersion(skill) {
    return skill?.frontmatter.version ?? skill?.metadata.version;
}
/**
 * The safe reason of a failed call.
 *
 * The message never carries a credential: a token that a service echoed
 * back is removed before the message leaves the process.
 */
export function describeRemoteFailure(error) {
    const raw = error instanceof Error ? error.message : String(error ?? "");
    const safe = raw
        .replace(/bearer\s+\S+/gi, "bearer <redacted>")
        .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>")
        .replace(/\s+/g, " ")
        .trim();
    return safe.slice(0, 200) || "the service could not be reached";
}
/**
 * Whether the cached skill is older than the record.
 *
 * A record without a version never replaces a cached skill: an unknown
 * version is not evidence of a change.
 */
export function isStale(cached, record) {
    if (!cached)
        return true;
    if (!record.version)
        return false;
    return remoteVersion(cached) !== record.version;
}
//# sourceMappingURL=remote-source.js.map