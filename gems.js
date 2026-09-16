/* 💎 Gem Quest — the PURE engine (engine.js's arcade twin). Zero I/O, zero DOM.
   Everything a phone needs to agree with the other phone lives here:
   deterministic seeded levels, integer-quantized flight, synchronous shot
   resolution. The renderer (gemgame.js) only ANIMATES results computed here.

   Determinism contract:
   - all randomness flows from mulberry32(hashStr(seed:level:concern)) streams
     ("board" | "bag" | "junk" | "motion") — consuming one never shifts another
   - geometry is integer units (cell radius R=1000); aim angles are integer
     milliradians; direction vectors quantize to 1/65536 before any math
   - outcomes snap to grid cells; ties break (lowest row, lowest col)
   - the same (seed, level, actions[]) always replays to the same board/hash */

/* ---- RNG ---------------------------------------------------------------- */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const stream = (seed, levelNo, concern) => mulberry32(hashStr(seed + ":" + levelNo + ":" + concern));

/* ---- board geometry (odd-r offset, pointy packing) ---------------------- */
export const COLS_EVEN = 9, COLS_ODD = 8;
export const R = 1000;                       // cell radius, integer units
export const ROWH = 1732;                    // R * √3, rounded — row pitch
export const WUNITS = COLS_EVEN * 2 * R;     // world width = 18000
export const DEAD_ROW = 11;                  // occupied row at/past this = lost
export const LAUNCH_Y = (DEAD_ROW + 1.6) * ROWH; // launcher center y

export const colsIn = (r) => (r % 2 ? COLS_ODD : COLS_EVEN);
export const cellX = (r, c) => c * 2 * R + R + (r % 2 ? R : 0);
export const cellY = (r) => r * ROWH + R;

export function neighbors(r, c) {
  return (r % 2 === 0)
    ? [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]]
    : [[r, c - 1], [r, c + 1], [r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]];
}
const inBoard = (rows, r, c) => r >= 0 && r < rows.length && c >= 0 && c < colsIn(r);
const at = (rows, r, c) => (inBoard(rows, r, c) ? rows[r][c] : null);

/* ---- difficulty curve ---------------------------------------------------- */
export function difficulty(levelNo) {
  const gift = levelNo % 5 === 0;
  const palette = gift ? 3 : Math.min(7, 4 + (levelNo >= 8 ? 1 : 0) + (levelNo >= 20 ? 1 : 0) + (levelNo >= 40 ? 1 : 0));
  const rowsInit = gift ? 2 : Math.min(7, 3 + Math.floor(levelNo / 3));
  const formation = gift ? "rows" : levelNo < 6 ? "rows" : (levelNo % 3 === 0 ? "blob" : "rows");
  const moveEvery = Math.max(3, 6 - Math.floor(levelNo / 10));   // misses per descend
  return { palette, rowsInit, formation, moveEvery, gift };
}

/* ---- level generation ----------------------------------------------------
   Colors cluster (a cell copies a placed neighbor's color 45% of the time) so
   boards read as formations, not confetti. Validated: row 0 always anchored. */
export function genLevel(seed, levelNo) {
  const d = difficulty(levelNo);
  const rng = stream(seed, levelNo, "board");
  const rows = [];
  for (let r = 0; r < d.rowsInit; r++) {
    const cols = colsIn(r);
    const row = new Array(cols).fill(null);
    for (let c = 0; c < cols; c++) {
      if (d.formation === "blob") {
        // elliptical mask around the board's top-center
        const nx = (cellX(r, c) - WUNITS / 2) / (WUNITS / 2);
        const ny = r / d.rowsInit;
        if (nx * nx + ny * ny * 0.55 > 0.92 && r > 0) { if (rng() < 0.7) continue; }
      }
      let color = Math.floor(rng() * d.palette);
      if (rng() < 0.45) {
        const nbs = neighbors(r, c).map(([rr, cc]) => at(rows.concat([row]), rr, cc)).filter((v) => v != null);
        if (nbs.length) color = +nbs[Math.floor(rng() * nbs.length)];
      }
      row[c] = String(color);
    }
    rows.push(row);
  }
  // anchor: any row-0 hole is fine, but ensure at least 60% of row 0 is filled
  for (let c = 0; c < colsIn(0); c++) if (rows[0][c] == null && (c % 2 === 0)) rows[0][c] = String(Math.floor(rng() * d.palette));
  return { no: levelNo, seed, ...d, rows };
}

