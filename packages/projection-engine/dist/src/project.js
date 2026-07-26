import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const PROJ_DIR = join(process.env["HOME"] ?? "/tmp", ".pi", "projections");
function ensureDir() {
    if (!existsSync(PROJ_DIR))
        mkdirSync(PROJ_DIR, { recursive: true });
}
export function saveProjection(name, data) {
    ensureDir();
    const proj = JSON.stringify({ name, version: 1, createdAt: new Date().toISOString(), data });
    appendFileSync(join(PROJ_DIR, `${name}.jsonl`), proj + "\n");
}
export function loadProjections(name) {
    const path = join(PROJ_DIR, `${name}.jsonl`);
    if (!existsSync(path))
        return [];
    try {
        return readFileSync(path, "utf8").split("\n").filter(Boolean);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=project.js.map