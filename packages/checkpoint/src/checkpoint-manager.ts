import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeCheckpoint, RuntimeEvent } from "../../types/src/runtime-types";

export class JsonCheckpointManager {
  constructor(private readonly rootDir: string) {}

  private jobDir(jobId: string): string {
    return join(this.rootDir, "jobs", jobId);
  }

  private checkpointPath(jobId: string): string {
    return join(this.jobDir(jobId), "checkpoint.json");
  }

  async save(checkpoint: RuntimeCheckpoint): Promise<void> {
    const path = this.checkpointPath(checkpoint.jobId);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(checkpoint, null, 2) + "\n", "utf-8");
    await rename(tmp, path);
  }

  async load(jobId: string): Promise<RuntimeCheckpoint | null> {
    try {
      const text = await readFile(this.checkpointPath(jobId), "utf-8");
      return JSON.parse(text) as RuntimeCheckpoint;
    } catch {
      return null;
    }
  }

  async appendEvent(jobId: string, event: RuntimeEvent): Promise<void> {
    const path = join(this.jobDir(jobId), "events.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(event) + "\n", "utf-8");
  }
}
