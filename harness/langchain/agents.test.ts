
import { describe, it } from "node:test";
import assert from "node:assert";
import { isAutonomyRequest } from "./agents.js";

describe("isAutonomyRequest", () => {
  const shouldMatch = [
    "You are free to write code until finish without my permission",
    "you are free to write code until finish without permission",
    "free to write code without permission",
    "free to implement until done",
    "free to build until complete",
    "autonomous mode",
    "autonomous",
    "self-directed coding",
    "no need for human approval",
    "no need for confirmation",
    "proceed without my approval",
    "proceed without human",
  ];

  const shouldNotMatch = [
    "please review the code",
    "check the output",
    "run tests and report",
    "waiting for human input",
  ];

  for (const text of shouldMatch) {
    it(`matches: "${text.slice(0, 50)}"`, () => {
      assert.ok(isAutonomyRequest(text), `Expected to match: ${text}`);
    });
  }

  for (const text of shouldNotMatch) {
    it(`does NOT match: "${text}"`, () => {
      assert.ok(!isAutonomyRequest(text), `Expected NOT to match: ${text}`);
    });
  }
});
