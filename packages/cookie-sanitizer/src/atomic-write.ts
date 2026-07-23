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

import {
	mkdirSync,
	openSync,
	writeSync,
	fsyncSync,
	closeSync,
	renameSync,
	chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
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
export function atomicWriteFileSync(finalPath: string, content: string): void {
	mkdirSync(dirname(finalPath), { recursive: true });

	const rand = randomBytes(6).toString("hex");
	const tempPath = `${finalPath}.tmp.${rand}`;

	let fd: number | undefined;
	try {
		fd = openSync(tempPath, "w", 0o600);
		writeSync(fd, Buffer.from(content, "utf8"));
		fsyncSync(fd);
	} finally {
		if (fd !== undefined) closeSync(fd);
	}

	renameSync(tempPath, finalPath);

	// Belt-and-braces in case rename preserved a looser mode from an
	// existing file on some systems.
	try {
		chmodSync(finalPath, 0o600);
	} catch {
		// Filesystems that don't support chmod (e.g. FAT32) are not a
		// target platform here — drop the error silently.
	}
}

/**
 * Compute the default cache path for a given provider, e.g.:
 *   defaultCachePathFor("minimax") → "~/.config/minimax-cookies.txt"
 *
 * The home directory is read via `process.env.HOME` so tests can
 * override it.
 */
export function defaultCachePathFor(provider: ProviderId): string {
	const home = process.env.HOME ?? "/tmp";
	return join(home, ".config", `${provider}-cookies.txt`);
}
