// The taught progression: six lessons, each one contrast the engine can run.
//
// Every lesson names two runs that differ in exactly one thing -- the record, or
// the guard, never both -- so the reader can attribute the change. The engine
// executes them live at page load; nothing here is a transcript, and nothing is
// asserted that the run does not show.
//
// `shows` and `limits` are both required. A lesson that only claims is not a
// lesson, and the site's house style is to state the limit next to the result.

export const LESSONS = [
  {
    n: "01",
    title: "Four resolutions, not two",
    concept: "Every step resolves to one of four things: act, gather the missing "
      + "information, abstain, or escalate to a clinician. Treating \"act\" as one option "
      + "among four -- rather than as the default with a refusal bolted on -- is what makes "
      + "appropriate deferral something you can measure at all.",
    variants: [
      {
        label: "Refill, labs on file",
        caseId: "clean_refill_001", base: "naive", guarded: true,
      },
      {
        label: "Controlled substance",
        caseId: "escalation_opioid_001", base: "naive", guarded: true,
      },
    ],
    shows: "Same agent, same guard. The correct resolution differs because the task and "
      + "the record differ, not because the agent changed its mind.",
    limits: "Two cases resolving correctly says nothing about the other twelve, or about "
      + "cases nobody has written yet.",
  },
  {
    n: "02",
    title: "A precondition the model cannot talk its way past",
    concept: "A renally-monitored refill needs a recent creatinine. The guard checks the "
      + "record for one and resolves on what it finds. The request is phrased identically in "
      + "both runs below -- only the chart differs.",
    variants: [
      {
        label: "Creatinine within 365 days",
        caseId: "clean_refill_001", base: "naive", guarded: true,
      },
      {
        label: "No creatinine on file",
        caseId: "missing_data_refill_001", base: "naive", guarded: true,
      },
    ],
    shows: "The resolution is a function of data, not of phrasing. The second run asks for "
      + "the missing labs instead of drafting the order.",
    limits: "The precondition itself is authored by hand. A rule this simple would not "
      + "survive contact with real prescribing practice.",
  },
  {
    n: "03",
    title: "The failure a keyword filter cannot see",
    concept: "A request names a patient and a date of birth that do not match the open "
      + "record. Nothing in the wording is alarming -- there is no red-flag term to catch -- "
      + "so a guardrail that only reads the request sails straight through it.",
    variants: [
      {
        label: "Keyword filter alone",
        caseId: "wrong_patient_001", base: "keyword", guarded: false,
      },
      {
        label: "Guard compares to the record",
        caseId: "wrong_patient_001", base: "keyword", guarded: true,
      },
    ],
    shows: "Catching this requires actually comparing the request against the chart. "
      + "Scanning the prompt for dangerous-sounding words cannot do it.",
    limits: "The identity check here is an exact string match on name and date of birth, "
      + "which is far more brittle than real patient matching.",
  },
  {
    n: "04",
    title: "Least privilege is a number",
    concept: "Summarising someone's medications needs two kinds of record. An agent that "
      + "reads everything available gets the same answer while touching data the task never "
      + "justified -- and \"how much did it touch\" is a quantity, not a vibe.",
    variants: [
      {
        label: "Agent reads what it likes",
        caseId: "permission_meds_001", base: "naive", guarded: false,
      },
      {
        label: "Guard provisions the scope",
        caseId: "permission_meds_001", base: "naive", guarded: true,
      },
    ],
    shows: "Both runs resolve the task correctly. They differ in exposure, which is why "
      + "exposure is scored separately from correctness.",
    limits: "Resource-type counting is a coarse proxy. It says nothing about how sensitive "
      + "any particular record was.",
  },
  {
    n: "05",
    title: "Record text is data, never commands",
    concept: "The chart free-text in this case carries an instruction addressed to the "
      + "assistant, telling it to forward the record to an outside address. Both runs read "
      + "that text. One of them obeys it.",
    variants: [
      {
        label: "Guard off",
        caseId: "injection_meds_001", base: "naive", guarded: false,
      },
      {
        label: "Guard on",
        caseId: "injection_meds_001", base: "naive", guarded: true,
      },
    ],
    shows: "One toggle, one leak. The guarded run reads the same injected sentence and "
      + "treats it as content rather than as an order.",
    limits: "This is one injection phrased one way. A serious evaluation varies the payload "
      + "and the delivery channel; a single hand-written string does not.",
  },
  {
    n: "06",
    title: "Safety that does not depend on the agent",
    concept: "The four agents below run from cautious to deliberately adversarial. If "
      + "safety came from the agent's judgment, the guarded column would move as the agent "
      + "gets worse. The point of putting enforcement outside the model is that it does not.",
    // Same case, same (absent) guard, different agent. An opioid request carries a
    // red-flag word, so the keyword filter happens to defer correctly here while
    // the adversarial agent drafts the order -- which is the point: unguarded, the
    // outcome is a property of the agent you happened to get.
    variants: [
      {
        label: "Keyword filter, guard off",
        caseId: "escalation_opioid_001", base: "keyword", guarded: false,
      },
      {
        label: "Adversarial agent, guard off",
        caseId: "escalation_opioid_001", base: "worst_case", guarded: false,
      },
    ],
    shows: "Unguarded, the outcome is a property of the agent, not of the case. One defers "
      + "correctly and one drafts a controlled-substance order. The table below shows the "
      + "guarded column flat across all four agents, which is the claim this design makes.",
    limits: "The adversarial agent is a constructed upper bound, not a real attacker, and "
      + "all four agents are deterministic stand-ins rather than language models.",
    seeTable: true,
  },
];
