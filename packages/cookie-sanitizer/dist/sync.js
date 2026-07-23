/**
 * Sync orchestrator — the heart of the sanitizer.
 *
 * Pipeline (per run):
 *   1. Enumerate files in the drop folder (one level + one sublevel).
 *   2. Read each file. Detect format. Parse.
 *   3. Concatenate cookies from all parsed files.
 *   4. Infer provider from filename + cookies.
 *   5. Normalize (dedupe, expire, domain-match).
 *   6. Serialize to Netscape and write to the canonical cache (atomic).
 *
 * Returns a SyncResult. Never throws — returns structured errors in `result.errors`.
 *
 * Sec-001: Cookie VALUES never appear in any log line. Diagnostics
 * use file basenames and 64-char previews with values redacted.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildDetectedFile, safePreview } from "./detect-format.js";
import { parseNetscape, serializeNetscape } from "./parse-netscape.js";
import { parseEditThisCookieJson } from "./parse-json.js";
import { normalize } from "./normalize.js";
import { inferProvider } from "./infer-provider.js";
import { atomicWriteFileSync, defaultCachePathFor } from "./atomic-write.js";
/** Max depth for the drop-folder walk (one-level + one subfolder). */
const MAX_DEPTH = 2;
/** Max size of a single input file we'll parse (5 MB). */
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
/** Default drop-folder location. */
export const DEFAULT_DROP_DIR = join(process.env.HOME ?? "/tmp", ".pi-harness-runtime", "cookies");
/**
 * Enumerate readable files inside `dir`, up to MAX_DEPTH.
 * Returns absolute paths. Skips dotfiles, editor temp files.
 *
 * `excludePath` (optional) — absolute path of a file to skip, e.g.
 * the canonical cache file (so we never recursively read it).
 */
export function enumerateDropFiles(dir, excludePath) {
    if (!existsSync(dir))
        return [];
    let stat;
    try {
        stat = statSync(dir);
    }
    catch {
        return [];
    }
    if (!stat.isDirectory())
        return [];
    const result = [];
    function walk(current, depth) {
        if (depth > MAX_DEPTH)
            return;
        let entries;
        try {
            entries = readdirSync(current);
        }
        catch {
            return;
        }
        for (const name of entries) {
            // Skip dotfiles, editor temp/swap.
            if (name.startsWith("."))
                continue;
            if (name.endsWith("~") || name.endsWith(".swp"))
                continue;
            const full = join(current, name);
            if (excludePath && full === excludePath)
                continue;
            let st;
            try {
                st = statSync(full);
            }
            catch {
                continue;
            }
            if (st.isFile()) {
                result.push(full);
            }
            else if (st.isDirectory() && depth < MAX_DEPTH) {
                walk(full, depth + 1);
            }
        }
    }
    walk(dir, 0);
    return result;
}
/**
 * Read a single input file as text, capped at MAX_INPUT_BYTES.
 * Returns null + a `reason` if the file can't be read.
 */
