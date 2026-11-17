/**
 * The state of the cookie source.
 *
 * Three facts are different and were conflated:
 *
 *  - discovery: a file exists in the drop folder.
 *  - import: the canonical cache exists, which only happens after a
 *    successful validation and normalization of a drop file.
 *  - authentication: the provider accepted the credential.
 *
 * The first two are facts about this machine and are cheap to read. The
 * third is a fact about the provider and only a fetch can establish it.
 * This module reports the first two; the runtime reports the third.
 *
 * Nothing here reads a cookie value: the state is a stage and a count.
 */
import { existsSync } from "node:fs";
import { enumerateDropFiles } from "./sync.js";
/**
 * Report the state of the cookie source.
 *
 * Never throws: an unreadable folder is a folder with no files.
 */
export function inspectCookieSource(options) {
    const dropDir = options.dropDir;
    const cachePath = options.cachePath ?? null;
    let dropFileCount = 0;
    try {
        dropFileCount = enumerateDropFiles(dropDir).length;
    }
    catch {
        dropFileCount = 0;
    }
    let cacheExists = false;
    if (cachePath) {
        try {
            cacheExists = existsSync(cachePath);
        }
        catch {
            cacheExists = false;
        }
    }
    let stage = "none";
    if (cacheExists) {
        stage = "imported";
    }
    else if (dropFileCount > 0) {
        stage = "discovered";
    }
    return { stage, dropFileCount, cacheExists, cachePath };
}
/**
 * Whether a source exists at all.
 *
 * The name says "exists", so it answers the discovery question and never
 * the authentication question.
 */
export function hasCookieSourceState(state) {
    return state.stage !== "none";
}
//# sourceMappingURL=source-state.js.map