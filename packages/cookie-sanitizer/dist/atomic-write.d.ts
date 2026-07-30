/**
 * Atomic file write — write to temp, fsync, then rename.
 *
 * POSIX `rename(2)` is atomic — on partial-write crash, the prior target
 * file remains valid. We pair this with `fsync(tempfile)` so the temp
 * file's data is durable on disk before the rename.
 *
 * Permissions: `0o600` (owner R/W only) to keep the canonical cache
 * owner-readable.
 *
 * Sec-001: Cookie values go into the file content. The caller is
 * responsible for value-handling hygiene; this module just writes
 * bytes. We do not log the content.
 */
import type { ProviderId } from "./types.js";
/**
 * Atomically write `content` to `finalPath`.
 *
 * Steps:
 *   1. mkdir -p the parent directory
 *   2. write to <finalPath>.tmp.<rand>  with mode 0o600
 *   3. fsync the temp file
 *   4. rename temp → final  (atomic on POSIX)
 *   5. chmod final to 0o600  (in case rename preserved looser perms)
 *
 * Throws if any step fails. The original `finalPath` is unchanged
 * until step 4 succeeds.
 */
export declare function atomicWriteFileSync(finalPath: string, content: string): void;
/**
 * Compute the default cache path for a given provider, e.g.:
 *   defaultCachePathFor("minimax") → "~/.config/minimax-cookies.txt"
 *
 * The home directory is read via `process.env.HOME` so tests can
 * override it.
 */
export declare function defaultCachePathFor(provider: ProviderId): string;
//# sourceMappingURL=atomic-write.d.ts.map