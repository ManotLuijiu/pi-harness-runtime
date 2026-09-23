/**
 * Environment Judge - Verify environment before destructive operations
 *
 * Uses Jev to determine if agent is running on Dev or Prod server
 * and whether it's safe to run build/restart commands.
 *
 * Problem: Agent gets confused and tries SSH to server it's already on.
 * Solution: Jev analyzes environment context to guide safe operations.
 */

import { JevJudge, getApiKeyFromEnv } from "./index.js";

/**
 * Environment context
 */
export interface EnvironmentContext {
  hostname?: string;
  currentPath?: string;
  isRemoteSession?: boolean;
  hasSSHConnection?: boolean;
  gitRemote?: string;
  isProduction?: boolean;
}

/**
 * Environment decision result
 */
export interface EnvironmentDecision {
  isLocal: boolean;
  isRemote: boolean;
  likelyServer?: "dev" | "prod" | "unknown";
  confidence: "high" | "medium" | "low";
  reasoning: string;
  warnings: string[];
  recommendedActions: string[];
}

/**
 * Build/restart safety check
 */
export interface SafetyCheck {
  safe: boolean;
  isLocal: boolean;
  targetServer?: "dev" | "prod" | "unknown";
  warnings: string[];
  requiresConfirmation: boolean;
  recommendedCommand?: string;
}

/**
 * Environment Judge configuration
 */
export interface EnvironmentConfig {
  devPatterns?: string[];
  prodPatterns?: string[];
}

const DEFAULT_CONFIG = {
  devPatterns: ["dev", "staging", "test", "local"],
  prodPatterns: ["prod", "production", "live", "主站"],
};

export class EnvironmentJudge {
  private jev?: JevJudge;
  private config: Required<EnvironmentConfig>;

  constructor(config: EnvironmentConfig = {}) {
    this.config = {
      devPatterns: config.devPatterns ?? DEFAULT_CONFIG.devPatterns,
      prodPatterns: config.prodPatterns ?? DEFAULT_CONFIG.prodPatterns,
    } as Required<EnvironmentConfig>;

    const apiKey = getApiKeyFromEnv();
    if (apiKey) {
      try {
        this.jev = new JevJudge({ apiKey });
      } catch {
        // Jev not available
      }
    }
  }

  async analyze(context?: EnvironmentContext): Promise<EnvironmentDecision> {
    const ctx = context ?? (await this.detectEnvironment());
    return this.makeDecision(ctx);
  }

  async checkBuildSafety(context?: EnvironmentContext): Promise<SafetyCheck> {
    const env = await this.analyze(context);
    const warnings: string[] = [];

    if (!env.isLocal) {
      warnings.push(`Running on remote server (${env.likelyServer ?? "unknown"})`);
    }

    if (env.likelyServer === "prod") {
      warnings.push("⚠️ WARNING: This appears to be a PRODUCTION server!");
    }

    return {
      safe: env.likelyServer !== "prod",
      isLocal: env.isLocal,
      targetServer: env.likelyServer,
      warnings,
      requiresConfirmation: env.likelyServer === "prod",
      recommendedCommand: env.isLocal ? "build locally" : `ssh to target server first, then build`,
    };
  }

  async checkSSHCommand(host: string, command: string): Promise<SafetyCheck> {
    const env = await this.analyze();
    const isLocalHost = this.isLocalHost(host);

    if (isLocalHost && env.isLocal) {
      return {
        safe: true,
        isLocal: true,
        targetServer: env.likelyServer,
        warnings: [],
        requiresConfirmation: false,
      };
    }

    if (isLocalHost && !env.isLocal) {
      return {
        safe: false,
        isLocal: false,
        targetServer: env.likelyServer,
        warnings: [
          `⚠️ You're already on this server via SSH!`,
          `Running '${command}' directly would be more efficient.`,
        ],
        requiresConfirmation: true,
        recommendedCommand: command,
      };
    }

    return {
      safe: true,
      isLocal: false,
      targetServer: this.guessServer(host),
      warnings: [],
      requiresConfirmation: false,
    };
  }

