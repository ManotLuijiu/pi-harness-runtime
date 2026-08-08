import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// harness/loop-code-agent.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync3, mkdirSync as mkdirSync3 } from "fs";
import { join as join4 } from "path";

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

// cli.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { homedir } from "node:os";
function getUsageDir() {
  const override = process.env.PI_USAGE_DIR;
  if (override)
    return override;
  return join2(homedir(), ".pi", "usage-status");
}
function ensureUsageDir() {
  const dir = getUsageDir();
  if (!existsSync2(dir)) {
    mkdirSync2(dir, { recursive: true });
  }
}
function appendJsonl(path, record) {
  ensureUsageDir();
  const line = JSON.stringify(record) + `
`;
  appendFileSync2(path, line, "utf-8");
}
function readJson(path) {
  if (!existsSync2(path))
    return null;
  try {
    return JSON.parse(readFileSync2(path, "utf-8"));
  } catch {
    return null;
  }
}
function writeJson(path, data) {
  ensureUsageDir();
  if (!existsSync2(dirname(path))) {
    mkdirSync2(dirname(path), { recursive: true });
  }
  writeFileSync2(path, JSON.stringify(data, null, 2) + `
`, "utf-8");
}

// harness/blackboard.js
import { join as join3 } from "node:path";

class SharedBlackboard {
  jobDir;
  record = null;
  constructor(jobId, rootDir) {
    this.jobDir = join3(rootDir, "jobs", jobId, "blackboard");
  }
  init(jobId, taskGraph) {
    const now = new Date().toISOString();
    this.record = {
      jobId,
      status: "created",
      nextAction: undefined,
      tasks: taskGraph,
      agentRegistry: { agents: {} },
      reports: {},
      locks: {},
      updatedAt: now
    };
    this.save();
  }
  load() {
    const path = join3(this.jobDir, "status.json");
    this.record = readJson(path);
    return this.record;
  }
  save() {
    if (!this.record)
      return;
    this.record.updatedAt = new Date().toISOString();
    ensureUsageDir();
    const path = join3(this.jobDir, "status.json");
    writeJson(path, this.record);
  }
  updateStatus(status) {
    if (!this.record)
      return;
    this.record.status = status;
    this.save();
    this.appendEvent("StatusUpdated", { status });
  }
  setNextAction(action) {
    if (!this.record)
      return;
    this.record.nextAction = action;
    this.save();
    this.appendEvent("NextActionUpdated", {
      taskId: action.taskId,
      agentId: action.agentId,
      priority: action.priority
    });
  }
  clearNextAction() {
    if (!this.record)
      return;
    this.record.nextAction = undefined;
    this.save();
  }
  registerAgent(agentId, name, provider, model) {
    if (!this.record)
      return;
    this.record.agentRegistry.agents[agentId] = {
      id: agentId,
      name,
      provider,
      model,
      status: "idle",
      startedAt: new Date().toISOString()
    };
    this.save();
  }
  updateAgentStatus(agentId, status, currentTaskId) {
    if (!this.record)
      return;
    const agent = this.record.agentRegistry.agents[agentId];
    if (!agent)
      return;
    agent.status = status;
    agent.currentTaskId = currentTaskId;
    agent.lastHeartbeat = new Date().toISOString();
    this.save();
  }
  unregisterAgent(agentId) {
    if (!this.record)
      return;
    delete this.record.agentRegistry.agents[agentId];
    this.save();
  }
  writeReport(report) {
    if (!this.record)
      return;
    this.record.reports[report.agentId] = report;
    this.save();
    this.appendEvent("AgentReportWritten", {
      agentId: report.agentId,
      taskId: report.taskId,
      status: report.status
    });
  }
  acquireLock(taskId, agentId) {
    if (!this.record)
      return false;
    if (this.record.locks[taskId]) {
      return false;
    }
    this.record.locks[taskId] = {
      taskId,
      agentId,
      acquiredAt: new Date().toISOString()
    };
    this.save();
    this.appendEvent("LockAcquired", { taskId, agentId });
    return true;
  }
  releaseLock(taskId, agentId) {
    if (!this.record)
      return false;
    const lock = this.record.locks[taskId];
    if (!lock || lock.agentId !== agentId) {
      return false;
    }
    delete this.record.locks[taskId];
    this.save();
    this.appendEvent("LockReleased", { taskId, agentId });
    return true;
  }
  isLocked(taskId) {
    return !!this.record?.locks[taskId];
  }
  getLock(taskId) {
    return this.record?.locks[taskId] ?? null;
  }
  getRecord() {
    return this.record;
  }
  getActiveAgents() {
    if (!this.record)
      return [];
    return Object.values(this.record.agentRegistry.agents);
  }
  getStaleAgents(maxAgeMinutes = 10) {
    if (!this.record)
      return [];
    const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
    return Object.values(this.record.agentRegistry.agents).filter((a) => {
      if (!a.lastHeartbeat)
        return false;
      return Date.parse(a.lastHeartbeat) < cutoff;
    });
  }
  appendEvent(type, data) {
    if (!this.record)
      return;
    const event = {
      ts: new Date().toISOString(),
      jobId: this.record.jobId,
      type,
      message: `Blackboard event: ${type}`,
      data
    };
    const path = join3(this.jobDir, "events.jsonl");
    ensureUsageDir();
    appendJsonl(path, event);
  }
  export() {
    return JSON.stringify(this.record, null, 2);
  }
  getPath() {
    return this.jobDir;
  }
}

