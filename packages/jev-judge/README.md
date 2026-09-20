# Jev Judge

Structured decision model integration for pi-harness-runtime. Uses [TypeSafe Jev](https://typesafe.ai) via OpenRouter for fast, calibrated, hallucination-free decisions.

## Overview

Jev is a "System One" model - a new class of AI optimized for **structured decisions** rather than text generation:

| Aspect | Traditional LLM | Jev (System One) |
|--------|-----------------|------------------|
| Output | Text (can hallucinate) | Type-safe values (0% hallucination) |
| Speed | ~1-2s per call | **~250ms per call** |
| Cost | Higher | ~5x cheaper |
| Use case | Chat, reasoning | Classification, routing, decisions |

## Features

- **JevJudge** - Core API for structured decisions
- **E2EJudge** - E2E testing decisions (flaky detection, build blocking, retry)
- **FlakyDetector** - Specialized flaky test detection
- **DecisionEngine** - Threshold-based routing and actions
- **AutoContinueJudge** - Agent autonomous decision-making (continue or wait)

## Installation

```bash
# Via monorepo (already included)
bun install

# Or install separately
npm install @pi-harness/jev-judge
```

## Configuration

Requires OpenRouter API key with TypeSafe/Jev access:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

Or set in code:

```typescript
const judge = new JevJudge({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseUrl: "https://openrouter.ai/api/v1", // default
  model: "typesafe/jev-1.13", // default
});
```

## Usage

### Basic Decisions

```typescript
import { JevJudge } from "@pi-harness/jev-judge";

const judge = new JevJudge({ apiKey: process.env.OPENROUTER_API_KEY! });

// Ask multiple questions at once
const result = await judge.evaluate(
  "The deploy failed with exit code 1. Error: ECONNREFUSED",
  {
    isUrgent: {
      type: "noul",
      instructions: "Does this require immediate attention?"
    },
    severity: {
      type: "choice",
      instructions: "What is the severity level?",
      options: ["critical", "high", "medium", "low"]
    }
  }
);

console.log(result.decisions.isUrgent.probability); // 0.92
console.log(result.decisions.severity.response.choice); // "critical"
```

### Task Tracker Routing (Todo vs BD)

```typescript
import { Router } from "@pi-harness/jev-judge/decision-engine";

const result = await Router.routeTaskTracker(
  "Fix the login bug on the checkout page",
  judge
);

if (result.tracker === "bd") {
  // Create GitHub issue
} else {
  // Use local todo
}
```

### E2E Test Flaky Detection

```typescript
import { E2EJudge } from "@pi-harness/jev-judge/e2e-judge";

const e2eJudge = new E2EJudge({ apiKey: process.env.OPENROUTER_API_KEY! });

// Analyze a test failure
const flakyAnalysis = await e2eJudge.analyzeFlakiness({
  name: "checkout-flow.spec.ts",
  status: "failed",
  error: "Timeout: Element #checkout-button not visible after 5000ms",
  retries: 1
});

if (flakyAnalysis.isFlaky) {
  console.log(`Flaky detected: ${flakyAnalysis.pattern}`);
  // Auto-skip or retry
}
```

### Build Decision

```typescript
// Should this failure block the build?
const blockDecision = await e2eJudge.shouldBlockBuild(testResult);

if (blockDecision.shouldBlock) {
  console.log(`Blocking build: ${blockDecision.reason}`);
  process.exit(1);
}
```

### Threshold-Based Actions

```typescript
import { DecisionEngine } from "@pi-harness/jev-judge/decision-engine";

const engine = new DecisionEngine(
  { apiKey: process.env.OPENROUTER_API_KEY! },
  { approval: 0.9, review: 0.6, block: 0.3 }
);

const decision = engine.decide(0.85);

switch (decision.action) {
  case "proceed":
    // Auto-approve
    break;
  case "review":
    // Send to human
    break;
  case "block":
    // Auto-reject
    break;
}
```

## API Reference

### JevJudge

Core class for making structured decisions.

```typescript
const judge = new JevJudge(config: JevJudgeConfig);
```

#### Methods

- `evaluate(state, questions)` - Evaluate state against questions
- `noul(state, question)` - Quick yes/no evaluation
- `choice(state, question, options)` - Quick choice evaluation
- `thresholdDecision(probability, threshold)` - Threshold-based decision
- `batchEvaluate(states, questions)` - Batch evaluation

### E2EJudge

Specialized judge for E2E testing.

```typescript
const e2eJudge = new E2EJudge(config, options);
```

#### Methods

- `analyzeFlakiness(testResult)` - Detect flaky tests
- `shouldBlockBuild(testResult)` - Build blocking decision
- `shouldRetry(testResult)` - Retry recommendation
- `classifyError(errorMessage)` - Error classification
- `batchAnalyze(testResults)` - Batch test analysis

### FlakyDetector

Specialized for flaky test detection with pattern matching.

```typescript
const detector = new FlakyDetector(config, threshold);
```

#### Methods

- `detectPattern(errorMessage)` - Fast pattern-based detection
- `detect(testResult)` - AI-powered detection
- `batchDetect(testResults)` - Batch detection

### DecisionEngine

Threshold-based routing and actions.

```typescript
const engine = new DecisionEngine(config, thresholds);
```

#### Methods

- `decide(probability)` - Decide action from probability
- `decideWithThresholds(probabilities)` - Multi-question decisions
- `route(decision, handlers)` - Route to handlers
- `batchDecide(decisions)` - Batch decisions
- `weightedVote(votes)` - Weighted voting

## Pricing

Jev via OpenRouter:
- Input: $0.042 / 1M tokens
- Output: Free
- Latency: ~250ms P50

See [OpenRouter pricing](https://openrouter.ai/typesafe/jev-1.13) for details.

## Auto-Continue Judge (Agent Use Case)

**Problem:** Agent completes 2/5 tasks, asks "Continue?" User asleep → agent waits indefinitely.

**Solution:** Use Jev to judge whether to auto-continue.

```typescript
import { AutoContinueJudge, createTaskState } from "@pi-harness/jev-judge/auto-continue";
import { hasJevApiKey, createJevJudge } from "@pi-harness/jev-judge";

// Auto-detect API key from environment
const judge = new AutoContinueJudge({
  apiKey: process.env.TYPESAFE_API_KEY!, // or auto-detect
  proceedThreshold: 0.7,  // Continue if >70% confidence
  maxWaitMinutes: 30,
});

// Build task state
const taskState = createTaskState(
  ["task-1", "task-2"],  // completed
  ["task-3", "task-4", "task-5"],  // remaining
  new Date(Date.now() - 30 * 60 * 1000),  // last user activity 30 min ago
  new Date(Date.now() - 2 * 60 * 60 * 1000)  // session started 2 hours ago
);

// Get decision
const decision = await judge.decide(taskState);

if (decision.action === "proceed") {
  console.log("Continuing with remaining tasks...");
  // Agent proceeds autonomously
} else if (decision.action === "proceed_with_caution") {
  console.log(`Proceeding with caution (${decision.riskLevel} risk)`);
  // Agent proceeds but logs each step
} else {
  console.log(`Waiting... (recommend ${decision.waitRecommendation} min)`);
  // Agent waits or notifies
}
```

### Environment Variable Auto-Detection

The package automatically detects API keys from environment:

```bash
# Option 1: TypeSafe API key (preferred)
export TYPESAFE_API_KEY="your-key-here"

# Option 2: OpenRouter API key
export OPENROUTER_API_KEY="your-key-here"
```

```typescript
import { hasJevApiKey, createJevJudge } from "@pi-harness/jev-judge";

if (hasJevApiKey()) {
  const judge = createJevJudge();  // Auto-detects API key
}
```

## Examples

See `tests/` directory for example usage.

## License

MIT
