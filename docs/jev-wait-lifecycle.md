# The wait for a human answer: one decision, bound to its question

The harness asks the agent's user a question and waits. When the wait is over
the question is decided **once** - by the human, by Jev, or not at all. This
document describes the lifecycle that owns that decision, the rule that binds
a decision to the question it was evaluated for, and the decisions that were
taken in the review.

## The lifecycle

```text
waiting -> evaluating -> decided | human_required | evaluation_error
```

`packages/jev-judge/src/wait-lifecycle.ts` owns it. The controller owns:

- the request the wait belongs to,
- the session the question was asked in,
- the moment the question was asked,
- the cancellation,
- the countdown,
- the one evaluation of that request.

The runtime asks the controller; it does not keep a second copy of the state.
That is why the countdown, the evaluation, the log and the task context always
measure the same wait.

### The rules that matter

- **One evaluation per request.** The countdown and the fallback poll can both
  arrive; only the first one evaluates. A decision to wait ends the automatic
  attempt: the work pauses and a human is needed. Another attempt would be a
  second evaluation of the same question, and it is what turned a five minute
  wait into a repeating countdown.
- **A provider failure is an evaluation error, not a decision.** It never
  becomes "Jev decided to wait": the two mean different things to the reader
  of the log and to the work.
- **Every late result is discarded.** An evaluation that finishes after the
  question was answered, replaced or the session changed changes nothing.
- **An open question blocks the work.** The wait can be over while the
  question is not: Jev asked a human, or the evaluation failed. The question
  is the thing that needs an answer, so the work waits for it until the
  question is answered or cancelled. `harness/pending-question-state.ts` holds
  the rule, and `index.ts` uses it in the handler of a user message and in
  the handler of an `agent_settled` event.
- **A reply of the user closes the question.** A reply in Pi answers the
  question, also when the wait is already over. The question is closed with
  it, so the buttons of the old notification cannot inject a second answer.
- **Closing the question is not an authorization.** The reply says that the
  question is answered, not that the work may continue. The work that waits
  for an answer stays paused - also when the reply declines the proposal
  ("No, do not implement it"). Only an explicit resume directive continues
  the work; an acknowledgment ("okay", "yes") never does.
- **A decline pauses the work.** A reply that declines the proposal is a
  decision about the work: it pauses the continuation explicitly, also
  during the countdown, when nothing was paused yet. The wording of a
  decline is a directive to the harness, so it is recognized at the start of
  the reply ("No, do not implement it", "Never mind", "Cancel that") - a
  negation in the middle of a sentence is not a decline.

## The decision belongs to the question it was evaluated for

The identity travels with the result.

`WaitEvaluation` carries the request and the session it belongs to, and the
controller stamps them from the request it captured **before** it asked the
provider:

```ts
evaluation = {
  ...evaluation,
  requestId: request.requestId,
  sessionId: request.sessionId,
};
```

The runtime applies a decision only while it belongs to the request that
waits:

```ts
if (!waitLifecycle.ownsEvaluation(evaluation)) {
  logToFile("[auto-continue]", "The decision belongs to a question that is gone - discarding it");
  return;
}
```

`ownsEvaluation()` is the whole rule: the evaluation must name a request, that
request must be the one the controller waits for, and the session must be the
one the question was asked in. An evaluation without an identity belongs to
nothing, so the answer to "may I apply this?" is "no".

The gate is the **first** statement of `applyWaitDecision()`. A decision of a
question that was answered, replaced or cancelled therefore reaches no branch
that resolves a question, sends a continuation steer, pauses the work, clears
a wait or changes the status.

### Why the identity is on the result and not read at application time

The application used to read `waitLifecycle.currentRequestId` when it applied a
decision. The evaluation had been made for one request; the application used
whatever request happened to be current at that later moment. Between the two,
the question could have been answered, replaced or cancelled - and the
decision of the old question was applied to the new one.

## The guard against a second evaluation belongs to the caller

`_inferenceInProgress` was reset in the branches of `applyWaitDecision()`. A
result that the controller discarded never reached those branches, so the flag
stayed `true` and **no question was ever decided again in that session**.

The release belongs to the caller of the evaluation:

