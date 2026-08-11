// Replay viewer for HEIST/32.
//
// This file animates a trace exported from the Python project; it does not
// simulate anything. The engine is deliberately not ported -- the sibling
// Ultimate Tic-Tac-Toe project keeps three copies of its rules and pays for it
// on every change, and heist's engine is larger. What runs here is the same
// episode that produced the published numbers.
//
// The one thing duplicated from Python is the glyph mapping below, roughly
// fifteen lines mirroring render.py's `_cell` and game.py's `glyph`. If it ever
// drifts the picture is wrong, but no measurement is: nothing on this page
// feeds a number.

import { REPLAY } from './heist-replays.js';

const DOOR_OPEN = 1;
const BREACHED = 2;
const CARD_TAKEN = 4;
const LOOT_TAKEN = 8;
const ESCAPED_0 = 16;
const ESCAPED_1 = 32;

const GLYPH_CLASS = {
  '#': 'w',
  '.': 'f',
  E: 'e',
  A: 's',
  B: 's',
  k: 'k',
  $: 'l',
  V: 'v',
  v: 'v',
  '+': 'd',
  '/': 'd',
  g: 'g',
  1: 'a1',
  2: 'a2',
  '&': 'a1',
};

const FRAME_MS = 90;

function cellGlyph(index, frame) {
  const [a0, a1, flags] = frame;
  const guards = frame.slice(6);
  const cells = REPLAY.cells;

  const out0 = (flags & ESCAPED_0) !== 0;
  const out1 = (flags & ESCAPED_1) !== 0;
  const here0 = !out0 && a0 === index;
  const here1 = !out1 && a1 === index;
  if (here0 && here1) return '&';
  if (here0) return '1';
  if (here1) return '2';
  if (guards.includes(index)) return 'g';

  if (index === cells.keycardDoor) return (flags & DOOR_OPEN) !== 0 ? '/' : '+';
  if (index === cells.vaultDoor) return (flags & BREACHED) !== 0 ? 'v' : 'V';
  if (index === cells.keycard && (flags & CARD_TAKEN) !== 0) return '.';
  if (index === cells.loot && (flags & LOOT_TAKEN) !== 0) return '.';

  const { width } = REPLAY;
  return REPLAY.terrain[Math.floor(index / width)][index % width];
}

function renderGrid(frame) {
  const { width, height } = REPLAY;
  const lines = [];
  for (let y = 0; y < height; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) {
      const glyph = cellGlyph(y * width + x, frame);
      row += `<span class="c ${GLYPH_CLASS[glyph] || 'f'}">${
        glyph === '&' ? '&amp;' : glyph
      }</span>`;
    }
    lines.push(row);
  }
  return lines.join('\n');
}

function phase(frame) {
  const flags = frame[2];
  if ((flags & ESCAPED_0) !== 0 && (flags & ESCAPED_1) !== 0) return 'both out';
  if ((flags & LOOT_TAKEN) !== 0) return 'loot lifted';
  if ((flags & BREACHED) !== 0) return 'vault breached';
  if ((flags & DOOR_OPEN) !== 0) return 'door open';
  if ((flags & CARD_TAKEN) !== 0) return 'keycard taken';
  return 'searching';
}

function init() {
  const root = document.querySelector('[data-heist]');
  if (!root) return;

  const grid = root.querySelector('[data-grid]');
  const budgetInput = root.querySelector('[data-budget]');
  const tickInput = root.querySelector('[data-tick]');
  const playButton = root.querySelector('[data-play]');
  const readouts = {
    budget: root.querySelector('[data-out-budget]'),
    tick: root.querySelector('[data-out-tick]'),
    alarm: root.querySelector('[data-out-alarm]'),
    comms: root.querySelector('[data-out-comms]'),
    phase: root.querySelector('[data-out-phase]'),
    verdict: root.querySelector('[data-out-verdict]'),
  };

  let runIndex = Number(budgetInput.value);
  let cursor = 0;
  let timer = null;

  function run() {
    return REPLAY.runs[runIndex];
  }

  function draw() {
    const current = run();
    const frame = current.frames[Math.min(cursor, current.frames.length - 1)];
    grid.innerHTML = renderGrid(frame);
    // The grid is 165 one-character spans. Without role="img" on the element a
    // screen reader reads every cell aloud, so the label carries the state
    // instead and the readout below repeats it as ordinary text.
    grid.setAttribute(
      'aria-label',
      `Vault replay, budget ${current.budget} characters, tick ${cursor}: ` +
        `${phase(frame)}, alarm ${frame[3]} of ${REPLAY.limits.alarmLimit}.`,
    );
    readouts.budget.textContent = String(current.budget);
    readouts.tick.textContent = `${cursor} / ${current.frames.length - 1}`;
    readouts.alarm.textContent = `${frame[3]} / ${REPLAY.limits.alarmLimit}`;
    readouts.comms.textContent = String(
      current.budget * 2 - frame[4] - frame[5],
    );
    readouts.phase.textContent = phase(frame);
    readouts.verdict.textContent = current.success
      ? `escaped after ${current.ticks} ticks`
      : `${current.reason} -- never got out`;
    readouts.verdict.dataset.state = current.success ? 'win' : 'loss';
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    playButton.textContent = 'Play';
    playButton.setAttribute('aria-pressed', 'false');
  }

  function start() {
    if (timer !== null) return;
    if (cursor >= run().frames.length - 1) cursor = 0;
    playButton.textContent = 'Pause';
    playButton.setAttribute('aria-pressed', 'true');
    timer = window.setInterval(() => {
      if (cursor >= run().frames.length - 1) {
        stop();
        return;
      }
      cursor += 1;
      tickInput.value = String(cursor);
      draw();
    }, FRAME_MS);
  }

  function selectRun(index) {
    const wasPlaying = timer !== null;
    stop();
    runIndex = index;
    cursor = 0;
    tickInput.max = String(run().frames.length - 1);
    tickInput.value = '0';
    draw();
    if (wasPlaying) start();
  }

  budgetInput.addEventListener('input', () => selectRun(Number(budgetInput.value)));
  tickInput.addEventListener('input', () => {
    stop();
    cursor = Number(tickInput.value);
    draw();
  });
  playButton.addEventListener('click', () => (timer === null ? start() : stop()));

  root.dataset.ready = 'true';
  selectRun(runIndex);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!still.matches) start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
