# RFC-0052 Skill Registry

Implement a centralized skill registry for dynamic skill discovery, loading, and invocation at runtime.

## Key Components

- `Skill` - Skill definition with trigger, handler, metadata
- `SkillRegistry` - Register, find, invoke skills
- Trigger matching - Keywords, patterns, intents
- Default skills for introspection

## Integration Points

- Agent Worker uses Skill Registry for skill discovery
- Context Compiler injects skill results
- Task Compiler references skills for specialized tasks
