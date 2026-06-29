// standard-version config
// https://github.com/conventional-changelog/standard-version
//
// Adapted from .claude-plugins/moocoding-skills/skills/release-app/SKILL.md

module.exports = {
  types: [
    { type: "feat", section: "Features" },
    { type: "fix", section: "Bug Fixes" },
    { type: "perf", section: "Performance" },
    { type: "refactor", section: "Refactoring" },
    { type: "docs", section: "Documentation" },
    { type: "test", section: "Tests" },
    { type: "ci", section: "CI/CD" },
    { type: "chore", section: "Maintenance", hidden: false }
  ],
  bumpFiles: [
    {
      filename: "package.json",
      type: "json"
    }
  ],
  packageFiles: ["package.json"],
  bumpInChangelog: "package.json",
  tagPrefix: "v",
  commitUrlFormat: "https://github.com/ManotLuijiu/pi-harness-runtime/commit/{{hash}}",
  compareUrlFormat:
    "https://github.com/ManotLuijiu/pi-harness-runtime/compare/v{{previousTag}}...v{{currentTag}}",
  issueUrlFormat: "https://github.com/ManotLuijiu/pi-harness-runtime/issues/{{id}}"
};
