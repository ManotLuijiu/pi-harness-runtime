/**
 * Pending Question Controller Tests
 * 
 * Tests for the pending question detection, state management,
 * and channel delivery logic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { 
  PendingQuestionController,
  createPendingQuestionController,
  type QuestionKind,
} from "../src/pending-question.js";

describe("PendingQuestionController", () => {
  let controller: PendingQuestionController;

  beforeEach(() => {
    controller = createPendingQuestionController({
      evaluationDelayMs: 5 * 60 * 1000,
      jevEnabled: false,
    });
  });

  describe("detectQuestion", () => {
    it("should detect 'Want me to implement X?' pattern", () => {
      const result = controller.detectQuestion(
        "I've finished the toggle implementation. Want me to implement the toggle buttons now?"
      );
      expect(result.detected).toBe(true);
      expect(result.questionText).toContain("Want me to implement");
      expect(result.kind).toBe("approval");
      expect(result.isRoutine).toBe(false);
    });

    it("should detect 'Would you like me to add X?' pattern", () => {
      const result = controller.detectQuestion(
        "Would you like me to add the persistence layer next?"
      );
      expect(result.detected).toBe(true);
      expect(result.questionText).toContain("Would you like me to add");
      expect(result.kind).toBe("approval");
    });

    it("should detect 'Shall I start X?' pattern", () => {
      const result = controller.detectQuestion(
        "Shall I start with the database schema?"
      );
      expect(result.detected).toBe(true);
      expect(result.kind).toBe("approval");
    });

    it("should detect 'Should I implement X?' pattern", () => {
      const result = controller.detectQuestion(
        "Should I implement the SQLite persistence now?"
      );
      expect(result.detected).toBe(true);
      expect(result.kind).toBe("approval");
    });

    it("should detect question ending with ? with request + intent words", () => {
      const result = controller.detectQuestion(
        "Should I continue with the next task?"
      );
      expect(result.detected).toBe(true);
      expect(result.kind).toBe("routine");
      expect(result.isRoutine).toBe(true);
    });

    it("should detect 'Should I continue?' as routine", () => {
      const result = controller.detectQuestion("Should I continue?");
      expect(result.detected).toBe(true);
      expect(result.isRoutine).toBe(true);
    });

    it("should NOT detect quoted questions", () => {
      const result = controller.detectQuestion(
        `Here's an example: "Want me to implement this?" - that's what I might ask.`
      );
      // The quoted question should not be detected
      expect(result.detected).toBe(false);
    });

    it("should NOT detect rhetorical questions in code blocks", () => {
      const result = controller.detectQuestion(
        `\`\`\`\n// Want me to implement this?\n\`\`\`\nThe code above shows what we need.`
      );
      expect(result.detected).toBe(false);
    });

    it("should detect clarification questions", () => {
      const result = controller.detectQuestion(
        "Do you mean the SQLite or the file-based approach?"
      );
      expect(result.detected).toBe(true);
      expect(result.kind).toBe("clarification");
    });

    it("should NOT detect plain progress statements", () => {
      const result = controller.detectQuestion(
        "I've implemented the toggle buttons and they work correctly."
      );
      expect(result.detected).toBe(false);
    });

    it("should detect 'Can I proceed?' as routine", () => {
      const result = controller.detectQuestion("Can I proceed with the next step?");
      expect(result.detected).toBe(true);
      expect(result.isRoutine).toBe(true);
    });
  });

  describe("question lifecycle", () => {
    it("should create and track a pending question", () => {
      const question = controller.createQuestion({
        text: "Want me to implement the toggle buttons now?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      expect(question.requestId).toBeDefined();
      expect(question.state).toBe("pending");
      expect(question.kind).toBe("approval");
      expect(controller.hasPendingQuestion()).toBe(true);
      expect(controller.getCurrentQuestion()).toEqual(question);
    });

    it("should resolve a question with 'yes'", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.resolve({ resolution: "yes", by: "user" });

      expect(controller.isResolved()).toBe(true);
      expect(controller.getResolution()).toBe("yes");
      expect(controller.getCurrentQuestion()?.state).toBe("resolved");
      expect(controller.getCurrentQuestion()?.resolvedBy).toBe("user");
    });

    it("should resolve a question with 'no'", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.resolve({ resolution: "no", by: "user" });

      expect(controller.getResolution()).toBe("no");
    });

    it("should cancel a question", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.cancel("Session switched");

      expect(controller.hasPendingQuestion()).toBe(false);
      expect(controller.getCurrentQuestion()).toBe(null);
    });

    it("should start evaluation", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.startEvaluation();

      expect(controller.getCurrentQuestion()?.state).toBe("evaluating");
    });
  });

  describe("channel delivery state", () => {
    it("should update Telegram delivery state", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.updateDeliveryState("telegram", true);
      
      const question = controller.getCurrentQuestion();
      expect(question?.deliveryState.telegram?.delivered).toBe(true);
      expect(question?.deliveryState.telegram?.deliveredAt).toBeDefined();
      expect(question?.userNotified).toBe(true);
    });

    it("should update LINE delivery state", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.updateDeliveryState("line", true);
      
      const question = controller.getCurrentQuestion();
      expect(question?.deliveryState.line?.delivered).toBe(true);
    });

    it("should track delivery errors", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.updateDeliveryState("telegram", false, "Network error");
      
      const question = controller.getCurrentQuestion();
      expect(question?.deliveryState.telegram?.delivered).toBe(false);
      expect(question?.deliveryState.telegram?.error).toBe("Network error");
    });
  });

  describe("suppress completion", () => {
    it("should suppress completion when pending question exists", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      expect(controller.shouldSuppressCompletion()).toBe(true);
    });

    it("should NOT suppress completion when no pending question", () => {
      expect(controller.shouldSuppressCompletion()).toBe(false);
    });

    it("should NOT suppress completion when question is resolved", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.resolve({ resolution: "yes", by: "user" });

      expect(controller.shouldSuppressCompletion()).toBe(false);
    });
  });

  describe("callbacks", () => {
    it("should call user answer callback on resolution", () => {
      let callbackCalled = false;
      let callbackResolution = "";
      
      controller.onUserAnswer((question, answer) => {
        callbackCalled = true;
        callbackResolution = answer;
      });

      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.resolve({ resolution: "yes", by: "user" });

      expect(callbackCalled).toBe(true);
      expect(callbackResolution).toBe("yes");
    });
  });

  describe("cleanup", () => {
    it("should clean up old resolved questions", () => {
      controller.createQuestion({
        text: "Want me to implement X?",
        sessionId: "test-session",
        workspacePath: "/test",
        kind: "approval",
      });

      controller.resolve({ resolution: "yes", by: "user" });

      // Wait a tiny bit then cleanup with 0ms max age
      setTimeout(() => {
        controller.cleanup(0);
        const questions = controller.getAllQuestions();
        expect(questions.length).toBe(0);
      }, 10);
    });
  });
});

describe("Question detection edge cases", () => {
  let controller: PendingQuestionController;

  beforeEach(() => {
    controller = createPendingQuestionController();
  });

  it("should handle multiple questions in one message", () => {
    const result = controller.detectQuestion(
      "I've finished task 1. Want me to implement the toggle buttons now? Should I continue with the next task?"
    );
    // Should detect the approval question, not the routine continuation
    expect(result.detected).toBe(true);
    expect(result.kind).toBe("approval");
  });

  it("should handle mixed content with questions", () => {
    const result = controller.detectQuestion(
      `Here's what I did:\n1. Implemented toggle state\n2. Added persistence\n\nWant me to continue with the UI?`
    );
    expect(result.detected).toBe(true);
    expect(result.kind).toBe("approval");
  });
});
