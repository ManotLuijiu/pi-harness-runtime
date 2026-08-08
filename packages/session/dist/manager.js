// packages/session/src/manager.ts
import { randomBytes } from "node:crypto";

// packages/session/src/history.ts
import { createHash } from "node:crypto";

class MessageHistory {
  messages = [];
  maxMessages;
  constructor(maxMessages = 1000) {
    this.maxMessages = maxMessages;
  }
  initialize(messages) {
    this.messages = [...messages];
  }
  getAll() {
    return [...this.messages];
  }
  getByRole(role) {
    return this.messages.filter((m) => m.role === role);
  }
  getRecent(count) {
    return this.messages.slice(-count);
  }
  getRange(start, end) {
    return this.messages.slice(start, end);
  }
  add(message) {
    const fullMessage = {
      ...message,
      id: this.generateId()
    };
    this.messages.push(fullMessage);
    if (this.messages.length > this.maxMessages) {
      this.trimOldest(this.messages.length - this.maxMessages);
    }
    return fullMessage;
  }
  update(messageId, updates) {
    const index = this.messages.findIndex((m) => m.id === messageId);
    if (index === -1)
      return null;
    this.messages[index] = {
      ...this.messages[index],
      ...updates,
      id: messageId
    };
    return this.messages[index];
  }
  delete(messageId) {
    const index = this.messages.findIndex((m) => m.id === messageId);
    if (index === -1)
      return false;
    this.messages.splice(index, 1);
    return true;
  }
  clear() {
    this.messages = [];
  }
  count() {
    return this.messages.length;
  }
  trimOldest(count) {
    this.messages.splice(0, count);
  }
  generateId() {
    return createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 16);
  }
  toArray() {
    return [...this.messages];
  }
  getEstimatedTokenCount() {
    return this.messages.reduce((total, msg) => {
      return total + Math.ceil((msg.content.length + msg.role.length) / 4);
    }, 0);
  }
}

class MessageSearch {
  index = new Map;
  buildIndex(sessionId, messages) {
    this.index.set(sessionId, [...messages]);
  }
  search(filter) {
    const { role, contains, limit = 50 } = filter;
    let messages = [];
    if (filter.sessionId) {
      messages = this.index.get(filter.sessionId) || [];
    } else {
      for (const sessionMessages of this.index.values()) {
        messages.push(...sessionMessages);
      }
    }
    let results = messages;
    if (role) {
      results = results.filter((m) => m.role === role);
    }
    if (contains) {
      const searchLower = contains.toLowerCase();
      results = results.filter((m) => m.content.toLowerCase().includes(searchLower));
    }
    if (filter.startDate) {
      const startTime = new Date(filter.startDate).getTime();
      results = results.filter((m) => new Date(m.timestamp).getTime() >= startTime);
    }
    if (filter.endDate) {
      const endTime = new Date(filter.endDate).getTime();
      results = results.filter((m) => new Date(m.timestamp).getTime() <= endTime);
    }
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const offset = filter.offset ?? 0;
    results = results.slice(offset, offset + limit);
    return results.map((m) => ({
      sessionId: filter.sessionId || "",
      messageId: m.id,
      content: m.content,
      timestamp: m.timestamp,
      score: contains ? this.calculateScore(m.content, contains) : 1
    }));
  }
  calculateScore(content, query) {
    const contentLower = content.toLowerCase();
    const queryLower = query.toLowerCase();
    let score = 0;
    if (contentLower.includes(queryLower)) {
      score += 1;
    }
    const words = queryLower.split(/\s+/);
    for (const word of words) {
      if (contentLower.includes(word)) {
        score += 0.5;
      }
    }
    return score;
  }
  clear() {
    this.index.clear();
  }
  removeSession(sessionId) {
    this.index.delete(sessionId);
  }
}

class ContextWindowManager {
  maxTokens;
  history;
  constructor(maxTokens = 128000) {
    this.maxTokens = maxTokens;
    this.history = new MessageHistory;
  }
  initialize(messages) {
    this.history.initialize(messages);
  }
  getMessagesForContext(targetTokens) {
    const allMessages = this.history.getAll();
    const result = [];
    let tokenCount = 0;
    for (let i = allMessages.length - 1;i >= 0; i--) {
      const msg = allMessages[i];
      const msgTokens = this.estimateTokens(msg);
      if (tokenCount + msgTokens <= targetTokens) {
        result.unshift(msg);
        tokenCount += msgTokens;
      } else {
        break;
      }
    }
    return result;
  }
  estimateTokens(message) {
    const contentTokens = Math.ceil(message.content.length / 4);
    const overheadTokens = 10;
    return contentTokens + overheadTokens;
  }
  wouldExceed(newMessageTokens) {
    const currentTokens = this.history.getEstimatedTokenCount();
    return currentTokens + newMessageTokens > this.maxTokens;
  }
  getRemainingTokens() {
    const currentTokens = this.history.getEstimatedTokenCount();
    return Math.max(0, this.maxTokens - currentTokens);
  }
  getAll() {
    return this.history.getAll();
  }
  add(message) {
    return this.history.add(message);
  }
}

