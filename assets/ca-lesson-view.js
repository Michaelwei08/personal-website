// The lesson view: each lesson's two contrast cards, rendered from live runs.
// Split out of ca-render.js so both stay under the site's 300-line cap.

import { ACTION_LABELS, SIDE_EFFECT_TOOLS, outOfScopeReads } from "./ca-actions.js";
import { el } from "./ca-render.js";

/**
 * One variant of a lesson contrast, as a compact outcome card. Deliberately not
 * the full six-step trace: six lessons times two variants would be 72 steps, and
 * the point of a lesson is the difference, not the detail. The sandbox link
 * carries the reader to the full trace.
 */
function renderVariant(variant, kase, dec, score) {
  const card = el("article", "agent-variant");
  card.dataset.state = score.unsafe ? "unsafe" : "safe";

  card.append(el("p", "agent-variant-label", variant.label));
  card.append(el("p", "agent-variant-action", ACTION_LABELS[dec.action]));

  const reads = dec.toolCalls.filter((c) => c.tool.startsWith("read:"));
  const outOfScope = outOfScopeReads(dec).size;
  const effects = dec.toolCalls.filter((c) => SIDE_EFFECT_TOOLS.includes(c.tool));

  const facts = el("dl", "agent-variant-facts");
  const addFact = (term, value, tone) => {
    const wrap = el("div");
    const dd = el("dd", null, value);
    if (tone) dd.dataset.tone = tone;
    wrap.append(el("dt", null, term), dd);
    facts.append(wrap);
  };
  addFact("Reads", String(reads.length));
  addFact(
    "Out of scope",
    outOfScope ? `${outOfScope} type(s)` : "none",
    outOfScope ? "bad" : "good",
  );
  addFact(
    "Side effects",
    effects.length ? String(effects.length) : "none",
    effects.some((c) => c.exfiltration) ? "bad" : undefined,
  );
  if (score.exfiltrated) addFact("Record leaked", "yes", "bad");
  card.append(facts);

  card.append(el("p", "agent-variant-verdict", score.unsafe ? "Unsafe" : "Safe"));
  return card;
}
/**
 * Render the six-lesson progression. Each lesson runs its own contrast through
 * the live engine, so the page cannot describe an outcome the engine would not
 * produce.
 */
export function renderLessons(container, lessons, cases, runVariant, { onOpen } = {}) {
  container.replaceChildren();

  for (const lesson of lessons) {
    const section = el("section", "agent-lesson");
    section.setAttribute("aria-labelledby", `lesson-${lesson.n}`);

    const head = el("div", "agent-lesson-head");
    head.append(el("span", "agent-lesson-num", lesson.n));
    const title = el("h3", null, lesson.title);
    title.id = `lesson-${lesson.n}`;
    head.append(title);
    section.append(head);
    section.append(el("p", "agent-lesson-concept", lesson.concept));

    const grid = el("div", "agent-variants");
    for (const variant of lesson.variants) {
      const kase = cases.find((c) => c.id === variant.caseId);
      if (!kase) continue;
      const { dec, score } = runVariant(variant);
      const card = renderVariant(variant, kase, dec, score);

      const open = el("button", "agent-variant-open", "Open in the sandbox");
      open.type = "button";
      open.addEventListener("click", () => onOpen && onOpen(variant));
      card.append(open);
      grid.append(card);
    }
    section.append(grid);

    const notes = el("dl", "agent-lesson-notes");
    const addNote = (term, value, tone) => {
      const wrap = el("div");
      if (tone) wrap.dataset.tone = tone;
      wrap.append(el("dt", null, term), el("dd", null, value));
      notes.append(wrap);
    };
    addNote("What this shows", lesson.shows, "shows");
    addNote("What it does not show", lesson.limits, "limits");
    section.append(notes);

    container.append(section);
  }
}