export function readInputFile(filePath) {
    let stat;
    try {
        stat = statSync(filePath);
    }
    catch {
        return { text: "", reason: "file not accessible" };
    }
    if (!stat.isFile())
        return { text: "", reason: "not a regular file" };
    if (stat.size > MAX_INPUT_BYTES) {
        return { text: "", reason: `file too large (${stat.size} bytes)` };
    }
    try {
        return { text: readFileSync(filePath, "utf8") };
    }
    catch (e) {
        return {
            text: "",
            reason: `read failed: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}
/**
 * Run the full sync pipeline.
 *
 * Options:
 *   - dropDir      default: ~/.pi-harness-runtime/cookies/
 *   - cachePath    default: ~/.config/<provider>-cookies.txt
 *   - providerHint override inference (skips filename/domain checks)
 *   - dryRun       skip the actual file write (still returns would-be result)
 *
 * Returns a SyncResult. Never throws.
 */
export function sync(opts = {}) {
    const dropDir = opts.dropDir ?? DEFAULT_DROP_DIR;
    const tmpResult = {
        provider: null,
        processedFiles: [],
        skippedFiles: [],
        totalCookies: 0,
        cachePath: "",
        sourceDir: dropDir,
        wrote: false,
        errors: [],
    };
    const files = enumerateDropFiles(dropDir, opts.cachePath);
    if (files.length === 0) {
        // Nothing to do — no error, just nothing. Caller decides whether
        // to surface this to the user.
        return tmpResult;
    }
    const allCookies = [];
    let firstBasename;
    for (const filePath of files) {
        const { text, reason } = readInputFile(filePath);
        if (reason) {
            const det = buildDetectedFile(filePath, "");
            tmpResult.skippedFiles.push({ basename: det.basename, reason });
            tmpResult.errors.push({ basename: det.basename, message: reason });
            continue;
        }
        const det = buildDetectedFile(filePath, text);
        if (det.format == null) {
            const preview = safePreview(text);
            tmpResult.skippedFiles.push({
                basename: det.basename,
                reason: `unrecognised format (preview: ${preview})`,
            });
            tmpResult.errors.push({
                basename: det.basename,
                message: "unrecognised format",
            });
            continue;
        }
        let cookies = [];
        if (det.format === "netscape") {
            cookies = parseNetscape(text);
        }
        else if (det.format === "edit-this-cookie-json") {
            cookies = parseEditThisCookieJson(text);
        }
        if (cookies.length === 0) {
            tmpResult.skippedFiles.push({
                basename: det.basename,
                reason: `${det.format} parsed but yielded 0 cookies`,
            });
            continue;
        }
        allCookies.push(...cookies);
        tmpResult.processedFiles.push(det.basename);
        if (!firstBasename)
            firstBasename = det.basename;
    }
    if (allCookies.length === 0) {
        return tmpResult;
    }
    const provider = inferProvider(firstBasename, allCookies, opts.providerHint);
    if (!provider) {
        tmpResult.errors.push({
            basename: firstBasename ?? "<unknown>",
            message: "could not infer provider (no filename/domain match)",
        });
        return tmpResult;
    }
    tmpResult.provider = provider;
    const cachePath = opts.cachePath ?? defaultCachePathFor(provider);
    tmpResult.cachePath = cachePath;
    const normalized = normalize(allCookies, provider);
    tmpResult.totalCookies = normalized.length;
    if (normalized.length === 0) {
        // All cookies were filtered (expired / wrong domain).
        tmpResult.errors.push({
            basename: firstBasename ?? "<unknown>",
            message: "all cookies filtered (expired or wrong-provider domain)",
        });
        return tmpResult;
    }
    if (opts.dryRun) {
        tmpResult.wrote = false;
        return tmpResult;
    }
    const serialized = serializeNetscape(normalized);
    try {
        atomicWriteFileSync(cachePath, serialized);
        tmpResult.wrote = true;
    }
    catch (e) {
        tmpResult.errors.push({
            basename: firstBasename ?? "<unknown>",
            message: `atomic write failed: ${e instanceof Error ? e.message : String(e)}`,
        });
    }
    return tmpResult;
}
/**
 * Has-any-input check: true if the drop folder has anything readable.
 * Cheap — does a single `readdirSync`; no parsing.
 */
export function hasAnyCookieSource(dropDir = DEFAULT_DROP_DIR) {
    return enumerateDropFiles(dropDir).length > 0;
}
/**
 * Convenience: cache path for the dominant provider in the drop folder,
 * or null if nothing's there. Used by `footer-status.ts` to ask "should
 * the footer hint point at this provider?"
 */
export function inferCachePath(dropDir = DEFAULT_DROP_DIR) {
    const files = enumerateDropFiles(dropDir);
    if (files.length === 0)
        return null;
    let firstBasename;
    const cookies = [];
    for (const fp of files) {
        const { text } = readInputFile(fp);
        if (!text)
            continue;
        const det = buildDetectedFile(fp, text);
        if (!det.format)
            continue;
        if (det.format === "netscape")
            cookies.push(...parseNetscape(text));
        else if (det.format === "edit-this-cookie-json")
            cookies.push(...parseEditThisCookieJson(text));
        if (!firstBasename)
            firstBasename = det.basename;
    }
    const provider = inferProvider(firstBasename, cookies);
    if (!provider)
        return null;
    return defaultCachePathFor(provider);
}
export { inferProvider, inferProviderFromFilename, inferProviderFromCookies, } from "./infer-provider.js";
export { defaultCachePathFor } from "./atomic-write.js";
//# sourceMappingURL=sync.js.map