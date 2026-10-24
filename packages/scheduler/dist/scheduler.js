import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export class JsonRuntimeScheduler {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    schedulePath() {
        return join(this.rootDir, "schedule.json");
    }
    async readAll() {
        try {
            const text = await readFile(this.schedulePath(), "utf-8");
            return JSON.parse(text);
        }
        catch {
            return [];
        }
    }
    async writeAll(jobs) {
        await mkdir(this.rootDir, { recursive: true });
        await writeFile(this.schedulePath(), JSON.stringify(jobs, null, 2) + "\n", "utf-8");
    }
    async scheduleResume(jobId, resumeAt, reason) {
        const jobs = (await this.readAll()).filter((j) => j.jobId !== jobId);
        jobs.push({ jobId, status: "scheduled", resumeAt, reason });
        await this.writeAll(jobs);
    }
    async dueJobs(now = new Date()) {
        const nowMs = now.getTime();
        return (await this.readAll())
            .filter((j) => j.status === "scheduled")
            .filter((j) => Date.parse(j.resumeAt) <= nowMs)
            .map((j) => j.jobId);
    }
    async cancel(jobId) {
        const jobs = await this.readAll();
        await this.writeAll(jobs.map((j) => j.jobId === jobId ? { ...j, status: "cancelled" } : j));
    }
}
//# sourceMappingURL=scheduler.js.map