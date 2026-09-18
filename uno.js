/* 🃏 UNO — pure two-player rules, no I/O (the engine.js twin).
   Cards are compact strings: "r5" (red 5), "yS" (skip), "gR" (reverse),
   "bD" (draw two), "W" (wild), "W4" (wild draw four).
   Like Phase 10, the WHOLE state lives in one jsonb row (hands included) —
   no cross-device determinism needed, so Math.random shuffles are fine.

   Two-player readings of the classics:
   - Skip and Reverse both mean the opponent misses a turn → you go again
   - Draw Two: opponent draws 2 on the spot and is skipped → you go again
   - Wild Draw Four: opponent draws 4, you pick the color, you go again
   - After drawing, a playable card may be played immediately or kept */

export const COLORS = ["r", "y", "g", "b"];
export const colorOf = (c) => (c[0] === "W" ? null : c[0]);
export const faceOf = (c) => (c[0] === "W" ? c : c.slice(1));
export const isWild = (c) => c === "W" || c === "W4";

export function buildDeck() {
  const d = [];
  for (const col of COLORS) {
    d.push(col + "0");
    for (let n = 1; n <= 9; n++) { d.push(col + n); d.push(col + n); }
    for (const f of ["S", "R", "D"]) { d.push(col + f); d.push(col + f); }
  }
  for (let i = 0; i < 4; i++) { d.push("W"); d.push("W4"); }
  return d;                                          // 108
}

const shuffle = (a) => {
  const d = a.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

export function deal(dealerId, otherId) {
  let deck = shuffle(buildDeck());
  const hands = { [dealerId]: deck.splice(0, 7), [otherId]: deck.splice(0, 7) };
  // flip until a NUMBER card leads the discard (no opening chaos)
  let top = deck.shift();
  const buried = [];
  while (!/\d$/.test(top)) { buried.push(top); top = deck.shift(); }
  deck = deck.concat(shuffle(buried));
  return {
    deck, discard: [top], hands, players: [dealerId, otherId],
    turn: otherId,                                   // the challenged player leads
    color: colorOf(top), status: "playing", winner: null,
    drawn: null, uno: null, last: null,
  };
}

export const topOf = (s) => s.discard[s.discard.length - 1];
export const oppOf = (s, pid) => s.players.find((p) => p !== pid);

export function canPlay(card, top, color) {
  if (isWild(card)) return true;
  if (colorOf(card) === color) return true;
  return faceOf(card) === faceOf(top);
}

// draw n cards into pid's hand, reshuffling the discard under the top card
// when the deck runs dry (both dry → you draw what exists)
function drawInto(s, pid, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!s.deck.length && s.discard.length > 1) {
      s.deck = shuffle(s.discard.slice(0, -1));
      s.discard = [topOf(s)];
    }
    if (!s.deck.length) break;
    const c = s.deck.shift();
    s.hands[pid] = [...s.hands[pid], c];
    got.push(c);
  }
  return got;
}

const clone = (s) => ({ ...s, deck: s.deck.slice(), discard: s.discard.slice(),
  hands: { [s.players[0]]: s.hands[s.players[0]].slice(), [s.players[1]]: s.hands[s.players[1]].slice() } });

/* play hand[idx]; wilds need chosen ("r"|"y"|"g"|"b"). null = illegal. */
export function play(state, pid, idx, chosen) {
  if (state.status !== "playing" || state.turn !== pid) return null;
  const card = state.hands[pid][idx];
  if (card == null) return null;
  if (!canPlay(card, topOf(state), state.color)) return null;
  if (isWild(card) && !COLORS.includes(chosen)) return null;
  const s = clone(state);
  const opp = oppOf(s, pid);
  s.hands[pid] = s.hands[pid].filter((_, i) => i !== idx);
  s.discard = [...s.discard, card];
  s.color = isWild(card) ? chosen : colorOf(card);
  s.drawn = null;
  const f = faceOf(card);
  let again = false, drew = 0;
  if (f === "S" || f === "R") again = true;
  else if (f === "D") { drew = drawInto(s, opp, 2).length; again = true; }
  else if (f === "W4") { drew = drawInto(s, opp, 4).length; again = true; }
  s.turn = again ? pid : opp;
  s.uno = s.hands[pid].length === 1 ? pid : (s.uno === pid ? null : s.uno);
  s.last = { by: pid, kind: f, card, drew, again };
  if (s.hands[pid].length === 0) { s.status = "won"; s.winner = pid; }
  return s;
}

/* draw one; a playable draw waits for playDrawn/keep, otherwise the turn
   passes on its own */
export function draw(state, pid) {
  if (state.status !== "playing" || state.turn !== pid || state.drawn) return null;
  const s = clone(state);
  const got = drawInto(s, pid, 1);
  if (!got.length) {                                 // nothing left anywhere: pass
    s.turn = oppOf(s, pid);
    s.last = { by: pid, kind: "pass" };
    return s;
  }
  const c = got[0];
  if (canPlay(c, topOf(s), s.color)) { s.drawn = c; s.last = { by: pid, kind: "draw" }; }
  else { s.turn = oppOf(s, pid); s.drawn = null; s.last = { by: pid, kind: "draw" }; }
  if (s.uno === pid) s.uno = null;                   // back above one card
  return s;
}

export function playDrawn(state, pid, chosen) {
  if (state.status !== "playing" || state.turn !== pid || !state.drawn) return null;
  const idx = state.hands[pid].lastIndexOf(state.drawn);
  if (idx < 0) return null;
  return play({ ...state, drawn: null }, pid, idx, chosen);
}

export function keep(state, pid) {
  if (state.status !== "playing" || state.turn !== pid || !state.drawn) return null;
  const s = clone(state);
  s.drawn = null;
  s.turn = oppOf(s, pid);
  s.last = { by: pid, kind: "keep" };
  return s;
}
