// harness/herdr-agents.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2 } from "fs";
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

// harness/herdr-agents.ts
var logError = (err) => console.error(`[herdr] Error: ${err instanceof Error ? err.message : String(err)}`);
async function startReviewAgent() {
  console.log("[herdr:review] Starting review agent...");
  const bus = createHerdrBus("review-agent");
  ensureHerdrWorkspace();
  bus.subscribe("code.written");
  bus.startPolling(async (payload) => {
    if (payload.topic === "code.written") {
      const data = payload.data;
      console.log(`[herdr:review] code.written: task=${data.taskId} files=${data.files.length}`);
      for (const file of data.files ?? []) {
        console.log(`[herdr:review] Reviewing: ${file}`);
      }
    }
  });
  console.log(`[herdr:review] Workspace: ${bus.getWorkspace()}`);
  await new Promise(() => {});
}
async function startCodeAgent() {
  console.log("[herdr:code] Starting code agent...");
  const bus = createHerdrBus("code-agent");
  ensureHerdrWorkspace();
  bus.subscribe("review.completed");
  bus.startPolling(async (payload) => {
    if (payload.topic === "review.completed") {
      const data = payload.data;
      console.log(`[herdr:code] Review done: task=${data.taskId} status=${data.status} report=${data.reportFile}`);
    }
  });
  console.log(`[herdr:code] Workspace: ${bus.getWorkspace()}`);
  await new Promise(() => {});
}
function showStatus() {
  const paths = getHerdrWorkspacePaths();
  console.log(`Workspace: ${paths.root}`);
  const evPath = join2(paths.root, "events.jsonl");
  if (existsSync2(evPath)) {
    const lines = readFileSync2(evPath, "utf-8").split(`
`).filter(Boolean).slice(-10);
    console.log("Recent events:");
    for (const line of lines) {
      try {
        const { topic, ts } = JSON.parse(line);
        console.log(`  ${ts} ${topic}`);
      } catch {}
    }
  }
  if (existsSync2(paths.subscriptions)) {
    const agents = readdirSync(paths.subscriptions);
    console.log(`Active agents: ${agents.join(", ") || "none"}`);
  }
}
var [command] = process.argv.slice(2);
switch (command) {
  case "review":
    startReviewAgent().catch(logError);
    break;
  case "code":
    startCodeAgent().catch(logError);
    break;
  case "status":
    showStatus();
    break;
  default:
    console.log("Usage: bun harness/herdr-agents.ts <review|code|status>");
}