/* ---- the gem bag (deterministic draw sequence) --------------------------- */
function bagAt(seed, levelNo, palette, idx) {
  // bag k = shuffle([each color ×2]) with the "bag" stream advanced k refills
  const size = palette * 2;
  const refill = Math.floor(idx / size);
  const rng = stream(seed, levelNo, "bag");
  let bag = [];
  for (let k = 0; k <= refill; k++) {
    bag = [];
    for (let i = 0; i < palette; i++) bag.push(String(i), String(i));
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  }
  return bag[idx % size];
}
const colorsPresent = (rows) => {
  const s = new Set();
  rows.forEach((row) => row.forEach((v) => { if (v != null && v >= "0" && v <= "9") s.add(v); }));
  return s;
};
// draw the next PLAYABLE gem: absent colors advance deterministically
function draw(run) {
  const present = colorsPresent(run.rows);
  if (!present.size) return { code: "0", bagIdx: run.bagIdx };
  let idx = run.bagIdx;
  for (let guard = 0; guard < 40; guard++) {
    const code = bagAt(run.seed, run.levelNo, run.palette, idx);
    idx++;
    if (present.has(code)) return { code, bagIdx: idx };
  }
  return { code: [...present][0], bagIdx: idx };
}

/* ---- run state ----------------------------------------------------------- */
export function newRun(seed, levelNo) {
  const level = genLevel(seed, levelNo);
  const run = {
    seed, levelNo, palette: level.palette, moveEvery: level.moveEvery,
    rows: level.rows.map((r) => r.slice()),
    bagIdx: 0, cur: null, next: null, shotIdx: 0, misses: 0, drops: 0,
    combo: 0, score: 0, status: "playing",
  };
  let d = draw(run); run.cur = d.code; run.bagIdx = d.bagIdx;
  d = draw(run); run.next = d.code; run.bagIdx = d.bagIdx;
  return run;
}

/* ---- flight simulation ---------------------------------------------------
   Used by BOTH the aim preview and the resolve: the dotted line IS the flight.
   Returns { path: [{x,y}...] (bounce points + end), landing: {r,c} | null }. */
const q16 = (v) => Math.round(v * 65536) / 65536;
export function simulateFlight(rows, drops, angleMil) {
  const a = Math.max(-1360, Math.min(1360, angleMil | 0)) / 1000;
  let dx = q16(Math.sin(a)), dy = q16(-Math.cos(a));
  let x = WUNITS / 2, y = LAUNCH_Y;
  const yOff = drops * ROWH;                       // ceiling descent offset
  const occ = [];
  rows.forEach((row, r) => row.forEach((v, c) => { if (v != null) occ.push([cellX(r, c), cellY(r) + yOff, r, c]); }));
  const path = [{ x, y }];
  const step = R / 2;
  const hitDist2 = (2 * R - 120) * (2 * R - 120);
  for (let i = 0; i < 600; i++) {
    x += dx * step; y += dy * step;
    if (x < R) { x = 2 * R - x; dx = -dx; path.push({ x: R, y }); }
    else if (x > WUNITS - R) { x = 2 * (WUNITS - R) - x; dx = -dx; path.push({ x: WUNITS - R, y }); }
    // ceiling
    if (y <= yOff + R) { y = yOff + R; path.push({ x, y }); return { path, landing: snapCell(rows, x, y - yOff, null) }; }
    for (const [ox, oy, r, c] of occ) {
      const ddx = x - ox, ddy = y - oy;
      if (ddx * ddx + ddy * ddy < hitDist2) {
        path.push({ x, y });
        return { path, landing: snapCell(rows, x, y - yOff, [r, c]) };
      }
    }
  }
  path.push({ x, y });
  return { path, landing: null };
}

// nearest empty valid cell to (x, y in board space); prefer neighbors of the
// hit cell; ties break lowest row then lowest col
export function snapCell(rows, x, y, hit) {
  const cand = new Map();
  const consider = (r, c) => {
    if (r < 0 || c < 0 || c >= colsIn(r)) return;
    if (r >= rows.length + 4) return;
    if (at(rows, r, c) != null) return;
    cand.set(r + ":" + c, [r, c]);
  };
  if (hit) neighbors(hit[0], hit[1]).forEach(([r, c]) => consider(r, c));
  else { const c0 = Math.max(0, Math.min(colsIn(0) - 1, Math.round((x - R) / (2 * R)))); consider(0, c0); consider(0, c0 - 1); consider(0, c0 + 1); }
  if (!cand.size) {
    // fallback: nearest empty anywhere in reach
    for (let r = 0; r < rows.length + 2; r++) for (let c = 0; c < colsIn(r); c++) consider(r, c);
  }
  let best = null, bd = Infinity;
  for (const [, [r, c]] of cand) {
    const dxx = cellX(r, c) - x, dyy = cellY(r) - y;
    const d2 = dxx * dxx + dyy * dyy;
    if (d2 < bd - 1 || (Math.abs(d2 - bd) <= 1 && best && (r < best[0] || (r === best[0] && c < best[1])))) { bd = d2; best = [r, c]; }
  }
  return best ? { r: best[0], c: best[1] } : null;
}

