# RFC-0060 — Memory Engine with OKF Integration

## 1. Purpose

The Memory Engine converts runtime knowledge into durable, human-readable, agent-readable project memory using Google's Open Knowledge Format (OKF).

It bridges temporary Shared Blackboard state and long-term project knowledge.

## 2. Responsibilities

- Read OKF bundles.
- Validate OKF concept documents.
- Index concepts.
- Resolve links.
- Retrieve relevant knowledge.
- Export approved lessons.
- Preserve version history.
- Generate directory indexes.
- Record update logs.

## 3. OKF Bundle Structure

```text
knowledge/
├── index.md
├── log.md
├── runtime/
│   ├── index.md
│   ├── loop-runtime.md
│   └── shared-blackboard.md
├── providers/
├── frameworks/
├── failures/
├── patterns/
└── lessons/
```

## 4. Concept Model

```ts
export interface OkfConcept {
  id: string;
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags: string[];
  timestamp?: string;
  metadata: Record<string, unknown>;
  body: string;
  links: OkfLink[];
}
```

The only required OKF frontmatter field is `type`. Unknown metadata must be preserved.

## 5. Public Interface

```ts
export interface MemoryEngine {
  loadBundle(path: string): Promise<KnowledgeBundle>;
  validateBundle(bundle: KnowledgeBundle): Promise<ValidationResult>;
  search(query: KnowledgeQuery): Promise<KnowledgeResult[]>;
  writeConcept(input: WriteConceptRequest): Promise<OkfConcept>;
  rebuildIndex(path: string): Promise<void>;
}
```

## 6. Retrieval

Retrieval combines:

- Exact title match
- Tag match
- Concept type
- Link traversal
- Framework relevance
- Task relevance
- Freshness
- Authority metadata

## 7. Authority

Recommended extension:

```yaml
authority: approved | generated | unverified
```

Consumers should prioritize approved concepts, but must preserve generated and unverified concepts.

## 8. Blackboard Promotion

```text
runtime state
 -> candidate knowledge
 -> deduplicate
 -> review
 -> approved concept
 -> write OKF
 -> update index.md
 -> append log.md
```

Temporary status updates should not automatically become durable knowledge.

## 9. Validation

A conformant concept:

- Is UTF-8 Markdown.
- Contains YAML frontmatter.
- Contains non-empty `type`.
- Preserves unknown fields.
- May contain broken links without failing the entire bundle.

Reserved files:

- `index.md`
- `log.md`

## 10. Security

The Memory Engine must never persist:

- API keys
- Cookies
- Passwords
- Raw secrets
- Private user data unrelated to engineering
- Complete confidential files unless explicitly approved

## 11. Tests

- Loads valid OKF concept.
- Rejects concept missing `type`.
- Preserves unknown frontmatter.
- Tolerates broken link.
- Generates `index.md`.
- Appends `log.md`.
- Searches by tag and type.
- Exports approved learning item.
- Rejects secret-like content.

## 12. Acceptance Criteria

- Bundle validation follows OKF v0.1.
- Unknown frontmatter survives round-trip.
- Search returns source references.
- Blackboard content requires promotion review.
- Index and log generation are deterministic.
- Secret filtering occurs before persistence.
