export declare class FileSharedContextStore {
    private readonly rootDir;
    constructor(rootDir: string);
    private jobPath;
    private write;
    private read;
    writeRequirement(jobId: string, text: string): Promise<void>;
    readRequirement(jobId: string): Promise<string | null>;
    writeResumePrompt(jobId: string, text: string): Promise<void>;
    appendDecision(jobId: string, text: string): Promise<void>;
}
//# sourceMappingURL=shared-context.d.ts.map