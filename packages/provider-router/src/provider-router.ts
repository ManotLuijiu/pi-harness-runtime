import type { ProviderSelection, RuntimeContext, RuntimeTask } from "../../types/src/runtime-types";

export interface RoutingPolicy {
  plannerProvider: string;
  codeProviders: string[];
  reviewProvider: string;
  fallbackProviders: string[];
}

export class SimpleProviderRouter {
  constructor(private readonly policy: RoutingPolicy) {}

  async selectProvider(task: RuntimeTask, context: RuntimeContext): Promise<ProviderSelection> {
    const candidates = this.candidatesForTask(task);

    for (const providerId of candidates) {
      const state = context.providerStates[providerId] ?? "unknown";
      if (state === "available" || state === "unknown") {
        return {
          providerId,
          reason: `selected ${providerId} for task ${task.id}; state=${state}`,
        };
      }
    }

    throw new Error(`No available provider for task ${task.id}`);
  }

  private candidatesForTask(task: RuntimeTask): string[] {
    const title = task.title.toLowerCase();

    if (title.includes("plan") || title.includes("architecture")) {
      return [this.policy.plannerProvider, ...this.policy.fallbackProviders];
    }

    if (title.includes("review") || title.includes("diff")) {
      return [this.policy.reviewProvider, ...this.policy.fallbackProviders];
    }

    return [...this.policy.codeProviders, ...this.policy.fallbackProviders];
  }
}
