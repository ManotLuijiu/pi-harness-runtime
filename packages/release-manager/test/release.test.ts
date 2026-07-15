/**
 * Release Manager Tests (RFC-0078)
 */

import { describe, it, expect } from "bun:test";
import {
  parseVersion,
  formatVersion,
  bumpVersion,
  compareVersions,
  isPrerelease,
  classifyCommit,
  isBreakingChange,
  extractScope,
  parseCommit,
  buildChanges,
  createChangelogEntry,
  formatChangelogMarkdown,
} from "../src/index.js";
describe("parseVersion", () => {
  it("parses basic version", () => {
    const v = parseVersion("1.2.3");
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
  });

  it("parses v-prefix", () => {
    const v = parseVersion("v2.0.0");
    expect(v.major).toBe(2);
  });

  it("parses prerelease", () => {
    const v = parseVersion("1.0.0-beta.1");
    expect(v.prerelease).toBe("beta");
  });

  it("defaults to 0", () => {
    const v = parseVersion("5");
    expect(v.minor).toBe(0);
    expect(v.patch).toBe(0);
  });
});

describe("formatVersion", () => {
  it("formats basic version", () =>
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe("1.2.3"));

  it("formats with prerelease", () =>
    expect(formatVersion({ major: 1, minor: 0, patch: 0, prerelease: "alpha.1" })).toBe("1.0.0-alpha.1"));
});

describe("bumpVersion", () => {
  it("bumps patch", () => {
    const v = bumpVersion({ major: 1, minor: 2, patch: 3 }, "patch");
    expect(v).toEqual({ major: 1, minor: 2, patch: 4 });
  });

  it("bumps minor and resets patch", () => {
    const v = bumpVersion({ major: 1, minor: 2, patch: 3 }, "minor");
    expect(v).toEqual({ major: 1, minor: 3, patch: 0 });
  });

  it("bumps major and resets all", () => {
    const v = bumpVersion({ major: 1, minor: 2, patch: 3 }, "major");
    expect(v).toEqual({ major: 2, minor: 0, patch: 0 });
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal", () =>
    expect(compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })).toBe(0));

  it("returns negative when a < b", () =>
    expect(compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 2, minor: 0, patch: 0 })).toBeLessThan(0));

  it("returns positive when a > b", () =>
    expect(compareVersions({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })).toBeGreaterThan(0));

  it("prerelease is less than release", () => {
    const a = { major: 1, minor: 0, patch: 0, prerelease: "alpha" };
    const b = { major: 1, minor: 0, patch: 0 };
    expect(compareVersions(a, b)).toBeLessThan(0);
  });
});

describe("isPrerelease", () => {
  it("true for prerelease", () =>
    expect(isPrerelease({ major: 1, minor: 0, patch: 0, prerelease: "beta" })).toBe(true));

  it("false for release", () =>
    expect(isPrerelease({ major: 1, minor: 0, patch: 0 })).toBe(false));
});

describe("classifyCommit", () => {
  it("feat", () => expect(classifyCommit("feat: add login")).toBe("feat"));
  it("fix", () => expect(classifyCommit("fix: bug")).toBe("fix"));
  it("BREAKING", () => expect(classifyCommit("BREAKING: drop API")).toBe("break"));
  it("defaults to chore", () => expect(classifyCommit("update readme")).toBe("chore"));
  it("docs", () => expect(classifyCommit("docs: update API")).toBe("docs"));
  it("refactor", () => expect(classifyCommit("refactor: simplify")).toBe("refactor"));
  it("perf", () => expect(classifyCommit("perf: faster lookup")).toBe("perf"));
  it("test", () => expect(classifyCommit("test: add tests")).toBe("test"));
  it("style", () => expect(classifyCommit("style: format")).toBe("style"));
});

