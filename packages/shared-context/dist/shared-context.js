import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export class FileSharedContextStore {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    jobPath(jobId, file) {
        return join(this.rootDir, "jobs", jobId, file);
    }
    async write(jobId, file, text) {
        const path = this.jobPath(jobId, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text.endsWith("\n") ? text : text + "\n", "utf-8");
    }
    async read(jobId, file) {
        try {
            return await readFile(this.jobPath(jobId, file), "utf-8");
        }
        catch {
            return null;
        }
    }
    async writeRequirement(jobId, text) {
        await this.write(jobId, "requirement.md", text);
    }
    async readRequirement(jobId) {
        return await this.read(jobId, "requirement.md");
    }
    async writeResumePrompt(jobId, text) {
        await this.write(jobId, "resume_prompt.md", text);
    }
    async appendDecision(jobId, text) {
        const path = this.jobPath(jobId, "decisions.md");
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `\n## ${new Date().toISOString()}\n\n${text}\n`, "utf-8");
    }
}
//# sourceMappingURL=shared-context.js.map