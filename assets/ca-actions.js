// Action space and episode records. Port of vmag/actions.py.
//
// The four resolutions of any agent step. A clinical agent fails dangerously not
// only by being wrong, but by acting when the safe move was to gather, abstain,
// or hand off -- so "act" is one option among four, never the default.

export const ACT = "act";
export const GATHER = "gather-missing-info";
export const ABSTAIN = "abstain";
export const ESCALATE = "escalate-to-clinician";

export const ACTIONS = [ACT, GATHER, ABSTAIN, ESCALATE];

// Anything that is not autonomous action.
export const DEFERRALS = [GATHER, ABSTAIN, ESCALATE];

// Side-effectful tools. Attempting one of these is what makes a wrong action
// dangerous rather than merely incorrect.
export const SIDE_EFFECT_TOOLS = ["draft_order", "send_message"];

export const ACTION_LABELS = {
  [ACT]: "Act",
  [GATHER]: "Gather missing info",
  [ABSTAIN]: "Abstain",
  [ESCALATE]: "Escalate to clinician",
};

// Past-tense forms, for prose that reports what an agent did rather than naming
// the option. Lowercasing ACTION_LABELS instead yields "held back and escalate
// to clinician".
export const ACTION_PAST = {
  [ACT]: "acted on the request",
  [GATHER]: "asked for the missing information first",
  [ABSTAIN]: "abstained",
  [ESCALATE]: "escalated to a clinician",
};

export const isDeferral = (action) => DEFERRALS.includes(action);

/** A tool call the environment recorded. */
export function toolCall(tool, { detail = "", outOfScope = false, exfiltration = false } = {}) {
  return { tool, detail, outOfScope, exfiltration };
}

/** A state-changing action a base agent proposes, subject to guard review. */
export function sideEffect(tool, { text = "", recipient = null } = {}) {
  return { tool, text, recipient };
}

/**
 * A base agent's proposal, before any enforcement.
 *
 * Separating the proposal from execution is what lets the same base agent run
 * with the guard on or off, which is what makes the enforcement delta a clean
 * A/B rather than a comparison of two different agents.
 */
export function plan(intendedAction, {
  reads = [],
  sideEffects = [],
  followInjection = false,
  rationale = "",
} = {}) {
  return { intendedAction, reads, sideEffects, followInjection, rationale };
}

const readTypes = (calls, predicate) => {
  const out = new Set();
  for (const call of calls) {
    if (call.tool.startsWith("read:") && predicate(call)) {
      out.add(call.tool.slice("read:".length));
    }
  }
  return out;
};

export function accessedResourceTypes(decision) {
  return readTypes(decision.toolCalls, () => true);
}

export function outOfScopeReads(decision) {
  return readTypes(decision.toolCalls, (call) => call.outOfScope);
}

export function didExfiltrate(decision) {
  return decision.toolCalls.some((call) => call.exfiltration);
}

export function didSideEffect(decision) {
  return decision.toolCalls.some((call) => SIDE_EFFECT_TOOLS.includes(call.tool));
}

export function decision(action, rationale = "", toolCalls = []) {
  return { action, rationale, toolCalls };
}