// packages/session/src/policy.ts
class RateLimiter {
  entries = new Map;
  requestsPerMinute;
  constructor(requestsPerMinute) {
    this.requestsPerMinute = requestsPerMinute;
  }
  canMakeRequest(key) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      return true;
    }
    return entry.count < this.requestsPerMinute;
  }
  recordRequest(key) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      this.entries.set(key, {
        count: 1,
        resetAt: now + 60000
      });
    } else {
      entry.count++;
    }
  }
  getRemaining(key) {
    const entry = this.entries.get(key);
    if (!entry || Date.now() >= entry.resetAt) {
      return this.requestsPerMinute;
    }
    return Math.max(0, this.requestsPerMinute - entry.count);
  }
  clearExpired() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) {
        this.entries.delete(key);
      }
    }
  }
}

class BudgetTracker {
  entries = new Map;
  setBudget(key, limit, resetAtMs) {
    this.entries.set(key, {
      spent: 0,
      limit,
      resetAt: Date.now() + resetAtMs
    });
  }
  canSpend(key, amount) {
    const entry = this.entries.get(key);
    if (!entry)
      return true;
    if (Date.now() >= entry.resetAt) {
      return true;
    }
    return entry.spent + amount <= entry.limit;
  }
  recordSpend(key, amount) {
    const entry = this.entries.get(key);
    if (!entry)
      return;
    if (Date.now() >= entry.resetAt) {
      entry.spent = amount;
      entry.resetAt = Date.now() + (entry.resetAt - Date.now());
    } else {
      entry.spent += amount;
    }
  }
  getRemaining(key) {
    const entry = this.entries.get(key);
    if (!entry)
      return null;
    if (Date.now() >= entry.resetAt) {
      return entry.limit;
    }
    return Math.max(0, entry.limit - entry.spent);
  }
  getResetAt(key) {
    const entry = this.entries.get(key);
    if (!entry)
      return null;
    return entry.resetAt;
  }
}

class PolicyEngine {
  config;
  rateLimiter;
  budgetTracker;
  sessionStates = new Map;
  constructor(config = {}) {
    this.config = {
      maxRequestsPerMinute: config.maxRequestsPerMinute ?? 60,
      maxTokensPerDay: config.maxTokensPerDay ?? 1e6,
      maxCostPerSession: config.maxCostPerSession ?? 100,
      maxConcurrentSessions: config.maxConcurrentSessions ?? 10,
      sessionBudget: config.sessionBudget ?? 50
    };
    this.rateLimiter = new RateLimiter(this.config.maxRequestsPerMinute);
    this.budgetTracker = new BudgetTracker;
  }
  getPolicyState(sessionId) {
    let state = this.sessionStates.get(sessionId);
    if (!state) {
      state = {
        rateLimitRemaining: this.config.maxRequestsPerMinute ?? 60,
        suspended: false
      };
      this.sessionStates.set(sessionId, state);
    }
    return state;
  }
  canProceed(sessionId, action) {
    const state = this.getPolicyState(sessionId);
    if (state.suspended) {
      return false;
    }
    if (!this.rateLimiter.canMakeRequest(sessionId)) {
      return false;
    }
    if (state.budgetRemaining !== undefined && state.budgetRemaining <= 0) {
      return false;
    }
    return true;
  }
  recordAction(sessionId, action) {
    this.rateLimiter.recordRequest(sessionId);
    const state = this.getPolicyState(sessionId);
    state.rateLimitRemaining = this.rateLimiter.getRemaining(sessionId);
    const resetAt = Date.now() + 60000;
    state.rateLimitResetAt = new Date(resetAt).toISOString();
  }
  recordTokenUsage(sessionId, usage) {
    const state = this.getPolicyState(sessionId);
    if (this.config.sessionBudget) {
      const costInCents = Math.round(usage.totalCost * 100);
      this.budgetTracker.recordSpend(sessionId, costInCents);
      state.budgetRemaining = this.budgetTracker.getRemaining(sessionId) ? this.budgetTracker.getRemaining(sessionId) / 100 : undefined;
      const resetAt = this.budgetTracker.getResetAt(sessionId);
      if (resetAt) {
        state.budgetResetAt = new Date(resetAt).toISOString();
      }
    }
  }
  suspend(sessionId, reason) {
    const state = this.getPolicyState(sessionId);
    state.suspended = true;
    state.suspensionReason = reason;
  }
  resume(sessionId) {
    const state = this.getPolicyState(sessionId);
    state.suspended = false;
    state.suspensionReason = undefined;
  }
  resetState(sessionId) {
    this.sessionStates.delete(sessionId);
  }
  setSessionBudget(sessionId, budget, periodMs) {
    const budgetInCents = Math.round(budget * 100);
    this.budgetTracker.setBudget(sessionId, budgetInCents, periodMs);
    const state = this.getPolicyState(sessionId);
    state.budgetRemaining = budget;
    state.budgetResetAt = new Date(Date.now() + periodMs).toISOString();
  }
  getViolationType(sessionId) {
    const state = this.getPolicyState(sessionId);
    if (state.suspended) {
      return `suspended: ${state.suspensionReason}`;
    }
    if (state.rateLimitRemaining <= 0) {
      return "rate_limit_exceeded";
    }
    if (state.budgetRemaining !== undefined && state.budgetRemaining <= 0) {
      return "budget_exceeded";
    }
    return null;
  }
  exceedsCostLimit(sessionId, additionalCost) {
    const state = this.getPolicyState(sessionId);
    if (this.config.maxCostPerSession && state.budgetRemaining !== undefined) {
      return state.budgetRemaining - additionalCost < 0;
    }
    return false;
  }
  getRateLimitInfo(sessionId) {
    const remaining = this.rateLimiter.getRemaining(sessionId);
    if (remaining === this.config.maxRequestsPerMinute) {
      return null;
    }
    return {
      remaining,
      resetAt: new Date(Date.now() + 60000).toISOString()
    };
  }
  cleanup() {
    this.rateLimiter.clearExpired();
  }
}

