import type { PrivilegeRegistry } from "./types.js";
export declare class PrivilegeRegistryError extends Error {
    constructor(msg: string);
}
/** Default location relative to the package root. */
export declare const DEFAULT_PRIVILEGES_PATH: string;
/**
 * Load and validate the privilege registry from a YAML file.
 *
 * @throws {PrivilegeRegistryError} if the file is missing or invalid
 */
export declare function loadRegistry(path?: string): PrivilegeRegistry;
/** Lightweight validation — check required fields. */
export declare function validate(registry: PrivilegeRegistry): string[];
//# sourceMappingURL=registry.d.ts.map