// harness/loop-code-agent.ts
var AGENT_ID = "code-agent";
var AGENT_TYPE = "code";
var POLL_MS = 1000;
var logError = (err) => console.error(`[${AGENT_ID}] Error: ${err instanceof Error ? err.message : String(err)}`);
async function main() {
  console.log(`[${AGENT_ID}] Starting...`);
  const paths = ensureHerdrWorkspace();
  const loopId = await findActiveLoop(paths.root);
  if (!loopId) {
    console.log(`[${AGENT_ID}] No active loop found. Waiting...`);
  }
  const rootDir = paths.root;
  const blackboard = new SharedBlackboard(loopId ?? "no-loop", rootDir);
  blackboard.load();
  blackboard.registerAgent(AGENT_ID, "Code Agent", "minimax", "minimax");
  blackboard.updateAgentStatus(AGENT_ID, "idle");
  console.log(`[${AGENT_ID}] Registered. Blackboard: ${blackboard.getPath()}`);
  while (true) {
    await sleep(POLL_MS);
    blackboard.load();
    const record = blackboard.getRecord();
    if (!record)
      continue;
    const earlyExit = checkEarlyExit(record);
    if (earlyExit) {
      console.log(`[${AGENT_ID}] Early exit: ${earlyExit}`);
      blackboard.updateAgentStatus(AGENT_ID, "idle");
      break;
    }
    if (record.jobId !== loopId)
      continue;
    const action = parseNextAction(record.nextAction);
    if (!action || action.agentType !== AGENT_TYPE)
      continue;
    const locked = blackboard.acquireLock(action.taskId, AGENT_ID);
    if (!locked)
      continue;
    blackboard.updateAgentStatus(AGENT_ID, "working", action.taskId);
    console.log(`[${AGENT_ID}] Claimed: ${action.taskId}`);
    const result = await writeCode(action, paths, record.jobId);
    updateTaskStatus(blackboard, record, action.taskId, "done", result.files);
    const nextTaskId = getNextReviewTask(record, action.iteration);
    if (nextTaskId) {
      blackboard.setNextAction(encodeNextAction({
        taskId: nextTaskId,
        agentType: "review",
        iteration: getReviewIteration(nextTaskId),
        prompt: action.prompt,
        codeFiles: result.files
      }));
      console.log(`[${AGENT_ID}] -> nextAction: review ${nextTaskId}`);
    } else {
      const writeDone = getNextWriteTask(record, action.iteration);
      if (writeDone) {
        blackboard.setNextAction(encodeNextAction({
          taskId: writeDone,
          agentType: "code",
          iteration: getWriteIteration(writeDone),
          prompt: action.prompt
        }));
        console.log(`[${AGENT_ID}] -> nextAction: code ${writeDone}`);
      } else {
        blackboard.setNextAction(encodeNextAction({
          taskId: "report",
          agentType: "review",
          iteration: 0
        }));
        console.log(`[${AGENT_ID}] -> nextAction: report`);
      }
    }
    blackboard.releaseLock(action.taskId, AGENT_ID);
    blackboard.writeReport({
      agentId: AGENT_ID,
      taskId: action.taskId,
      status: "success",
      files: result.files
    });
    blackboard.updateAgentStatus(AGENT_ID, "idle");
  }
}
async function writeCode(action, paths, loopId) {
  const iteration = action.iteration;
  const outputDir = join4(paths.code, loopId, `iteration-${iteration}`);
  mkdirSync3(outputDir, { recursive: true });
  const codeFile = join4(outputDir, `index.ts`);
  const code = `// Iteration ${iteration} — ${action.prompt}
// TODO: Replace with actual Minimax code generation
export const iteration = ${iteration};
export const prompt = ${JSON.stringify(action.prompt)};
`;
  writeFileSync3(codeFile, code);
  console.log(`[${AGENT_ID}] Wrote: ${codeFile}`);
  return { files: [codeFile] };
}
async function findActiveLoop(rootDir) {
  const { readdirSync, existsSync: existsSync3 } = await import("fs");
  try {
    const files = readdirSync(rootDir).filter((f) => f.startsWith("loop-") && f.endsWith(".config.json"));
    for (const configFile of files.slice(-1)) {
      const config = JSON.parse(readFileSync3(join4(rootDir, configFile), "utf-8"));
      const bbPath = join4(rootDir, "jobs", config.loopId, "blackboard");
      if (existsSync3(bbPath))
        return config.loopId;
    }
  } catch {}
  return null;
}
function encodeNextAction(action) {
  return {
    taskId: action.taskId,
    instruction: "LOOP:" + JSON.stringify(action),
    priority: "high",
    createdAt: new Date().toISOString()
  };
}
function parseNextAction(nextAction) {
  if (!nextAction)
    return null;
  const a = nextAction;
  if (!a.taskId)
    return null;
  if (typeof a.instruction === "string" && a.instruction.startsWith("LOOP:")) {
    try {
      return JSON.parse(a.instruction.slice(5));
    } catch {
      return null;
    }
  }
  return null;
}
function checkEarlyExit(record) {
  const blocked = Object.values(record.tasks.nodes).find((n) => n.status === "blocked");
  if (blocked)
    return `blocked at ${blocked.id}`;
  const approved = Object.values(record.tasks.nodes).find((n) => n.status === "done" && n.result === "approved");
  if (approved)
    return "approved";
  return null;
}
function updateTaskStatus(blackboard, record, taskId, status, files) {
  if (record.tasks.nodes[taskId]) {
    record.tasks.nodes[taskId].status = status;
    if (files)
      record.tasks.nodes[taskId].result = files.join(", ");
    record.tasks.nodes[taskId].updatedAt = new Date().toISOString();
    blackboard.save();
  }
}
function getNextReviewTask(record, writeIteration) {
  const reviewCount = Object.keys(record.tasks.nodes).filter((id) => id.startsWith("review-")).length;
  const step = Math.max(1, Math.floor(Object.keys(record.tasks.nodes).filter((id) => id.startsWith("write-")).length / (reviewCount || 1)));
  const targetReview = Math.ceil(writeIteration / step);
  const taskId = `review-${targetReview}`;
  if (record.tasks.nodes[taskId] && record.tasks.nodes[taskId].status === "pending") {
    return taskId;
  }
  return null;
}
function getNextWriteTask(record, currentIteration) {
  const nextWrite = currentIteration + 1;
  const taskId = `write-${nextWrite}`;
  if (record.tasks.nodes[taskId] && record.tasks.nodes[taskId].status === "pending") {
    return taskId;
  }
  return null;
}
function getReviewIteration(taskId) {
  const m = taskId.match(/^review-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
function getWriteIteration(taskId) {
  const m = taskId.match(/^write-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
main().catch(logError);