// packages/session/src/store.ts
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink
} from "node:fs/promises";
import { dirname, join } from "node:path";

class SessionStore {
  rootDir;
  autoSave;
  autoSaveIntervalMs;
  maxSessions;
  getMaxSessions() {
    return this.maxSessions;
  }
  indices = new Map;
  autoSaveTimers = new Map;
  constructor(config) {
    this.rootDir = config.rootDir;
    this.autoSave = config.autoSave;
    this.autoSaveIntervalMs = config.autoSaveIntervalMs;
    this.maxSessions = config.maxSessions;
  }
  async ensureDir(dir) {
    await mkdir(dir, { recursive: true });
  }
  sessionDir(sessionId) {
    return join(this.rootDir, "sessions", sessionId.slice(0, 2), sessionId);
  }
  sessionPath(sessionId) {
    return join(this.sessionDir(sessionId), "session.json");
  }
  indexPath() {
    return join(this.rootDir, "sessions", "index.json");
  }
  async loadIndex() {
    const path = this.indexPath();
    try {
      const content = await readFile(path, "utf-8");
      const entries = JSON.parse(content);
      return new Map(entries.map((e) => [e.id, e]));
    } catch {
      return new Map;
    }
  }
  async saveIndex() {
    const entries = Array.from(this.indices.values());
    await this.ensureDir(dirname(this.indexPath()));
    await writeFile(this.indexPath(), JSON.stringify(entries, null, 2), "utf-8");
  }
  async saveToDisk(context) {
    const path = this.sessionPath(context.id);
    await this.ensureDir(dirname(path));
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(context, null, 2), "utf-8");
    await rename(tmp, path);
  }
  async loadFromDisk(sessionId) {
    const path = this.sessionPath(sessionId);
    try {
      const content = await readFile(path, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  updateIndexEntry(context) {
    this.indices.set(context.id, {
      id: context.id,
      userId: context.userId,
      status: context.status,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
      expiresAt: context.expiresAt,
      messageCount: context.messages.length,
      totalTokens: context.tokenUsage.totalTokens
    });
  }
  async initialize() {
    await this.ensureDir(this.rootDir);
    this.indices = await this.loadIndex();
  }
  async save(context) {
    this.updateIndexEntry(context);
    await this.saveToDisk(context);
    if (this.autoSave) {
      this.scheduleAutoSave(context.id);
    }
    await this.saveIndex();
  }
  scheduleAutoSave(sessionId) {
    const existing = this.autoSaveTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(async () => {
      this.autoSaveTimers.delete(sessionId);
      const context = await this.loadFromDisk(sessionId);
      if (context) {
        await this.saveToDisk(context);
      }
    }, this.autoSaveIntervalMs);
    this.autoSaveTimers.set(sessionId, timer);
  }
  async load(sessionId) {
    return this.loadFromDisk(sessionId);
  }
  async delete(sessionId) {
    const timer = this.autoSaveTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.autoSaveTimers.delete(sessionId);
    }
    this.indices.delete(sessionId);
    const dir = this.sessionDir(sessionId);
    try {
      const files = await readdir(dir);
      await Promise.all(files.map((f) => unlink(join(dir, f))));
    } catch {}
    await this.saveIndex();
  }
  async listByUser(userId) {
    const entries = Array.from(this.indices.values()).filter((e) => e.userId === userId);
    return entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      status: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lastActivityAt: e.updatedAt,
      expiresAt: e.expiresAt
    }));
  }
  async listAll() {
    const entries = Array.from(this.indices.values());
    return entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      status: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lastActivityAt: e.updatedAt,
      expiresAt: e.expiresAt
    }));
  }
  async getSummary(sessionId) {
    const entry = this.indices.get(sessionId);
    if (!entry)
      return null;
    return {
      id: entry.id,
      userId: entry.userId,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastActivityAt: entry.updatedAt,
      expiresAt: entry.expiresAt
    };
  }
  async exists(sessionId) {
    return this.indices.has(sessionId);
  }
  async count() {
    return this.indices.size;
  }
  async listByStatus(status) {
    const entries = Array.from(this.indices.values()).filter((e) => e.status === status);
    return entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      status: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lastActivityAt: e.updatedAt,
      expiresAt: e.expiresAt
    }));
  }
  async close() {
    for (const timer of this.autoSaveTimers.values()) {
      clearTimeout(timer);
    }
    this.autoSaveTimers.clear();
    await this.saveIndex();
  }
}

