/**
 * Sprint Planner Tests (RFC-0074)
 */

import { describe, it, expect } from "bun:test";
import {
  planSprints,
  createSprintConfig,
  sortRequirements,
  calculateVelocity,
  decomposeRequirement,
  assignEstimate,
  sumPoints,
} from "../src/index.js";
import type { Requirement } from "../src/index.js";

const makeReq = (overrides?: Partial<Requirement>): Requirement => ({
  id: `req-${Math.random().toString(36).slice(2)}`,
  title: "Test Requirement",
  description: "Test description",
  priority: "medium",
  acceptanceCriteria: [],
  labels: [],
  dependencies: [],
  ...overrides,
});

describe("decomposeRequirement", () => {
  it("creates at least 3 tasks", () => {
    const req = makeReq();
    const tasks = decomposeRequirement(req);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("all tasks reference requirement ID", () => {
    const req = makeReq({ id: "req-123" });
    const tasks = decomposeRequirement(req);
    for (const t of tasks) {
      expect(t.requirementId).toBe("req-123");
    }
  });

  it("respects custom estimate", () => {
    const req = makeReq({ estimate: 8 });
    const tasks = decomposeRequirement(req);
    expect(tasks[0].estimate).toBe(8);
  });

  it("creates AC tasks", () => {
    const req = makeReq({ acceptanceCriteria: ["AC1", "AC2"] });
    const tasks = decomposeRequirement(req);
    expect(tasks.some((t) => t.title.includes("AC1"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("AC2"))).toBe(true);
  });
});

describe("assignEstimate", () => {
  it("returns 1 for complexity 1", () => expect(assignEstimate(1)).toBe(1));
  it("returns 3 for mid complexity", () => expect(assignEstimate(5)).toBe(3));
  it("caps at 21", () => expect(assignEstimate(100)).toBe(21));
});

describe("sumPoints", () => {
  it("sums task estimates", () => {
    const tasks = [
      { estimate: 3, requirementId: "1", title: "", description: "", status: "todo", labels: [] },
      { estimate: 5, requirementId: "1", title: "", description: "", status: "todo", labels: [] },
    ] as any[];
    expect(sumPoints(tasks)).toBe(8);
  });

  it("treats undefined as 0", () => {
    const tasks = [
      { estimate: undefined, requirementId: "1", title: "", description: "", status: "todo", labels: [] },
    ] as any[];
    expect(sumPoints(tasks)).toBe(0);
  });
});

describe("sortRequirements", () => {
  it("sorts critical before high before medium before low", () => {
    const reqs = [
      makeReq({ id: "low", priority: "low" }),
      makeReq({ id: "critical", priority: "critical" }),
      makeReq({ id: "high", priority: "high" }),
      makeReq({ id: "medium", priority: "medium" }),
    ];
    const sorted = sortRequirements(reqs, "priority-then-dependencies");
    expect(sorted.map((r) => r.priority)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("respects moSCoW strategy", () => {
    const reqs = [
      makeReq({ id: "a", priority: "low" }),
      makeReq({ id: "b", priority: "critical" }),
    ];
    const sorted = sortRequirements(reqs, "moSCoW");
    expect(sorted[0].id).toBe("b");
  });
});

describe("createSprintConfig", () => {
  it("has sensible defaults", () => {
    const cfg = createSprintConfig();
    expect(cfg.sprintDurationDays).toBe(14);
    expect(cfg.capacityPerDay).toBe(5);
    expect(cfg.defaultEstimate).toBe(3);
  });

  it("accepts overrides", () => {
    const cfg = createSprintConfig({ sprintDurationDays: 7 });
    expect(cfg.sprintDurationDays).toBe(7);
    expect(cfg.capacityPerDay).toBe(5);
  });
});

describe("planSprints", () => {
  it("creates at least one sprint", () => {
    const reqs = [makeReq()];
    const result = planSprints(reqs);
    expect(result.sprints.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns all requirements to sprints", () => {
    const reqs = [makeReq({ id: "r1" }), makeReq({ id: "r2" })];
    const result = planSprints(reqs);
    const assigned = new Set(result.sprints.flatMap((s) => s.tasks.map((t) => t.requirementId)));
    expect(assigned.has("r1")).toBe(true);
    expect(assigned.has("r2")).toBe(true);
  });

  it("calculates total points", () => {
    const reqs = [makeReq({ estimate: 5 })];
    const result = planSprints(reqs);
    expect(result.totalPoints).toBeGreaterThan(0);
  });

  it("handles empty list", () => {
    const result = planSprints([]);
    expect(result.sprints).toEqual([]);
    expect(result.totalPoints).toBe(0);
  });

  it("includes sprint dates", () => {
    const result = planSprints([makeReq()]);
    expect(result.sprints[0].startDate < result.sprints[0].endDate).toBe(true);
  });

  it("prioritizes critical requirements", () => {
    const reqs = [
      makeReq({ id: "low1", priority: "low" }),
      makeReq({ id: "critical1", priority: "critical" }),
    ];
    const result = planSprints(reqs);
    const firstReqs = new Set(result.sprints[0]?.tasks.map((t) => t.requirementId));
    expect(firstReqs.has("critical1")).toBe(true);
  });
});

describe("calculateVelocity", () => {
  it("returns 0 for no sprints", () => expect(calculateVelocity([])).toBe(0));

  it("returns 0 when no sprints are completed", () => {
    const sprints: any[] = [{
      id: "s1", number: 1, name: "S1", startDate: "2024-01-01", endDate: "2024-01-14",
      capacity: 20,
      tasks: [{ id: "t1", requirementId: "r1", title: "t", description: "", status: "in-progress", estimate: 5, labels: [] }],
    }];
    expect(calculateVelocity(sprints)).toBe(0);
  });

  it("calculates velocity from completed sprints", () => {
    const sprints: any[] = [
      {
        id: "s1", number: 1, name: "S1", startDate: "2024-01-01", endDate: "2024-01-14",
        capacity: 20,
        tasks: [{ id: "t1", requirementId: "r1", title: "t", description: "", status: "done", estimate: 8, labels: [] }],
      },
      {
        id: "s2", number: 2, name: "S2", startDate: "2024-01-15", endDate: "2024-01-28",
        capacity: 20,
        tasks: [{ id: "t2", requirementId: "r2", title: "t", description: "", status: "done", estimate: 8, labels: [] }],
      },
    ];
    expect(calculateVelocity(sprints)).toBe(8);
  });
});
