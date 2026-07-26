export interface ContextCandidate {
    id: string;
    kind: "source" | "doc" | "okf" | "skill" | "test" | "config";
    path: string;
    title: string;
    content: string;
    tokens: number;
    trust: "high" | "medium" | "low";
    tags: string[];
}
export interface DiscoveryOptions {
    root: string;
    task?: string;
    limit?: number;
}
//# sourceMappingURL=types.d.ts.map