// packages/session/src/manager.ts
var logError = (err) => console.error(`[session] Error: ${err instanceof Error ? err.message : String(err)}`);
var DEFAULT_CONFIG = {
  rootDir: "./sessions",
  sessionTtlMs: 24 * 60 * 60 * 1000,
  maxIdleMs: 30 * 60 * 1000,
  autoSaveIntervalMs: 5000,
  maxMessagesPerSession: 1000,
  maxTokenBudget: 128000,
  enableMetrics: true,
  autoCleanup: true,
  cleanupIntervalMs: 60 * 60 * 1000
};

class SessionManager {
  config;
  store;
  policyEngine;
  contextWindows = new Map;
  eventListeners = new Map;
  cleanupTimer;
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new SessionStore({
      rootDir: this.config.rootDir,
      autoSave: true,
      autoSaveIntervalMs: this.config.autoSaveIntervalMs
    });
    this.policyEngine = new PolicyEngine;
    if (this.config.autoCleanup) {
      this.cleanupTimer = setInterval(() => this.cleanup().catch(logError), this.config.cleanupIntervalMs);
    }
  }
  generateId() {
    return randomBytes(16).toString("hex");
  }
  emit(type, sessionId, data) {
    const event = {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      data
    };
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error("Event listener error:", err);
        }
      }
    }
  }
  on(eventType, listener) {
    let listeners = this.eventListeners.get(eventType);
    if (!listeners) {
      listeners = new Set;
      this.eventListeners.set(eventType, listeners);
    }
    listeners.add(listener);
  }
  off(eventType, listener) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }
  async create(userId, metadata) {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs).toISOString();
    const session = {
      id: this.generateId(),
      userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt,
      metadata
    };
    const context = {
      ...session,
      messages: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        tokenBudget: this.config.maxTokenBudget
      },
      metrics: {
        totalMessages: 0,
        totalToolCalls: 0,
        totalToolResults: 0,
        totalTurns: 0,
        averageLatencyMs: 0,
        errorCount: 0,
        retryCount: 0
      },
      policyState: {
        rateLimitRemaining: 60,
        suspended: false
      }
    };
    await this.store.save(context);
    this.contextWindows.set(session.id, new ContextWindowManager(this.config.maxTokenBudget));
    this.emit("session:created", session.id, { userId, metadata });
    return session;
  }
  async get(sessionId) {
    return this.store.getSummary(sessionId);
  }
  async getContext(sessionId) {
    const context = await this.store.load(sessionId);
    if (context) {
      if (!this.contextWindows.has(sessionId)) {
        const window = new ContextWindowManager(this.config.maxTokenBudget);
        window.initialize(context.messages);
        this.contextWindows.set(sessionId, window);
      }
    }
    return context;
  }
  async end(sessionId) {
    const context = await this.store.load(sessionId);
    if (!context)
      return;
    context.status = "closed";
    context.updatedAt = new Date().toISOString();
    await this.store.save(context);
    this.contextWindows.delete(sessionId);
    this.policyEngine.resetState(sessionId);
    this.emit("session:closed", sessionId);
  }
  async suspend(sessionId, reason) {
    const context = await this.store.load(sessionId);
    if (!context)
      return;
    context.status = "suspended";
    context.updatedAt = new Date().toISOString();
    this.policyEngine.suspend(sessionId, reason);
    await this.store.save(context);
    this.emit("session:suspended", sessionId, { reason });
  }
  async resume(sessionId) {
    const context = await this.store.load(sessionId);
    if (!context)
      return null;
    if (context.status !== "suspended") {
      return null;
    }
    context.status = "active";
    context.updatedAt = new Date().toISOString();
    context.lastActivityAt = new Date().toISOString();
    this.policyEngine.resume(sessionId);
    await this.store.save(context);
    this.emit("session:resumed", sessionId);
    return {
      id: context.id,
      userId: context.userId,
      status: context.status,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
      lastActivityAt: context.lastActivityAt,
      expiresAt: context.expiresAt,
      metadata: context.metadata
    };
  }
  async addMessage(sessionId, message) {
    if (!this.policyEngine.canProceed(sessionId, "message")) {
      const violation = this.policyEngine.getViolationType(sessionId);
      this.emit("policy:violation", sessionId, { violation });
      return null;
    }
    const context = await this.store.load(sessionId);
    if (!context)
      return null;
    let window = this.contextWindows.get(sessionId);
    if (!window) {
      window = new ContextWindowManager(this.config.maxTokenBudget);
      window.initialize(context.messages);
      this.contextWindows.set(sessionId, window);
    }
    const fullMessage = window.add(message);
    context.messages = window.getAll();
    context.metrics.totalMessages++;
    context.updatedAt = new Date().toISOString();
    context.lastActivityAt = new Date().toISOString();
    this.policyEngine.recordAction(sessionId, "message");
    await this.store.save(context);
    this.emit("message:added", sessionId, {
      messageId: fullMessage.id,
      role: fullMessage.role
    });
    return fullMessage;
  }
  async getMessages(sessionId, options) {
    const context = await this.store.load(sessionId);
    if (!context)
      return [];
    const messages = context.messages;
    if (options?.offset) {
      return messages.slice(options.offset);
    }
    if (options?.limit) {
      return messages.slice(-options.limit);
    }
    return messages;
  }
  async getMessagesForContext(sessionId, targetTokens) {
    let window = this.contextWindows.get(sessionId);
    if (!window) {
      const context = await this.store.load(sessionId);
      if (!context)
        return [];
      window = new ContextWindowManager(this.config.maxTokenBudget);
      window.initialize(context.messages);
      this.contextWindows.set(sessionId, window);
    }
    return window.getMessagesForContext(targetTokens);
  }
  async updateTokenUsage(sessionId, usage) {
    const context = await this.store.load(sessionId);
    if (!context)
      return;
    context.tokenUsage = {
      ...context.tokenUsage,
      ...usage
    };
    this.policyEngine.recordTokenUsage(sessionId, context.tokenUsage);
    if (context.tokenUsage.totalCost > this.config.maxTokenBudget / 1000) {
      this.emit("budget:exceeded", sessionId, {
        cost: context.tokenUsage.totalCost
      });
    }
    await this.store.save(context);
  }
  async getMetrics(sessionId) {
    const context = await this.store.load(sessionId);
    return context?.metrics ?? null;
  }
  async listByUser(userId) {
    return this.store.listByUser(userId);
  }
  async delete(sessionId) {
    await this.store.delete(sessionId);
    this.contextWindows.delete(sessionId);
    this.policyEngine.resetState(sessionId);
  }
  async cleanup() {
    const sessions = await this.store.listAll();
    const now = Date.now();
    let cleaned = 0;
    for (const session of sessions) {
      if (session.expiresAt) {
        const expiresAt = new Date(session.expiresAt).getTime();
        if (now >= expiresAt) {
          await this.end(session.id);
          cleaned++;
          this.emit("session:expired", session.id);
        }
      }
      const lastActivity = new Date(session.lastActivityAt).getTime();
      if (now - lastActivity > this.config.maxIdleMs) {
        await this.suspend(session.id, "Idle timeout");
        cleaned++;
      }
    }
    this.policyEngine.cleanup();
    return cleaned;
  }
  async close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    await this.store.close();
  }
}
function createSessionManager(config) {
  return new SessionManager(config);
}
export {
  createSessionManager,
  SessionManager
};
