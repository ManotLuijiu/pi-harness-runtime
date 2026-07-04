import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class FileSharedContextStore {
  constructor(private readonly rootDir: string) {}

  private jobPath(jobId: string, file: string): string {
    return join(this.rootDir, "jobs", jobId, file);
  }

  private async write(jobId: string, file: string, text: string): Promise<void> {
    const path = this.jobPath(jobId, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text.endsWith("\n") ? text : text + "\n", "utf-8");
  }

  private async read(jobId: string, file: string): Promise<string | null> {
    try {
      return await readFile(this.jobPath(jobId, file), "utf-8");
    } catch {
      return null;
    }
  }

  async writeRequirement(jobId: string, text: string): Promise<void> {
    await this.write(jobId, "requirement.md", text);
  }

  async readRequirement(jobId: string): Promise<string | null> {
    return await this.read(jobId, "requirement.md");
  }

  async writeResumePrompt(jobId: string, text: string): Promise<void> {
    await this.write(jobId, "resume_prompt.md", text);
  }

  async appendDecision(jobId: string, text: string): Promise<void> {
    const path = this.jobPath(jobId, "decisions.md");
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `\n## ${new Date().toISOString()}\n\n${text}\n`, "utf-8");
  }
}
