// harness/autonomous-review.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join2 } from "path";

// packages/event-bus/src/herdr-bus.ts
import { randomUUID } from "crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "fs";
import { join } from "path";
var DEFAULT_POLL_INTERVAL_MS = 2000;
var MAX_EVENTS_PER_POLL = 50;
var PAYLOADS_DIR = "payloads";
var SUBSCRIPTIONS_DIR = "subscriptions";

class HerdrEventBus {
  workspace;
  agentId;
  pollIntervalMs;
  subscriptions = new Map;
  polling = false;
  pollTimer;
  constructor(config) {
    this.workspace = config.workspace;
    this.agentId = config.agentId;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.ensureDirs();
  }
  ensureDirs() {
    const dirs = [
      this.workspace,
      join(this.workspace, PAYLOADS_DIR),
      join(this.workspace, SUBSCRIPTIONS_DIR)
    ];
    for (const dir of dirs) {
      if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    }
  }
  subscribe(topic, filter) {
    const id = randomUUID();
    this.subscriptions.set(id, {
      id,
      topic,
      lastOffset: 0,
      filter
    });
    this.saveSubscriptions();
    return id;
  }
  unsubscribe(id) {
    this.subscriptions.delete(id);
    this.saveSubscriptions();
  }
  publish(topic, data) {
    const eventId = randomUUID();
    const payload = {
      topic,
      data,
      timestamp: new Date().toISOString(),
      eventId,
      source: this.agentId
    };
    const payloadPath = join(this.workspace, PAYLOADS_DIR, `${eventId}.json`);
    writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
    const logLine = JSON.stringify({ eventId, topic, ts: payload.timestamp }) + `
`;
    appendFileSync(join(this.workspace, "events.jsonl"), logLine);
    return eventId;
  }
  startPolling(handler) {
    if (this.polling)
      return;
    this.polling = true;
    this.loadSubscriptions();
    this.pollTimer = setInterval(() => {
      this.pollEvents(handler).catch(console.error);
    }, this.pollIntervalMs);
  }
  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
  async pollEvents(handler) {
    const logPath = join(this.workspace, "events.jsonl");
    if (!existsSync(logPath))
      return;
    for (const [, sub] of this.subscriptions) {
      const events = this.readNewEvents(sub.lastOffset);
      let newOffset = sub.lastOffset;
      for (const event of events) {
        if (event.topic !== sub.topic)
          continue;
        if (sub.filter && !sub.filter(event.data))
          continue;
        const payloadPath = join(this.workspace, PAYLOADS_DIR, `${event.eventId}.json`);
        if (!existsSync(payloadPath))
          continue;
        try {
          const payload = JSON.parse(readFileSync(payloadPath, "utf-8"));
          if (payload.source === this.agentId)
            continue;
          await handler(payload);
          newOffset = event._byteOffset;
        } catch {}
      }
      if (newOffset > sub.lastOffset) {
        sub.lastOffset = newOffset;
      }
    }
    this.saveSubscriptions();
  }
  readNewEvents(fromOffset) {
    const logPath = join(this.workspace, "events.jsonl");
    if (!existsSync(logPath))
      return [];
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split(`
`).filter((line) => line.trim() !== "");
    const events = [];
    let offset = 0;
    for (const line of lines) {
      offset += line.length + 1;
      if (offset <= fromOffset)
        continue;
      if (events.length >= MAX_EVENTS_PER_POLL)
        break;
      try {
        const parsed = JSON.parse(line);
        events.push(parsed);
      } catch {}
    }
    return events;
  }
  subscriptionsPath() {
    return join(this.workspace, SUBSCRIPTIONS_DIR, `${this.agentId}.json`);
  }
  saveSubscriptions() {
    const path = this.subscriptionsPath();
    const data = Object.fromEntries(this.subscriptions);
    writeFileSync(path, JSON.stringify(data, null, 2));
  }
  loadSubscriptions() {
    const path = this.subscriptionsPath();
    if (!existsSync(path))
      return;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      for (const [id, sub] of Object.entries(data)) {
        this.subscriptions.set(id, sub);
      }
    } catch {}
  }
  getSubscribedTopics() {
    return [...new Set([...this.subscriptions.values()].map((s) => s.topic))];
  }
  getWorkspace() {
    return this.workspace;
  }
}
var HERDR_WORKSPACE = "/tmp/herdr-workspace";
function getHerdrWorkspace() {
  if (!existsSync(HERDR_WORKSPACE)) {
    mkdirSync(HERDR_WORKSPACE, { recursive: true });
  }
  return HERDR_WORKSPACE;
}
function createHerdrBus(agentId) {
  return new HerdrEventBus({
    workspace: getHerdrWorkspace(),
    agentId,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS
  });
}
function getHerdrWorkspacePaths() {
  const root = getHerdrWorkspace();
  return {
    root,
    code: join(root, "code"),
    reviews: join(root, "reviews"),
    payloads: join(root, "payloads"),
    subscriptions: join(root, "subscriptions")
  };
}
function ensureHerdrWorkspace() {
  const paths = getHerdrWorkspacePaths();
  const dirs = [
    paths.root,
    paths.code,
    paths.reviews,
    paths.payloads,
    paths.subscriptions
  ];
  for (const dir of dirs) {
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true });
  }
  return paths;
}
function publishReviewRequestedSimple(bus, taskId, codeTaskId) {
  return bus.publish("review.requested", { taskId, codeTaskId });
}
function publishReviewCompletedSimple(bus, taskId, reportFile, status) {
  return bus.publish("review.completed", { taskId, reportFile, status });
}

