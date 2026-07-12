# RFC-0052 — Skill Registry

Status: Draft  
Target package: `packages/skill-registry`  
Depends on: RFC-0051 Capability Registry

## 1. Problem

Agents need to discover and invoke skills dynamically. Currently skills are loaded statically. The Skill Registry provides a centralized system for discovering, loading, and invoking skills at runtime.

## 2. Skill Contract

```ts
export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  trigger: SkillTrigger;
  handler: SkillHandler;
  metadata: SkillMetadata;
}

export interface SkillTrigger {
  type: "keyword" | "pattern" | "intent" | "tool_request";
  value: string | RegExp | string[];
  confidence?: number;
}

export interface SkillHandler {
  (context: SkillContext): Promise<SkillResult>;
}

export interface SkillContext {
  messages: CompactableMessage[];
  task?: CompiledTask;
  requirement?: CompiledRequirement;
  tools: AvailableTool[];
  metadata: Record<string, unknown>;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  toolCalls?: ToolCall[];
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillMetadata {
  author?: string;
  tags: string[];
  examples?: string[];
  requiresCapabilities?: Capability[];
  deprecated?: boolean;
}
```

## 3. Registry Interface

```ts
export interface SkillRegistry {
  register(skill: Skill): void;
  unregister(skillId: string): void;
  get(skillId: string): Skill | undefined;
  list(): Skill[];
  find(trigger: SkillTrigger): Skill[];
  invoke(skillId: string, context: SkillContext): Promise<SkillResult>;
  invokeBestMatch(trigger: SkillTrigger, context: SkillContext): Promise<SkillResult>;
}

export interface SkillTrigger {
  type: "keyword" | "pattern" | "intent" | "tool_request";
  value: string | string[];
  confidence?: number;
}
```

## 4. Trigger Matching

```ts
export function matchTrigger(skill: Skill, input: string): number {
  switch (skill.trigger.type) {
    case "keyword":
      return skill.trigger.value
        .split(" ")
        .filter(k => input.toLowerCase().includes(k.toLowerCase())).length;
    
    case "pattern":
      const regex = new RegExp(skill.trigger.value);
      return regex.test(input) ? 1 : 0;
    
    case "intent":
      const intents = Array.isArray(skill.trigger.value) 
        ? skill.trigger.value 
        : [skill.trigger.value];
      return intents.some(i => input.toLowerCase().includes(i.toLowerCase())) ? 1 : 0;
    
    case "tool_request":
      return input.toLowerCase().includes("tool") ? 1 : 0;
    
    default:
      return 0;
  }
}

export function findBestMatch(
  skills: Skill[], 
  input: string,
  minConfidence = 0.5,
): Skill | undefined {
  const matches = skills
    .map(s => ({ skill: s, score: matchTrigger(s, input) }))
    .filter(m => m.score >= (s.trigger.confidence ?? 0.5))
    .sort((a, b) => b.score - a.score);
  
  return matches[0]?.skill;
}
```

## 5. Default Skills

```ts
export const DEFAULT_SKILLS: Skill[] = [
  {
    id: "skill-registry-introspect",
    name: "Introspect Skill Registry",
    description: "Lists all registered skills and their triggers",
    version: "1.0.0",
    trigger: { type: "keyword", value: "list skills", confidence: 0.8 },
    handler: async (ctx) => {
      const skills = ctx.metadata.registry.list();
      return {
        success: true,
        output: JSON.stringify(skills, null, 2),
      };
    },
    metadata: { tags: ["meta", "debug"], examples: ["list skills"] },
  },
];
```

## 6. Events

```ts
type SkillRegistryEvent =
  | { type: "skill.registered"; skillId: string; name: string }
  | { type: "skill.unregistered"; skillId: string }
  | { type: "skill.invoked"; skillId: string; success: boolean; duration: number }
  | { type: "skill.error"; skillId: string; error: string };
```

## 7. Integration Points

- Agent Worker uses Skill Registry to find relevant skills
- Context Compiler can inject skill results into prompts
- Task Compiler may reference skills for specialized tasks

## 8. Acceptance Criteria

- Skills can be registered and unregistered at runtime
- Trigger matching works for keywords, patterns, and intents
- Best match returns highest-scoring skill
- Skill handler receives full context
- Default skills are loaded on initialization
- Events are emitted for all operations
- Unit tests cover all matching scenarios
