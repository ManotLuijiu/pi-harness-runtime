/**
 * GitHub Login — /github-login slash command
 *
 * Registers the /github-login command that prompts for GitHub PAT
 * and creates a secret Gist for clipboard sync.
 */
/**
 * Register /github-login command in pi-coding-agent
 */
export declare function registerGithubLoginCommand(pi: {
    registerCommand: (name: string, options: {
        description: string;
        handler: (args: string, ctx: unknown) => Promise<void>;
    }) => void;
}): void;
//# sourceMappingURL=github-login.d.ts.map