/* ---- matching / orphans -------------------------------------------------- */
export function matchGroup(rows, r0, c0) {
  const start = at(rows, r0, c0);
  if (start == null) return [];
  const seen = new Set([r0 + ":" + c0]), out = [[r0, c0]], stack = [[r0, c0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [rr, cc] of neighbors(r, c)) {
      const k = rr + ":" + cc;
      if (seen.has(k)) continue;
      if (at(rows, rr, cc) === start) { seen.add(k); out.push([rr, cc]); stack.push([rr, cc]); }
    }
  }
  return out;
}
export function findOrphans(rows) {
  const anchored = new Set(); const stack = [];
  for (let c = 0; c < colsIn(0); c++) if (rows[0][c] != null) { anchored.add("0:" + c); stack.push([0, c]); }
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [rr, cc] of neighbors(r, c)) {
      const k = rr + ":" + cc;
      if (anchored.has(k)) continue;
      if (at(rows, rr, cc) != null) { anchored.add(k); stack.push([rr, cc]); }
    }
  }
  const orphans = [];
  rows.forEach((row, r) => row.forEach((v, c) => { if (v != null && !anchored.has(r + ":" + c)) orphans.push([r, c]); }));
  return orphans;
}

/* ---- shot resolution ------------------------------------------------------
   Synchronous + total: returns the new run and an ordered event list the
   renderer plays back. Board mutations all happen HERE. */
export function applyShot(run, action) {
  if (run.status !== "playing") return { run, events: [] };
  const events = [];
  const next = { ...run, rows: run.rows.map((r) => r.slice()) };

  if (action.t === "swap") {
    const c = next.cur; next.cur = next.next; next.next = c;
    return { run: next, events: [{ t: "swap" }] };
  }
  if (action.t !== "shot") return { run, events: [] };

  const flight = simulateFlight(next.rows, next.drops, action.a);
  events.push({ t: "fly", path: flight.path, code: next.cur });
  const land = flight.landing;
  if (!land) { next.shotIdx++; return finishShot(next, events, false); }

  while (next.rows.length <= land.r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
  next.rows[land.r][land.c] = next.cur;
  events.push({ t: "place", r: land.r, c: land.c, code: next.cur });

  const group = matchGroup(next.rows, land.r, land.c);
  let popped = false;
  if (group.length >= 3) {
    popped = true;
    group.forEach(([r, c]) => { next.rows[r][c] = null; });
    next.combo = Math.min(5, next.combo + 1);
    const pts = group.length * 10 * next.combo;
    next.score += pts;
    events.push({ t: "pop", cells: group, pts });
    const orphans = findOrphans(next.rows);
    if (orphans.length) {
      orphans.forEach(([r, c]) => { next.rows[r][c] = null; });
      const fp = orphans.length * 20 * next.combo;
      next.score += fp;
      events.push({ t: "fall", cells: orphans, pts: fp });
    }
  } else {
    next.combo = 0;
  }
  next.shotIdx++;
  return finishShot(next, events, popped);
}

function finishShot(next, events, popped) {
  if (!popped) {
    next.misses++;
    if (next.misses >= next.moveEvery) {
      next.misses = 0; next.drops++;
      events.push({ t: "descend", drops: next.drops });
    }
  }
  // cleared?
  const anyLeft = next.rows.some((row) => row.some((v) => v != null));
  if (!anyLeft) {
    next.status = "cleared";
    next.score += 250;
    events.push({ t: "clear", score: next.score });
    return { run: next, events };
  }
  // dead? lowest occupied row (plus descent) reaching the lawn
  let lowest = -1;
  next.rows.forEach((row, r) => { if (row.some((v) => v != null)) lowest = r; });
  if (lowest + next.drops >= DEAD_ROW) {
    next.status = "dead";
    events.push({ t: "dead" });
    return { run: next, events };
  }
  // advance the bag
  next.cur = next.next;
  const d = draw(next); next.next = d.code; next.bagIdx = d.bagIdx;
  events.push({ t: "next", cur: next.cur, next: next.next });
  return { run: next, events };
}

/* ---- replay + hash (co-op reconstruction, desync tripwire) --------------- */
export function replay(seed, levelNo, actions) {
  let run = newRun(seed, levelNo);
  for (const a of actions) run = applyShot(run, a).run;
  return run;
}
export function boardHash(run) {
  let h = 2166136261 >>> 0;
  const eat = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  run.rows.forEach((row, r) => row.forEach((v, c) => { if (v != null) eat(r + "," + c + "=" + v + ";"); }));
  eat("|" + run.drops + "|" + run.score + "|" + run.bagIdx + "|" + run.status);
  return h >>> 0;
}