// harness/autonomous-review.ts
var AGENT_ID = "review-agent";
var REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
var logError = (err) => console.error(`[${AGENT_ID}] Error: ${err instanceof Error ? err.message : String(err)}`);
async function runReview(bus, codePayload) {
  const { taskId, files } = codePayload;
  const reportFile = join2(ensureHerdrWorkspace().reviews, `${taskId}-review.md`);
  console.log(`[${AGENT_ID}] Reviewing task ${taskId}, ${files.length} files`);
  try {
    publishReviewRequestedSimple(bus, taskId, taskId);
    const fileBlocks = await Promise.all(files.map(async (file) => {
      const content = existsSync2(file) ? readFileSync2(file, "utf-8").slice(0, 5000) : `[Not found: ${file}]`;
      return `## ${file}

\`\`\`
${content}
\`\`\`
`;
    }));
    const report = `# Code Review — Task ${taskId}
## Files: ${files.join(", ")}

> Auto-generated. GPT review tab fills this in.

${fileBlocks.join(`
`)}
`;
    writeFileSync2(reportFile, report);
    console.log(`[${AGENT_ID}] Report: ${reportFile}`);
    publishReviewCompletedSimple(bus, taskId, reportFile, "changes_requested");
    await waitForGptReview(reportFile);
  } catch (err) {
    console.error(`[${AGENT_ID}] Review failed:`, err);
    publishReviewCompletedSimple(bus, taskId, reportFile, "failed");
  }
}
async function waitForGptReview(reportFile) {
  const deadline = Date.now() + REVIEW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync2(reportFile)) {
      const content = readFileSync2(reportFile, "utf-8");
      if (!content.includes("Pending"))
        return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`[${AGENT_ID}] GPT review timed out`);
}
async function main() {
  console.log(`[${AGENT_ID}] Starting...`);
  const bus = createHerdrBus(AGENT_ID);
  ensureHerdrWorkspace();
  bus.subscribe("code.written");
  bus.startPolling(async (payload) => {
    if (payload.topic === "code.written") {
      const data = payload.data;
      if (data.files?.length)
        runReview(bus, data).catch(logError);
    }
  });
  console.log(`[${AGENT_ID}] Workspace: ${bus.getWorkspace()}`);
  console.log(`[${AGENT_ID}] Polling for code.written...`);
}
main().catch(logError);
