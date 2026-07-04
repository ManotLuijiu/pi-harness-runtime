import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ScheduledJob {
  jobId: string;
  status: "scheduled" | "cancelled";
  reason: string;
  resumeAt: string;
}

export class JsonRuntimeScheduler {
  constructor(private readonly rootDir: string) {}

  private schedulePath(): string {
    return join(this.rootDir, "schedule.json");
  }

  async readAll(): Promise<ScheduledJob[]> {
    try {
      const text = await readFile(this.schedulePath(), "utf-8");
      return JSON.parse(text) as ScheduledJob[];
    } catch {
      return [];
    }
  }

  async writeAll(jobs: ScheduledJob[]): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.schedulePath(), JSON.stringify(jobs, null, 2) + "\n", "utf-8");
  }

  async scheduleResume(jobId: string, resumeAt: string, reason: string): Promise<void> {
    const jobs = (await this.readAll()).filter((j) => j.jobId !== jobId);
    jobs.push({ jobId, status: "scheduled", resumeAt, reason });
    await this.writeAll(jobs);
  }

  async dueJobs(now: Date = new Date()): Promise<string[]> {
    const nowMs = now.getTime();
    return (await this.readAll())
      .filter((j) => j.status === "scheduled")
      .filter((j) => Date.parse(j.resumeAt) <= nowMs)
      .map((j) => j.jobId);
  }

  async cancel(jobId: string): Promise<void> {
    const jobs = await this.readAll();
    await this.writeAll(jobs.map((j) => j.jobId === jobId ? { ...j, status: "cancelled" } : j));
  }
}
