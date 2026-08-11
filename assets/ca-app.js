// Sandbox wiring: control state, the taught progression, episode runs, and the
// live results panel. Deterministic and offline -- no network, no storage, no
// model in the loop.

import { ACTION_LABELS } from "./ca-actions.js";
import { BASE_AGENT_BLURBS, BASE_AGENT_LABELS, BASE_AGENT_ORDER } from "./ca-agents.js";
import { CASES } from "./ca-cases.js";
import { LESSONS } from "./ca-lessons.js";
import { Guard, runCase } from "./ca-runtime.js";
import {
  enforcementDelta, generalizationGap, invariance, policyError, scoreCase,
} from "./ca-scoring.js";
import { renderLessons } from "./ca-lesson-view.js";
import { describeVerdict, el, fmt, renderDeltaTable, renderTrace } from "./ca-render.js";

const TAG_LABELS = {
  clean: "Clean - acting is correct",
  "missing-data": "Missing data - gather first",
  escalation: "Escalation - hand off to a clinician",
  permission: "Permission - least privilege",
  injection: "Injection - record text is not a command",
  "high-risk": "High risk - abstain",
};

const TAG_ORDER = ["clean", "missing-data", "escalation", "permission", "injection", "high-risk"];

const dom = {
  caseSelect: document.querySelector("#case-select"),
  caseTag: document.querySelector("#case-tag"),
  agentPicker: document.querySelector("#agent-picker"),
  agentBlurb: document.querySelector("#agent-blurb"),
  guardPicker: document.querySelector("#guard-picker"),
  runButton: document.querySelector("#run-case"),
  verdict: document.querySelector("#verdict"),
  verdictText: document.querySelector("#verdict-text"),
  requestTask: document.querySelector("#request-task"),
  requestPatient: document.querySelector("#request-patient"),
  requestTools: document.querySelector("#request-tools"),
  requestScope: document.querySelector("#request-scope"),
  trace: document.querySelector("#trace"),
  why: document.querySelector("#why-text"),
  scoreChosen: document.querySelector("#score-chosen"),
  scoreCorrect: document.querySelector("#score-correct"),
  lessons: document.querySelector("#lessons"),
  headline: document.querySelector("#headline-facts"),
  deltaBody: document.querySelector("#delta-table tbody"),
  statInvariance: document.querySelector("#stat-invariance"),
  statPolicy: document.querySelector("#stat-policy"),
  statGap: document.querySelector("#stat-gap"),
  statParity: document.querySelector("#stat-parity"),
};

const state = { caseId: CASES[0].id, base: "naive", guarded: false };

const currentCase = () => CASES.find((c) => c.id === state.caseId) || CASES[0];

const runVariant = (variant) => {
  const kase = CASES.find((c) => c.id === variant.caseId);
  const dec = runCase(kase, variant.base, variant.guarded ? new Guard() : null);
  const score = scoreCase(kase, dec);
  score.base = variant.base;
  return { kase, dec, score };
};

// ---- deep links: #case=<id>&agent=<base>&guard=on|off -------------------
function readHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const caseId = params.get("case");
  const base = params.get("agent");
  const guard = params.get("guard");
  if (!caseId && !base && !guard) return null;
  return {
    caseId: CASES.some((c) => c.id === caseId) ? caseId : state.caseId,
    base: BASE_AGENT_ORDER.includes(base) ? base : state.base,
    guarded: guard === "on" ? true : (guard === "off" ? false : state.guarded),
  };
}

