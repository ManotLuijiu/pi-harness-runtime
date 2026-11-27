/**
 * Test helpers.
 *
 * The fixtures live inside the package, never in the shared `/tmp`: a full
 * `bun test packages/` run is long enough that a temporary directory there
 * can disappear while the test is still running.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** A fresh temporary directory inside the package. */
export function makeTempDir(prefix: string): string {
	return mkdtempSync(join(PACKAGE_ROOT, `.test-${prefix}-`));
}

/**
 * A fresh temporary directory that belongs to no Git repository.
 *
 * The home directory is used because it is neither the shared `/tmp` nor part
 * of the repository under test.
 */
export function makePlainTempDir(prefix: string): string {
	return mkdtempSync(join(homedir(), `.test-${prefix}-`));
}

/**
 * Run the body with a fresh temporary directory and remove it afterwards.
 *
 * The directory lives only inside the body, never in a variable that a hook
 * could clean up at the wrong moment.
 */
export function withTempDir<T>(prefix: string, body: (dir: string) => T): T {
	const dir = makeTempDir(prefix);
	try {
		return body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Run the body with a fresh directory outside every Git repository. */
export function withPlainTempDir<T>(prefix: string, body: (dir: string) => T): T {
	const dir = makePlainTempDir(prefix);
	try {
		return body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Run an asynchronous body with a fresh temporary directory.
 *
 * The directory only disappears after the body finished: a synchronous
 * helper would remove it while the body is still running.
 */
export async function withTempDirAsync<T>(
	prefix: string,
	body: (dir: string) => Promise<T>,
): Promise<T> {
	const dir = makeTempDir(prefix);
	try {
		return await body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
