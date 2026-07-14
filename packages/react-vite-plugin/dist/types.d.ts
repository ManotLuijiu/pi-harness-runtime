/**
 * React/Vite Plugin — Types (RFC-0063)
 */
export interface ReactViteAnalysis {
    framework: FrameworkInfo;
    version?: string;
    components: string[];
    pages: string[];
    plugins: string[];
    aliases: Record<string, string>;
    hasRouter: boolean;
    routerType?: string;
    configs: ConfigFile[];
}
export interface FrameworkInfo {
    id: string;
    name: string;
    category: string;
    description: string;
    tags: string[];
}
export interface ConfigFile {
    name: string;
    path: string;
}
//# sourceMappingURL=types.d.ts.map