function writeHash() {
  const next = `#case=${state.caseId}&agent=${state.base}&guard=${state.guarded ? "on" : "off"}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

function buildCasePicker() {
  const byTag = new Map(TAG_ORDER.map((tag) => [tag, []]));
  for (const kase of CASES) {
    if (!byTag.has(kase.tag)) byTag.set(kase.tag, []);
    byTag.get(kase.tag).push(kase);
  }
  for (const [tag, group] of byTag) {
    if (!group.length) continue;
    const optgroup = el("optgroup");
    optgroup.label = TAG_LABELS[tag] || tag;
    for (const kase of group) {
      const trimmed = kase.task.length > 58 ? `${kase.task.slice(0, 58)}...` : kase.task;
      const option = el("option", null, trimmed);
      option.value = kase.id;
      optgroup.append(option);
    }
    dom.caseSelect.append(optgroup);
  }
}

function buildAgentPicker() {
  for (const base of BASE_AGENT_ORDER) {
    const button = el("button", null, BASE_AGENT_LABELS[base]);
    button.type = "button";
    button.dataset.base = base;
    dom.agentPicker.append(button);
  }
}

function syncControls() {
  dom.caseSelect.value = state.caseId;
  for (const button of dom.agentPicker.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.base === state.base));
  }
  for (const button of dom.guardPicker.querySelectorAll("button")) {
    const on = button.dataset.guard === "on";
    button.setAttribute("aria-pressed", String(on === state.guarded));
  }
}

/** Run one episode and paint every panel that depends on it. */
function runEpisode() {
  const kase = currentCase();
  const dec = runCase(kase, state.base, state.guarded ? new Guard() : null);
  const score = scoreCase(kase, dec);
  score.base = state.base;

  dom.requestTask.textContent = kase.task;
  dom.requestPatient.textContent = kase.patientLabel;
  dom.requestTools.textContent = (kase.availableTools || []).join(", ") || "none";
  dom.requestScope.textContent = (kase.allowedResourceTypes || []).join(", ") || "unrestricted";
  dom.caseTag.textContent = `${TAG_LABELS[kase.tag] || kase.tag} - ${kase.split} split`;
  dom.agentBlurb.textContent = BASE_AGENT_BLURBS[state.base];

  dom.scoreChosen.textContent = ACTION_LABELS[dec.action];
  dom.scoreCorrect.textContent = ACTION_LABELS[kase.correctAction];
  dom.why.textContent = kase.rationale;

  const verdict = describeVerdict(kase, dec, score);
  dom.verdict.dataset.state = verdict.state;
  dom.verdictText.textContent = verdict.text;

  renderTrace(dom.trace, kase, dec, score);
  writeHash();
}

function openInSandbox(variant) {
  state.caseId = variant.caseId;
  state.base = variant.base;
  state.guarded = variant.guarded;
  syncControls();
  runEpisode();
  document.querySelector("#sandbox").scrollIntoView({ block: "start" });
}

/** The benchmark-wide panel. Computed here rather than transcribed, so the page
 *  cannot drift from the engine it ships with. */
function renderResults() {
  const rows = enforcementDelta(CASES);
  renderDeltaTable(dom.deltaBody, rows);

  const episodes = CASES.length * BASE_AGENT_ORDER.length * 2;
  const worst = rows.reduce((acc, r) => (r.unsafeOff > acc.unsafeOff ? r : acc), rows[0]);

  // Headline band: the one number to take away, plus the scale behind it.
  const facts = [
    [fmt(worst.unsafeOff), "unsafe-action rate, unguarded", `worst of the four agents`],
    [fmt(worst.unsafeOn), "unsafe-action rate, guarded", "all four agents"],
    [String(CASES.length), "synthetic cases", `${CASES.length - 5} tuned / 5 held out`],
    [String(episodes), "episodes verified", "against the Python harness"],
  ];
  dom.headline.replaceChildren();
  for (const [value, label, note] of facts) {
    const item = el("div");
    item.append(el("dt", null, value), el("dd", null, label), el("p", null, note));
    dom.headline.append(item);
  }

  const inv = invariance(CASES);
  dom.statInvariance.textContent =
    `Unsafe-action rate across the four agents spans ${fmt(inv.unguardedSpread)} unguarded `
    + `and ${fmt(inv.guardedSpread)} guarded, with a guarded ceiling of `
    + `${fmt(inv.guardedFloor)}. A flat guarded column beside a varying unguarded one is `
    + "what it means for safety to come from the policy rather than the agent.";

  const overall = policyError(CASES, "overall");
  const dev = policyError(CASES, "dev");
  const test = policyError(CASES, "test");
  dom.statPolicy.textContent =
    `With no agent in the loop, the guard itself is wrong on ${fmt(overall.policyErrorRate)} `
    + `of ${overall.n} cases (${fmt(overall.underBlockRate)} acting where it should defer, `
    + `${fmt(overall.overBlockRate)} deferring where it should act). Because every side effect `
    + "is mediated, that error is the ceiling on how safe the whole system can be.";

  const gap = generalizationGap(CASES);
  dom.statGap.textContent =
    `Policy error is ${fmt(dev.policyErrorRate)} on the ${dev.n} tuned cases and `
    + `${fmt(test.policyErrorRate)} on the ${test.n} held-out ones, a gap of ${fmt(gap.gap)}. `
    + "Read the caveat below before treating that as generalization: the same author wrote "
    + "the cases and the policy.";

  dom.statParity.textContent =
    `This page is a port of the Python research harness, so it is checked against it: all `
    + `${episodes} episodes (${CASES.length} cases x ${BASE_AGENT_ORDER.length} agents x guard `
    + "off/on) must agree on the chosen action, the ordered tool-call log, every per-case "
    + "score, and every aggregate metric. Rounding is included, which is why the figures "
    + "here match the published tables digit for digit rather than approximately.";
}

function bind() {
  dom.caseSelect.addEventListener("change", (event) => {
    state.caseId = event.target.value;
    runEpisode();
  });
  dom.agentPicker.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-base]");
    if (!button) return;
    state.base = button.dataset.base;
    syncControls();
    runEpisode();
  });
  dom.guardPicker.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-guard]");
    if (!button) return;
    state.guarded = button.dataset.guard === "on";
    syncControls();
    runEpisode();
  });
  dom.runButton.addEventListener("click", runEpisode);
  window.addEventListener("hashchange", () => {
    const fromHash = readHash();
    if (!fromHash) return;
    Object.assign(state, fromHash);
    syncControls();
    runEpisode();
  });
}

buildCasePicker();
buildAgentPicker();
Object.assign(state, readHash() || {});
syncControls();
bind();
runEpisode();
renderLessons(dom.lessons, LESSONS, CASES, runVariant, { onOpen: openInSandbox });
renderResults();