  private async detectEnvironment(): Promise<EnvironmentContext> {
    const os = await import("os");

    const hostname = os.hostname();
    const cwd = process.cwd();
    const sshConnection = process.env.SSH_CONNECTION || process.env.SSH_CLIENT;
    const hasSSHConnection = !!(sshConnection);

    let gitRemote = "";
    try {
      const { execSync } = await import("child_process");
      gitRemote = execSync("git remote get-url origin 2>/dev/null || echo ''", { encoding: "utf8" }).trim();
    } catch {
      // Ignore
    }

    return {
      hostname,
      currentPath: cwd,
      isRemoteSession: hasSSHConnection,
      hasSSHConnection,
      gitRemote,
      isProduction: this.detectProduction(hostname),
    };
  }

  private detectProduction(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return (
      this.config.prodPatterns.some((p) => lower.includes(p)) ||
      /^(prod|production|live|主站)/.test(hostname)
    );
  }

  private isLocalHost(host: string): boolean {
    const hostname = process.env.HOSTNAME || "unknown";
    const localhosts = ["localhost", "127.0.0.1", "0.0.0.0", hostname];
    return localhosts.some((l) => host.includes(l));
  }

  private guessServer(host: string): "dev" | "prod" | "unknown" {
    const lower = host.toLowerCase();
    if (this.config.prodPatterns.some((p) => lower.includes(p))) return "prod";
    if (this.config.devPatterns.some((p) => lower.includes(p))) return "dev";
    return "unknown";
  }

  private async makeDecision(ctx: EnvironmentContext): Promise<EnvironmentDecision> {
    if (!this.jev) {
      return this.fallbackDecision(ctx);
    }

    try {
      const result = await this.jev.evaluate(ctx, {
        isLocal: {
          type: "noul",
          instructions: "Is the agent running on a local machine or a remote server?",
        },
        serverType: {
          type: "choice",
          instructions: "What type of server is this?",
          options: ["dev", "prod", "unknown"],
        },
        safeToBuild: {
          type: "noul",
          instructions: "Is it safe to run build/restart commands on this environment?",
        },
      });

      const isLocalScore = (result.decisions.isLocal?.response as { noul: number })?.noul ?? 0.5;
      const serverType = (result.decisions.serverType as { response: { choice: string } })?.response?.choice ?? "unknown";
      const safeToBuild = (result.decisions.safeToBuild?.response as { noul: number })?.noul ?? 0.5 > 0.5;

      const warnings: string[] = [];
      const recommendedActions: string[] = [];

      if (serverType === "prod" && !safeToBuild) {
        warnings.push("⚠️ Production server - confirm before destructive actions");
        recommendedActions.push("Request explicit user confirmation");
      }

      return {
        isLocal: isLocalScore > 0.5,
        isRemote: isLocalScore <= 0.5,
        likelyServer: serverType as "dev" | "prod" | "unknown",
        confidence: "medium",
        reasoning: "Jev analysis complete",
        warnings,
        recommendedActions,
      };
    } catch (error) {
      console.error("[EnvironmentJudge] Jev call failed:", error);
      return this.fallbackDecision(ctx);
    }
  }

  private fallbackDecision(ctx: EnvironmentContext): EnvironmentDecision {
    const hostname = ctx.hostname ?? "unknown";
    const isProduction = this.detectProduction(hostname);
    const isLocal = !ctx.isRemoteSession && !ctx.hasSSHConnection;

    const warnings: string[] = [];
    const recommendedActions: string[] = [];

    if (isProduction) {
      warnings.push("⚠️ This appears to be a PRODUCTION server!");
      recommendedActions.push("Confirm with user before build/restart");
    }

    if (!isLocal) {
      warnings.push(`Running on remote server: ${hostname}`);
      recommendedActions.push("Verify target server before SSH commands");
    }

    return {
      isLocal,
      isRemote: !isLocal,
      likelyServer: isProduction ? "prod" : "dev",
      confidence: isProduction ? "high" : "medium",
      reasoning: `Fallback: hostname=${hostname}, remote=${!isLocal}`,
      warnings,
      recommendedActions,
    };
  }
}
