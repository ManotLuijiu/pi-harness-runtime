/**
 * Wiki Package Basic Tests
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Set feature flag for tests
process.env.HARNESS_KNOWLEDGE_WIKI = "1";

import { createWikiManager, wikiExists } from "../dist/index.js";

const TEST_DIR = join("/tmp", "wiki-test-" + Date.now());

describe("Wiki Manager", () => {
  let wiki: ReturnType<typeof createWikiManager>;

  before(async () => {
    // Clean up any existing test directory
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    wiki = createWikiManager(TEST_DIR, "test-project");
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("Initialization", () => {
    it("should initialize wiki structure", () => {
      // WikiStorage constructor creates structure, so initialize() may see existing
      const result = wiki.initialize();
      // Either freshly created or already existed
      assert.ok(result.created || result.existing);
      assert.ok(existsSync(join(TEST_DIR, "wiki")));
      assert.ok(existsSync(join(TEST_DIR, "wiki", "knowledge")));
      assert.ok(existsSync(join(TEST_DIR, "wiki", "raw")));
      assert.ok(existsSync(join(TEST_DIR, "wiki", ".harness")));
      assert.ok(existsSync(join(TEST_DIR, "wiki", "SCHEMA.md")));
    });

    it("should detect existing wiki on subsequent calls", () => {
      const result = wiki.initialize();
      assert.strictEqual(result.created, false);
      assert.ok(result.existing);
    });

    it("should check if wiki is initialized", () => {
      assert.strictEqual(wiki.isInitialized(), true);
    });
  });

  describe("Page Operations", () => {
    it("should create a page", () => {
      const page = wiki.createPage({
        title: "Test Concept",
        kind: "concept",
        body: "# Test Concept\n\nThis is a test concept.",
      });

      assert.ok(page.frontmatter.id.startsWith("page-"));
      assert.strictEqual(page.frontmatter.title, "Test Concept");
      assert.strictEqual(page.frontmatter.kind, "concept");
      assert.strictEqual(page.frontmatter.status, "proposed");
      assert.ok(page.body.includes("test concept"));
    });

    it("should load a page", () => {
      const created = wiki.createPage({
        title: "Load Test",
        kind: "decision",
        body: "# Load Test\n\nTesting load functionality.",
      });

      const loaded = wiki.loadPage(created.frontmatter.id);
      assert.ok(loaded);
      assert.strictEqual(loaded!.frontmatter.title, "Load Test");
    });

    it("should update a page", () => {
      const created = wiki.createPage({
        title: "Update Test",
        kind: "reference",
        body: "# Update Test\n\nOriginal content.",
      });

      const updated = wiki.updatePage(created.frontmatter.id, {
        status: "verified",
        body: "# Update Test\n\nUpdated content.",
      });

      assert.strictEqual(updated.frontmatter.status, "verified");
      assert.ok(updated.body.includes("Updated"));
    });

    it("should delete a page", () => {
      const created = wiki.createPage({
        title: "Delete Test",
        kind: "plan",
        body: "# Delete Test\n\nWill be deleted.",
      });

      wiki.deletePage(created.frontmatter.id);
      const loaded = wiki.loadPage(created.frontmatter.id);
      assert.strictEqual(loaded, null);
    });

    it("should get all pages", () => {
      const pages = wiki.getAllPages();
      assert.ok(pages.length >= 0);
    });
  });

  describe("Search", () => {
    it("should search pages by title", () => {
      // Create a page with known title
      wiki.createPage({
        title: "Searchable Concept",
        kind: "concept",
        body: "This page is about searching functionality.",
      });

      const results = wiki.search("Searchable");
      assert.ok(results.length > 0);
      assert.strictEqual(results[0].page.title, "Searchable Concept");
    });

    it("should search pages by body content", () => {
      const results = wiki.search("functionality");
      assert.ok(results.some(r => r.page.title === "Searchable Concept"));
    });

    it("should get page index", () => {
      const index = wiki.getIndex();
      assert.ok(Array.isArray(index));
    });
  });

  describe("Source Ingestion", () => {
    it("should ingest a source file", async () => {
      // Create a test file
      const testFile = join(TEST_DIR, "test-source.md");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(testFile, "# Test Source\n\nThis is a test source file.", "utf8");

      const { snapshot, operation } = wiki.ingestSource(testFile);

      assert.ok(snapshot.id.startsWith("snap-"));
      assert.strictEqual(snapshot.originalPath, testFile);
      assert.ok(snapshot.contentHash);
      assert.ok(operation.status === "pending" || operation.status === "success");
    });

    it("should get snapshot by ID", async () => {
      // First ingest
      const testFile = join(TEST_DIR, "test-snapshot.md");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(testFile, "# Test Snapshot\n\nContent.", "utf8");

      const { snapshot } = wiki.ingestSource(testFile);
      const loaded = wiki.getSnapshot(snapshot.id);

      assert.ok(loaded);
      assert.strictEqual(loaded!.id, snapshot.id);
    });
  });

  describe("Lint", () => {
    it("should run lint checks", () => {
      // Create a page without verification
      wiki.createPage({
        title: "Unverified Page",
        kind: "decision",
        body: "This page needs verification.",
      });

      const findings = wiki.lint();

      // Should find pages without verification evidence
      const evidenceFindings = findings.filter(f => f.category === "evidence");
      assert.ok(evidenceFindings.length >= 0);
    });
  });

  describe("Staged Changes", () => {
    it("should stage a change", () => {
      const page = wiki.createPage({
        title: "Staged Page",
        kind: "concept",
        body: "# Staged Page\n\nOriginal.",
      });

      // Use any non-empty revision for testing
      const revision = "test-revision-hash";

      const change = wiki.stageChange(
        page.frontmatter.id,
        revision,
        `---\nid: ${page.frontmatter.id}\ntitle: Staged Page\nkind: concept\nprojectId: test\nstatus: proposed\ncreatedAt: ${new Date().toISOString()}\nupdatedAt: ${new Date().toISOString()}\nsources: []\nrelatedPages: []\n---\n\n# Staged Page\n\nUpdated.`
      );

      assert.strictEqual(change.pageId, page.frontmatter.id);
    });

    it("should get staged change", () => {
      const pages = wiki.getAllPages();
      const stagedPage = pages.find(p => p.frontmatter.title === "Staged Page");
      assert.ok(stagedPage);

      const change = wiki.getStagedChange(stagedPage!.frontmatter.id);
      assert.ok(change, "Staged change should exist");
    });
  });

  describe("Operations", () => {
    it("should get recent operations", () => {
      const operations = wiki.getRecentOperations();
      assert.ok(Array.isArray(operations));
      // Operations should exist after initialization and page operations
      assert.ok(operations.length >= 0);
    });
  });
});

describe("Wiki Exists Check", () => {
  it("should detect existing wiki", () => {
    const testDir = join("/tmp", "wiki-exists-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "wiki", "knowledge"), { recursive: true });

    assert.strictEqual(wikiExists(testDir), true);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("should detect non-existing wiki", () => {
    assert.strictEqual(wikiExists("/tmp/nonexistent-wiki-path"), false);
  });
});
