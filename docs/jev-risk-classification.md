# The risk of a proposed action

The harness decides on its own when a human does not answer. That decision is
only as safe as the facts it rests on, so the risk facts of a pending question
are derived from **the action the agent proposes** - not from the whole
message it happens to arrive in.

`packages/jev-judge/src/question-risk.ts` owns that derivation.

## The action, not the message

An agent message carries the ask ("may I proceed?") and the action ("I will
delete the release branch"). It also carries everything else the agent said
in that turn: what it tried, what it measured, what it decided not to do. A
word in one of those sentences is not a risk of the action.

So the action is extracted first:

```ts
const action = extractProposedAction(contextText, questionText);
```

- The sentences that state what happens are the action.
- The question sentence is not an action: it asks, it does not act.
- A message that names no action falls back to the question text: the risk of
  the question is then the risk of the ask.
- The action is bounded (`MAX_ACTION_CHARS`), so one long message cannot
  dominate the classification.

The risk patterns then run on that action, not on the message.

## The action of the question is assessed on its own text

The question can carry the action that the message does not name: "I can
update the status text. Want me to delete the production database?" states a
harmless action in the message and asks for a deletion in the question.

That action is extracted on its own (`extractQuestionAction`) and classified
on its own text:

```ts
const risk = classifyQuestionRisk({
  kind: "approval",
  text: questionText,
  proposedAction: extractProposedAction(contextText, questionText),
  questionAction: extractQuestionAction(questionText),
});
```

Two things follow from the separation:

- **The bound of the message is a bound of the message.** The action of the
  question is not appended to the action of the message and truncated with
  it: a long harmless explanation cannot push the deletion out of the
  assessment.
- **A negation of the message cannot govern the question.** "I will not
  delete anything in the workspace. Want me to delete the production
  database?" asks for a deletion; the prohibition speaks about the message.

A prohibition in the question is still not a proposal: "Do not delete the
production database." names no action that is proposed.

## A prohibition is not a proposal

"do not delete anything" states that nothing is deleted. The words of a
prohibition must never turn into a destructive action, because the harness
would then block the work for good over a sentence that forbids the very
thing it names.

The negation has to **govern** the action:

- The last negation of the clause is the one that counts.
- A comma, a colon, `and` or `then` between the negation and the action puts
  the negation in another part of the sentence: "this is not a test, delete
  the production database" proposes the deletion.
- `or` is not such a break: "do not remove or delete the branch" prohibits
  both actions.
- More than three words between them and the negation belongs to something
  else: "the plan is not ready so we should delete the branch" proposes the
  deletion.

The vocabulary carries the forms that really occur: `do not`, `don't`,
`never`, `without`, `avoid`, `refrain from`, `no need to`, `must not`,
`shall not`, `cannot`, `can't`, `won't`, `shouldn't`, `mustn't` and the plain
`not` of "will not delete".

### A prohibition hides nothing

Every occurrence of a risk pattern is examined. A prohibited occurrence does
not hide a later one that is proposed:

```text
"Do not delete the branch. Instead, delete the production database."
  -> destructive
```

The pattern counts when at least one of its occurrences is not prohibited.
A prohibition that silenced the whole pattern would let a destructive action
pass as harmless, and the deterministic policy could approve it.

## The patterns know the forms of their verbs

A risk pattern that only knows the bare singular of its verb misses the
action in every other form:

```text
"The production database will be removed."  -> destructive
```

The patterns and the action verbs (`ACTION_VERBS`) name the same forms:
`deleted`, `deletes`, `deleting`, `removes`, `removed`, `dropped`,
`destroyed`, `erased`, `revoked`, `overwritten`, `stopped`, ...

## What the classification produces

`classifyQuestionRisk` returns the facts of the action:

| Fact | Meaning |
| --- | --- |
| `destructive` | the action destroys, drops, overwrites or ends something |
| `reversible` | a destructive action is not provably reversible |
| `external` | the action reaches the outside world (production, deploy, users, money) |
| `requiresExplicitAuthorization` | the action must not be approved on its own |
| `signals` | the names of the patterns that matched |

`requiresExplicitAuthorization` is true when the kind is `explicit`, when
the typed ask is `explicit_authorization`, when the action is destructive,
when it is external or sensitive, and when the kind or the text is unknown.

These facts feed the deterministic policy of the decision
(`applyDecisionPolicy` in `packages/jev-judge/src/auto-continue.ts`): a
destructive or irreversible action waits for the human, a question without
known risk facts waits too, and only an ordinary, reversible action may be
approved on its own.

The risk of the **selected option** is derived the same way: an alternative
can ask for something the question did not mention, so the option that the
evaluation picked is classified again and an option that needs an explicit
authorization turns the decision into a wait.

## The regressions

`packages/jev-judge/tests/question-risk.test.ts` holds the rules:

- the action is extracted from the message, not from the whole message,
- the action of the question is assessed on its own text,
- a prohibition is not a proposal,
- a prohibition does not hide a later destructive action,
- a plain negation and a modal negation are prohibitions,
- a negation of another clause does not govern the action,
- a destructive action in another grammatical form is destructive,
- a question that names no action stays harmless.

## A note on the packaging

This document is repository documentation. It is not shipped in the npm
tarball: `scripts/verify-package-contents.ts` rejects `docs/` as a
forbidden path, because the tarball carries the product and not the
repository.
