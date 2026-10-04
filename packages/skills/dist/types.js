/**
 * pi-harness-runtime Skills System Types
 *
 * Based on:
 * - pi.dev Agent Skills specification (https://pi.dev/docs/latest/skills)
 * - Hermes Agent skill system
 */
export const DEFAULT_SKILLS_CONFIG = {
    enabled: true,
    locations: [
        "~/.pi-harness/skills",
        "skills",
        ".agents/skills"
    ],
    write_approval: false,
    auto_create_threshold: 3,
    auto_patch_threshold: 1,
    progressive_disclosure: true,
    default_author: "agent"
};
//# sourceMappingURL=types.js.map