```ts
const result = await waitLifecycle.evaluateDue();
if (!result.applied || !result.evaluation) {
  _inferenceInProgress = false;   // the attempt is over
  ...
  return;
}
await applyWaitDecision(result.evaluation);
_inferenceInProgress = false;     // applied or discarded
```

## The risk is about the action, not about the message

`extractProposedAction()` derives the concrete action from the message, and
the selected option of a choice question belongs to that action. A message
that talks about many things carries words that have nothing to do with the
action that is proposed, and a prohibition ("do not delete anything") is not
a proposal. An explicit authorization requirement still blocks an autonomous
decision, whoever the requirement came from.

## The decisions of the review

### `PendingQuestionController.startEvaluation()` is not wired into the runtime

`startEvaluation()` moves the current question from `"pending"` to
`"evaluating"`. It has no runtime caller.

Wiring it would change the meaning of `hasPendingQuestion()`, which reports
only `"pending"`:

- `shouldSuppressCompletion()` delegates to `hasPendingQuestion()`. A question
  in the state `"evaluating"` would no longer suppress the completion of the
  session: the session could claim to be complete while Jev is deciding.
- `evaluatePendingQuestion()` uses the same method to decide whether there is
  something to decide about. With the state `"evaluating"` the question would
  look absent, and the evaluation would end with "there is no task and no
  pending question".

Both call sites would have to learn about the third state. The lifecycle
already models the phase in its own state, and the runtime reads it through
`isWaitingForUser()`. The two state machines stay separate: the notification
controller owns the question, the lifecycle owns the wait. This is a
deliberate decision, not an oversight.

### `sharedState.waitingForUserSince` was removed

The field was written in six places and read in none. It was a second copy of
the moment the question was asked, and a second copy is what let the countdown
and the evaluation drift apart. The controller owns that moment
(`questionAskedAt`), and the runtime asks it.

### The recheck path is gone

The countdown has one policy: the deadline of the decision. There is no
"recheck in X minutes" mode, no second countdown and no second attempt. The
fallback poll takes over only after the countdown fired.

### "There is nothing to decide about" is not a decision

The guard in `evaluatePendingQuestion()` ("no task and no pending question")
used to return without a decision. In the lifecycle it has to return
something, and a `"wait"` outcome would have paused the work and logged "Jev
needs a human" - a claim about a human that is not needed. The branch releases
the wait and clears the row instead. The result is discarded as stale, so no
decision is applied, nothing is paused, and the question is not closed.

## The tests

| Where | What it proves |
| --- | --- |
| `packages/jev-judge/tests/wait-lifecycle.test.ts` | Nothing is evaluated before the deadline, exactly once at it. |
| `packages/jev-judge/tests/wait-lifecycle.test.ts` | The elapsed time is measured from the question. |
| `packages/jev-judge/tests/wait-lifecycle.test.ts` | The result carries the request and the session it was evaluated for. |
| `packages/jev-judge/tests/wait-lifecycle.test.ts` | The decision of a replaced question does not belong to the question that waits now. |
| `packages/jev-judge/tests/wait-lifecycle.test.ts` | A session change during an in-flight provider request invalidates the result. |
| `packages/jev-judge/tests/wait-lifecycle.test.ts` | A provider failure is an error, not a decision. |
| `packages/jev-judge/tests/auto-continue-decision.test.ts` | A destructive selected option forces a human; a harmless one does not. |
| `packages/jev-judge/tests/question-risk.test.ts` | The risk is about the proposed action, and a negated action is not a proposal. |
| `test/pending-wait.test.mjs` | The runtime checks the identity before it resolves, continues, pauses, clears the wait or changes the status. |
| `test/pending-wait.test.mjs` | A discarded decision releases the guard, so the next question can be decided. |
| `test/pending-countdown.test.mjs` | The countdown has one policy: there is no recheck. |
| `test/pending-question-state.test.mjs` | The work does not continue behind an open question, also when the wait is over. |
| `test/pending-question-state.test.mjs` | A reply of the user closes a question of a terminal state. |
| `test/pending-question-state.test.mjs` | A declining reply retains the pause. |
| `test/pending-question-state.test.mjs` | A rejection during the countdown pauses the work. |
| `packages/jev-judge/tests/question-risk.test.ts` | The action of the question is assessed on its own text. |

## The rule that stays

A decision belongs to the question it was evaluated for.

The identity travels with the result, the controller checks it, and the
runtime applies nothing without it.
