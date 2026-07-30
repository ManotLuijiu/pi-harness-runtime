/**
 * Privilege Registry — RFC-0101 §7
 *
 * Loads config/privileges.yaml at startup and provides:
 * - lookup(capability) → PrivilegeEntry | null
 * - knownCapabilities() → CapabilityName[]
 * - validate() → { valid: boolean; errors: string[] }
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
export class PrivilegeRegistryError extends Error {
    constructor(msg) {
        super(`[PrivilegeRegistryError] ${msg}`);
        this.name = "PrivilegeRegistryError";
    }
}
/** Default location relative to the package root. */
export const DEFAULT_PRIVILEGES_PATH = join(dirname(new URL(".", import.meta.url).pathname), "..", "config", "privileges.yaml");
/**
 * Load and validate the privilege registry from a YAML file.
 *
 * @throws {PrivilegeRegistryError} if the file is missing or invalid
 */
export function loadRegistry(path) {
    const filePath = path ?? DEFAULT_PRIVILEGES_PATH;
    if (!existsSync(filePath)) {
        throw new PrivilegeRegistryError(`privileges file not found at ${filePath}. Copy config/privileges.yaml.example to config/privileges.yaml and edit it.`);
    }
    let raw;
    try {
        const content = readFileSync(filePath, "utf8");
        raw = parseYaml(content);
    }
    catch (err) {
        throw new PrivilegeRegistryError(`failed to parse ${filePath}: ${err.message}`);
    }
    const registry = raw;
    // Validate
    const errors = validate(registry);
    if (errors.length > 0) {
        throw new PrivilegeRegistryError(`validation errors in ${filePath}:\n  ${errors.join("\n  ")}`);
    }
    return registry;
}
/** Lightweight validation — check required fields. */
export function validate(registry) {
    const errors = [];
    if (!registry || typeof registry !== "object") {
        errors.push("registry must be an object");
        return errors;
    }
    if (typeof registry.version !== "number") {
        errors.push("registry.version is required and must be a number");
    }
    if (!Array.isArray(registry.capabilities)) {
        errors.push("registry.capabilities must be an array");
        return errors;
    }
    for (const cap of registry.capabilities) {
        if (!cap.capability) {
            errors.push("each capability must have a 'capability' field");
        }
        if (!cap.description) {
            errors.push(`capability ${cap.capability} missing 'description'`);
        }
        if (!cap.approval_class) {
            errors.push(`capability ${cap.capability} missing 'approval_class'`);
        }
        if (!cap.actors || typeof cap.actors !== "object") {
            errors.push(`capability ${cap.capability} missing 'actors' object`);
        }
    }
    return errors;
}
//# sourceMappingURL=registry.js.map