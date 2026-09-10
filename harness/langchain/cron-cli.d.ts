/**
 * Cron task management CLI.
 *
 * Usage:
 *   bun harness/langchain/run.ts cron add <schedule> <request>
 *   bun harness/langchain/run.ts cron list
 *   bun harness/langchain/run.ts cron rm <task-id>
 *
 * Schedules: every-5m, every-10m, every-30m, hourly, daily, weekly
 */
export declare function runCron(argv: string[]): Promise<void>;
//# sourceMappingURL=cron-cli.d.ts.map