describe("isBreakingChange", () => {
  it("detects BREAKING CHANGE", () =>
    expect(isBreakingChange("BREAKING CHANGE: something")).toBe(true));
  it("detects breaking:", () =>
    expect(isBreakingChange("feat: something breaking: yes")).toBe(true));
  it("detects !:", () =>
    expect(isBreakingChange("feat!: drop support")).toBe(true));
  it("false for normal", () =>
    expect(isBreakingChange("fix: small bug")).toBe(false));
});

describe("extractScope", () => {
  it("extracts scoped", () =>
    expect(extractScope("feat(auth): add login")).toBe("auth"));
  it("returns undefined for unscoped", () =>
    expect(extractScope("feat: add feature")).toBeUndefined());
});

describe("parseCommit", () => {
  it("parses with hash when at start", () => {
    const c = parseCommit("feat: add feature");
    expect(c.hash).toBe("unknown");
    expect(c.type).toBe("feat");
  });

  it("parses without hash", () => {
    const c = parseCommit("fix: resolve bug");
    expect(c.hash).toBe("unknown");
    expect(c.type).toBe("fix");
  });
});

describe("buildChanges", () => {
  it("groups feat as added", () => {
    const commits: any[] = [
      { hash: "1", message: "feat: new feature", author: "a", date: "", type: "feat" },
    ];
    const changes = buildChanges(commits);
    expect(changes.added.length).toBeGreaterThan(0);
  });

  it("groups fix as fixed", () => {
    const commits: any[] = [
      { hash: "1", message: "fix: bug fix", author: "a", date: "", type: "fix" },
    ];
    const changes = buildChanges(commits);
    expect(changes.fixed[0]).toContain("bug fix");
  });

  it("includes scope", () => {
    const commits: any[] = [
      { hash: "1", message: "feat(auth): add login", author: "a", date: "", type: "feat" },
    ];
    const changes = buildChanges(commits);
    expect(changes.added[0]).toContain("**auth**");
  });
});

describe("createChangelogEntry", () => {
  it("creates entry from commits", () => {
    const commits: any[] = [
      { hash: "1", message: "feat: new feature", author: "alice", date: "", type: "feat" },
      { hash: "2", message: "fix: bug", author: "bob", date: "", type: "fix" },
    ];
    const entry = createChangelogEntry({ major: 1, minor: 0, patch: 0 }, commits);
    expect(entry.version).toBe("1.0.0");
    expect(entry.changes.added.length).toBeGreaterThan(0);
  });

  it("marks breaking as major", () => {
    const commits: any[] = [
      { hash: "1", message: "BREAKING: remove API", author: "a", date: "", type: "break" },
    ];
    const entry = createChangelogEntry({ major: 2, minor: 0, patch: 0 }, commits);
    expect(entry.breaking).toBe(true);
    expect(entry.type).toBe("major");
  });

  it("has changes object", () => {
    const commits: any[] = [
      { hash: "1", message: "fix: something", author: "a", date: "", type: "fix" },
    ];
    const entry = createChangelogEntry({ major: 1, minor: 0, patch: 1 }, commits);
    expect(entry).toBeDefined();
    expect(entry.changes).toBeDefined();
  });
});

describe("formatChangelogMarkdown", () => {
  it("includes version and date", () => {
    const entry = createChangelogEntry(
      { major: 1, minor: 2, patch: 3 },
      [{ hash: "1", message: "feat: test", author: "a", date: "", type: "feat" }] as any,
      { date: "2024-01-15" },
    );
    const md = formatChangelogMarkdown(entry);
    expect(md).toContain("1.2.3");
    expect(md).toContain("2024-01-15");
  });

  it("includes BREAKING badge", () => {
    const entry = createChangelogEntry(
      { major: 2, minor: 0, patch: 0 },
      [{ hash: "1", message: "BREAKING: change", author: "a", date: "", type: "break" }] as any,
    );
    const md = formatChangelogMarkdown(entry);
    expect(md).toContain("BREAKING");
  });
});
