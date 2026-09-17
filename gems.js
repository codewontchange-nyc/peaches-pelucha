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

/* ---- codes ----------------------------------------------------------------
   "0".."6" colors · "S" stone (unmatchable, orphan it) · "B" bomb (blast on
   adjacent pop) · "*" star (clears the triggering color) · "C<n>" caged color
   (first pop frees it, second pops it) · "W" rainbow (shot-only wildcard). */
export const colorOf = (code) => {
  if (code == null) return null;
  if (code >= "0" && code <= "9") return code;
  if (code[0] === "C") return code.slice(1);
  return null;                                   // S, B, *, W, I, H, K
};

/* ---- procedural level MODIFIERS (physics + rules), rolled per level from
   their own RNG stream. Each is real: gravity and wind bend the flight in
   the engine itself (and therefore in the aim preview too). */
export const MODS = [
  { key: "lob",      min: 8,  label: "🌙 Moon lob" },     // shots arc under gravity
  { key: "walls",    min: 11, label: "🧱 Narrow sky" },   // inset walls, more bounces
  { key: "wind",     min: 13, label: "🌬 Crosswind" },    // lateral drift on shots
  { key: "pressure", min: 16, label: "⏬ Pressure" },     // ceiling descends faster
  { key: "fog",      min: 21, label: "🌫 Low clouds" },   // the aim line fades out early
];
function rollMods(seed, levelNo, gift) {
  const out = { list: [], phys: { grav: 0, wind: 0, inset: 0 }, fog: false, pressure: false };
  if (gift || levelNo < 8) return out;
  const rng = stream(seed, levelNo, "mods");
  const r0 = rng();
  const count = r0 < 0.42 ? 1 : r0 < 0.62 ? 2 : 0;
  const pool = MODS.filter((m) => levelNo >= m.min);
  for (let i = 0; i < count && pool.length; i++) {
    const m = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    if (m.key === "lob") out.phys.grav = 5 + Math.floor(rng() * 4);              // units/step²
    else if (m.key === "wind") out.phys.wind = (rng() < 0.5 ? -1 : 1) * (2 + Math.floor(rng() * 3));
    else if (m.key === "walls") out.phys.inset = 1300 + Math.floor(rng() * 800);
    else if (m.key === "fog") out.fog = true;
    else if (m.key === "pressure") out.pressure = true;
    out.list.push(m);
  }
  return out;
}

/* ---- difficulty curve ---------------------------------------------------- */
export function difficulty(levelNo) {
  const boss = levelNo >= 10 && levelNo % 10 === 0;      // ⛈ every 10th
  const gift = levelNo % 5 === 0 && !boss;
  const palette = gift ? 3 : Math.min(7, 4 + (levelNo >= 8 ? 1 : 0) + (levelNo >= 20 ? 1 : 0) + (levelNo >= 40 ? 1 : 0));
  const rowsInit = gift ? 2 : Math.min(7, 3 + Math.floor(levelNo / 3));
  // formation rotation — every level type reappears on a fixed cadence
  let formation = "rows";
  if (!gift && levelNo >= 6) {
    if (levelNo % 10 === 7 && levelNo >= 17) formation = "heart";
    else if (levelNo % 4 === 2 && levelNo >= 12) formation = "ring";
    else if (levelNo % 4 === 0 && levelNo >= 14) formation = "rope";
    else if (levelNo % 4 === 3 && levelNo >= 16) formation = "spiral";
    else if (levelNo % 3 === 0) formation = "blob";
  }
  const moveEvery = Math.max(3, 6 - Math.floor(levelNo / 10));   // misses per descend
  const shapeMode = !gift && levelNo >= 7 && levelNo % 7 === 0;  // match by SHAPE glyphs
  const stormy = !gift && levelNo >= 18 && levelNo % 9 === 0;    // the sky shoots back
  const specials = {
    stone: gift ? 0 : levelNo >= 9 ? 0.07 : 0,
    caged: gift ? 0 : levelNo >= 13 ? 0.06 : 0,
    bomb:  gift ? 0 : levelNo >= 11 ? 0.035 : 0,
    star:  gift ? 0 : levelNo >= 15 ? 0.02 : 0,
    ice:   gift ? 0 : levelNo >= 24 ? 0.05 : 0,   // 🧊 shatters on any adjacent pop
    heart: gift ? 0 : levelNo >= 26 ? 0.015 : 0,  // 💗 +500 when freed
    crown: gift ? 0 : levelNo >= 30 ? 0.02 : 0,   // 👑 clears its whole row
  };
  if (boss) return { palette: 5, rowsInit: 3, formation: "rows", moveEvery: 99, gift: false, boss,
    shapeMode: false, stormy: false, specials: { stone: 0, caged: 0, bomb: 0, star: 0, ice: 0, heart: 0, crown: 0 } };
  return { palette, rowsInit, formation, moveEvery, gift, boss: false, shapeMode, stormy, specials };
}

/* formation masks — pure functions of (r, c, rowsTotal) */
const HEART = [
  "011011000", "111111100", "111111100", "011111000", "001110000", "000100000",
];
function keepCell(formation, r, c, rowsTotal) {
  const nx = (cellX(r, c) - WUNITS / 2) / (WUNITS / 2);        // -1..1
  const ny = rowsTotal > 1 ? r / (rowsTotal - 1) : 0;          // 0..1
  if (formation === "blob") return nx * nx + ny * ny * 0.55 <= 0.92 || r === 0;
  if (formation === "ring") {
    const d = Math.sqrt(nx * nx + (ny - 0.5) * (ny - 0.5) * 2.6);
    return (d >= 0.34 && d <= 0.95) || r === 0;
  }
  if (formation === "spiral") {
    const ang = Math.atan2(ny - 0.45, nx);
    const d = Math.sqrt(nx * nx + (ny - 0.45) * (ny - 0.45) * 2.2);
    return ((ang + d * 5.2) % (Math.PI * 0.9) + Math.PI * 0.9) % (Math.PI * 0.9) < Math.PI * 0.52 || r === 0;
  }
  if (formation === "rope") return r <= 1 || c % 3 === 1;      // chains hang from a two-row canopy
  if (formation === "heart") {
    const row = HEART[Math.min(HEART.length - 1, r)];
    return r === 0 || row[Math.min(row.length - 1, c)] === "1";
  }
  return true;                                                  // rows
}

/* ---- level generation ----------------------------------------------------
   Colors cluster (a cell copies a placed neighbor's color 45% of the time) so
   boards read as formations, not confetti. Validated: row 0 always anchored. */
export function genLevel(seed, levelNo) {
  const d = difficulty(levelNo);
  const rng = stream(seed, levelNo, "board");
  const rowsTotal = d.formation === "rope" ? Math.min(7, d.rowsInit + 2) : d.rowsInit;
  // clustering rises with level (denser color runs keep deep boards fair);
  // rope chains cluster hard so every chain carries poppable runs
  const cluster = d.formation === "rope" ? 0.7 : Math.min(0.65, 0.45 + levelNo * 0.004);
  const rows = [];
  for (let r = 0; r < rowsTotal; r++) {
    const cols = colsIn(r);
    const row = new Array(cols).fill(null);
    for (let c = 0; c < cols; c++) {
      const keep = keepCell(d.formation, r, c, rowsTotal);
      const roll = rng();                        // ALWAYS consume — masks never shift the stream
      if (!keep && roll < 0.85) continue;
      let color = Math.floor(rng() * d.palette);
      if (rng() < cluster) {
        const nbs = neighbors(r, c).map(([rr, cc]) => colorOf(at(rows.concat([row]), rr, cc))).filter((v) => v != null);
        if (nbs.length) color = +nbs[Math.floor(rng() * nbs.length)];
      }
      row[c] = String(color);
    }
    rows.push(row);
  }
  // anchor: ensure at least the even columns of row 0 are filled
  for (let c = 0; c < colsIn(0); c++) if (rows[0][c] == null && (c % 2 === 0)) rows[0][c] = String(Math.floor(rng() * d.palette));
  // sprinkle specials (never on row 0, never breaking the anchor)
  const sp = d.specials;
  for (let r = 1; r < rows.length; r++) for (let c = 0; c < colsIn(r); c++) {
    const v = rows[r][c];
    if (v == null) continue;
    const roll = rng();
    let acc = sp.bomb;
    if (roll < acc) rows[r][c] = "B";
    else if (roll < (acc += sp.star)) rows[r][c] = "*";
    else if (roll < (acc += sp.stone)) rows[r][c] = "S";
    else if (roll < (acc += sp.caged)) rows[r][c] = "C" + v;
    else if (roll < (acc += sp.ice)) rows[r][c] = "I";
    else if (roll < (acc += sp.heart)) rows[r][c] = "H";
    else if (roll < (acc += sp.crown)) rows[r][c] = "K";
  }
  // a board that starts with orphans would drop gems on frame one — reattach
  findOrphans(rows).forEach(([r, c]) => { rows[r][c] = null; });
  const mods = rollMods(seed, levelNo, d.gift || d.boss);
  return { no: levelNo, seed, ...d, rows, mods };
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
  rows.forEach((row) => row.forEach((v) => { const c = colorOf(v); if (c != null) s.add(c); }));
  return s;
};
// draw the next PLAYABLE gem: absent colors advance deterministically; from
// level 10 an occasional 🌈 rainbow replaces the draw (pure hash — no stream)
function draw(run) {
  const present = colorsPresent(run.rows);
  if (!present.size) return { code: "0", bagIdx: run.bagIdx };
  let idx = run.bagIdx;
  for (let guard = 0; guard < 40; guard++) {
    const code = bagAt(run.seed, run.levelNo, run.palette, idx);
    idx++;
    if (present.has(code)) {
      if (run.levelNo >= 10 && hashStr(run.seed + ":w:" + run.levelNo + ":" + idx) % 19 === 0) return { code: "W", bagIdx: idx };
      return { code, bagIdx: idx };
    }
  }
  return { code: [...present][0], bagIdx: idx };
}

/* ---- run state ----------------------------------------------------------- */
export function newRun(seed, levelNo) {
  const level = genLevel(seed, levelNo);
  const run = {
    seed, levelNo, palette: level.palette,
    moveEvery: Math.max(2, level.moveEvery - (level.mods.pressure ? 2 : 0)),
    shapeMode: level.shapeMode, formation: level.formation, stormy: level.stormy, gift: level.gift,
    mods: level.mods.list.map((m) => m.label), phys: level.mods.phys, fog: level.mods.fog,
    rows: level.rows.map((r) => r.slice()),
    bagIdx: 0, cur: null, next: null, shotIdx: 0, misses: 0, drops: 0,
    combo: 0, score: 0, status: "playing",
  };
  // ⛈ boss levels: the storm itself is the enemy — HP, tantrums, weak windows
  if (level.boss) run.boss = { hp: 5 + Math.floor(levelNo / 10), maxHp: 5 + Math.floor(levelNo / 10), exposed: false, acts: 0 };
  let d = draw(run); run.cur = d.code; run.bagIdx = d.bagIdx;
  d = draw(run); run.next = d.code; run.bagIdx = d.bagIdx;
  return run;
}

/* ---- flight simulation ---------------------------------------------------
   Used by BOTH the aim preview and the resolve: the dotted line IS the flight.
   Returns { path: [{x,y}...] (bounce points + end), landing: {r,c} | null }. */
const q16 = (v) => Math.round(v * 65536) / 65536;
/* Velocity-integrated flight: gravity (lob levels) and wind (crosswind levels)
   bend the path; walls may be inset. Determinism holds because sin/cos are
   quantized ONCE and everything after is pure IEEE +/× on those values.
   The path records every wall bounce (renderer sparks) and dense samples so
   curved arcs draw smoothly. */
export function simulateFlight(rows, drops, angleMil, phys) {
  const p = phys || { grav: 0, wind: 0, inset: 0 };
  const a = Math.max(-1360, Math.min(1360, angleMil | 0)) / 1000;
  const step = R / 2;
  let vx = q16(Math.sin(a)) * step, vy = q16(-Math.cos(a)) * step;
  let x = WUNITS / 2, y = LAUNCH_Y;
  const yOff = drops * ROWH;                       // ceiling descent offset
  const wallL = R + (p.inset || 0), wallR = WUNITS - R - (p.inset || 0);
  const occ = [];
  rows.forEach((row, r) => row.forEach((v, c) => { if (v != null) occ.push([cellX(r, c), cellY(r) + yOff, r, c]); }));
  const path = [{ x, y }];
  const bounces = [];
  const hitDist2 = (2 * R - 120) * (2 * R - 120);
  const curved = (p.grav || 0) !== 0 || (p.wind || 0) !== 0;
  for (let i = 0; i < 900; i++) {
    vy += (p.grav || 0); vx += (p.wind || 0);
    x += vx; y += vy;
    if (x < wallL) { x = 2 * wallL - x; vx = -vx; path.push({ x: wallL, y }); bounces.push(path.length - 1); }
    else if (x > wallR) { x = 2 * wallR - x; vx = -vx; path.push({ x: wallR, y }); bounces.push(path.length - 1); }
    else if (curved && i % 4 === 0) path.push({ x, y });   // dense samples so arcs draw smoothly
    // a lobbed shot that arcs back down past the launcher is simply lost
    if (vy > 0 && y > LAUNCH_Y + R) { path.push({ x, y }); return { path, bounces, hit: null, landing: null }; }
    // ceiling
    if (y <= yOff + R) { y = yOff + R; path.push({ x, y }); return { path, bounces, hit: null, landing: snapCell(rows, x, y - yOff, null) }; }
    for (const [ox, oy, r, c] of occ) {
      const ddx = x - ox, ddy = y - oy;
      if (ddx * ddx + ddy * ddy < hitDist2) {
        path.push({ x, y });
        return { path, bounces, hit: [r, c], landing: snapCell(rows, x, y - yOff, [r, c]) };
      }
    }
  }
  path.push({ x, y });
  return { path, bounces, hit: null, landing: null };
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
  const start = colorOf(at(rows, r0, c0));
  if (start == null) return [];
  const seen = new Set([r0 + ":" + c0]), out = [[r0, c0]], stack = [[r0, c0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [rr, cc] of neighbors(r, c)) {
      const k = rr + ":" + cc;
      if (seen.has(k)) continue;
      if (colorOf(at(rows, rr, cc)) === start) { seen.add(k); out.push([rr, cc]); stack.push([rr, cc]); }
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
  if (run.mode === "duel") return applyDuelShot(run, action);
  if (run.status !== "playing") return { run, events: [] };
  const events = [];
  const next = { ...run, rows: run.rows.map((r) => r.slice()) };

  if (action.t === "swap") {
    const c = next.cur; next.cur = next.next; next.next = c;
    return { run: next, events: [{ t: "swap" }] };
  }
  if (action.t !== "shot") return { run, events: [] };

  // 🎯 AMMO pellet: doesn't stick — it DESTROYS the first thing it hits.
  // Bombs are defused (no blast), stones shatter, cages open empty; anything
  // cut loose falls for points. Costs no gem from the bag, ticks no miss,
  // feeds no swarm/boss/storm (shotIdx untouched keeps every stream aligned).
  // A pellet that hits nothing leaves the run untouched — not spent.
  if (action.ammo) {
    const flight = simulateFlight(next.rows, next.drops, action.a, next.phys);
    events.push({ t: "fly", path: flight.path, bounces: flight.bounces, code: "P" });
    if (!flight.hit) { events.push({ t: "zapmiss" }); return { run, events }; }
    const [zr, zc] = flight.hit;
    const zapped = next.rows[zr][zc];
    next.rows[zr][zc] = null;
    events.push({ t: "zap", r: zr, c: zc, code: zapped });
    const orphans = findOrphans(next.rows);
    if (orphans.length) {
      orphans.forEach(([r, c]) => { next.rows[r][c] = null; });
      const fp = orphans.length * 20;
      next.score += fp;
      events.push({ t: "fall", cells: orphans, pts: fp });
    }
    if (!next.rows.some((row) => row.some((v) => v != null))) {
      next.status = "cleared";
      next.score += 250;
      events.push({ t: "clear", score: next.score, clutch: false });
    }
    return { run: next, events };
  }

  // remember whether we were one breath from death — clearing from here is a CLUTCH
  let lowestBefore = -1;
  next.rows.forEach((row, r) => { if (row.some((v) => v != null)) lowestBefore = r; });
  next.clutchArmed = lowestBefore + next.drops >= DEAD_ROW - 2;

  const flight = simulateFlight(next.rows, next.drops, action.a, next.phys);
  events.push({ t: "fly", path: flight.path, bounces: flight.bounces, code: next.cur });
  const land = flight.landing;
  if (!land) { next.shotIdx++; return finishShot(next, events, false); }

  while (next.rows.length <= land.r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
  // 🌈 rainbow lands as whichever adjacent color makes the biggest group
  let placedCode = next.cur;
  if (placedCode === "W") {
    let best = null, bestN = -1;
    const tried = new Set();
    for (const [rr, cc] of neighbors(land.r, land.c)) {
      const col = colorOf(at(next.rows, rr, cc));
      if (col == null || tried.has(col)) continue;
      tried.add(col);
      next.rows[land.r][land.c] = col;
      const n = matchGroup(next.rows, land.r, land.c).length;
      next.rows[land.r][land.c] = null;
      if (n > bestN || (n === bestN && +col < +best)) { bestN = n; best = col; }
    }
    placedCode = best != null ? best : "0";
  }
  next.rows[land.r][land.c] = placedCode;
  events.push({ t: "place", r: land.r, c: land.c, code: placedCode });

  const group = matchGroup(next.rows, land.r, land.c);
  let popped = false;
  if (group.length >= 3) {
    popped = true;
    next.combo = Math.min(5, next.combo + 1);
    // caged gems in the group are FREED, not popped; the rest pop
    const freed = [], gone = [];
    for (const [r, c] of group) {
      const v = next.rows[r][c];
      if (v && v[0] === "C") { next.rows[r][c] = v.slice(1); freed.push([r, c]); }
      else { gone.push([r, c]); next.rows[r][c] = null; }
    }
    const pts = gone.length * 10 * next.combo;
    next.score += pts;
    if (freed.length) events.push({ t: "uncage", cells: freed });
    events.push({ t: "pop", cells: gone, pts });
    // trigger gems adjacent to the popped cells chain: 💥 bomb blasts its ring,
    // ⭐ star clears the trigger color, 🧊 ice shatters, 💗 heart pays big,
    // 👑 crown wipes its whole row
    const trigColor = colorOf(placedCode);
    const TRIGGERS = "B*IHK";
    const boomQueue = [];
    const scan = (cells) => cells.forEach(([r, c]) => neighbors(r, c).forEach(([rr, cc]) => {
      const v = at(next.rows, rr, cc);
      if (v != null && TRIGGERS.includes(v)) boomQueue.push([rr, cc, v]);
    }));
    scan(gone);
    const blasted = [];
    let heartPts = 0;
    const hearts = [];
    while (boomQueue.length) {
      const [br, bc, kind] = boomQueue.shift();
      if (at(next.rows, br, bc) == null) continue;
      next.rows[br][bc] = null;
      blasted.push([br, bc]);
      if (kind === "B") {
        for (const [rr, cc] of neighbors(br, bc)) {
          const v = at(next.rows, rr, cc);
          if (v == null) continue;
          if (TRIGGERS.includes(v)) { boomQueue.push([rr, cc, v]); continue; }
          next.rows[rr][cc] = null; blasted.push([rr, cc]);
        }
      } else if (kind === "*" && trigColor != null) {
        next.rows.forEach((row, rr) => row.forEach((v, cc) => {
          if (colorOf(v) === trigColor) {
            if (v && v[0] === "C") next.rows[rr][cc] = v.slice(1);
            else { next.rows[rr][cc] = null; blasted.push([rr, cc]); }
          }
        }));
      } else if (kind === "H") { heartPts += 500; hearts.push([br, bc]); }
      else if (kind === "K") {
        for (let cc = 0; cc < colsIn(br); cc++) {
          const v = next.rows[br][cc];
          if (v == null) continue;
          if (TRIGGERS.includes(v)) { boomQueue.push([br, cc, v]); continue; }
          next.rows[br][cc] = null; blasted.push([br, cc]);
        }
      }
      // "I" ice: shattering itself is the whole effect
    }
    if (blasted.length) {
      const bp = blasted.length * 15 * next.combo;
      next.score += bp;
      events.push({ t: "boom", cells: blasted, pts: bp });
    }
    if (hearts.length) {
      next.score += heartPts;
      events.push({ t: "heartpop", cells: hearts, pts: heartPts });
    }
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
  // ⛈ boss combat: pops wound the storm; big pops (and exposed windows) hurt more
  if (next.boss && popped) {
    const popSize = events.find((e) => e.t === "pop")?.cells.length || 0;
    let dmg = popSize >= 5 ? 2 : 1;
    if (next.boss.exposed) { dmg += 1; next.boss.exposed = false; }
    next.boss = { ...next.boss, hp: Math.max(0, next.boss.hp - dmg) };
    events.push({ t: "bossHit", dmg, hp: next.boss.hp });
    if (next.boss.hp <= 0) {
      // the storm breaks: everything left falls, big bonus, level cleared
      const rest = [];
      next.rows.forEach((row, r) => row.forEach((v, c) => { if (v != null) { rest.push([r, c]); next.rows[r][c] = null; } }));
      if (rest.length) events.push({ t: "fall", cells: rest, pts: 0 });
      next.score += 1500;
      events.push({ t: "bossDown", pts: 1500 });
    }
  }
  next.shotIdx++;
  // ⛈ the boss acts every 2nd shot: spits gems, stones your matches, or ROARS
  // (exposing its weak point — the next pop hits double)
  if (next.boss && next.boss.hp > 0 && next.status === "playing" && next.shotIdx % 2 === 0) bossAct(next, events);
  // 🐝 the LIVING SWARM: after every shot the formation fights back —
  // it grows new gems at its edges and crawls sideways in seeded-random
  // directions. All driven by shotIdx off the "swarm" stream: deterministic,
  // replayable, and the aim preview always sees the post-move board.
  if (next.status === "playing" && !next.boss) swarmMove(next, events);
  // ⛈ storm levels: the sky ALSO lobs a gem back every 4th shot
  if (next.stormy && next.status === "playing" && next.shotIdx % 4 === 0) stormShot(next, events);
  return finishShot(next, events, popped);
}

function bossAct(next, events) {
  const rng = stream(next.seed, next.levelNo, "boss");
  next.boss = { ...next.boss, acts: next.boss.acts + 1 };
  for (let i = 0; i < (next.boss.acts - 1) * 3; i++) rng();
  const draws = [rng(), rng(), rng()];
  if (next.boss.acts % 3 === 0) {
    // ROAR: the weak point opens — land a pop NOW for double damage
    next.boss = { ...next.boss, exposed: true };
    events.push({ t: "bossExposed" });
    return;
  }
  if (draws[0] < 0.6) {
    // spit a burst of gems onto the board
    const grown = [];
    for (let gI = 0; gI < 2; gI++) {
      const spots = [];
      next.rows.forEach((row, r) => row.forEach((v, c) => {
        if (v == null) return;
        for (const [rr, cc] of neighbors(r, c)) {
          if (rr < 0 || cc < 0 || cc >= colsIn(rr) || rr >= DEAD_ROW - 1) continue;
          const occ = rr < next.rows.length ? next.rows[rr][cc] : null;
          if (occ == null && !spots.some(([sr, sc]) => sr === rr && sc === cc)) spots.push([rr, cc]);
        }
      }));
      if (!spots.length) break;
      spots.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const [r, c] = spots[Math.floor(((gI ? draws[2] : draws[1])) * spots.length)];
      const code = String(Math.floor(((gI ? draws[1] : draws[2])) * next.palette));
      while (next.rows.length <= r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
      next.rows[r][c] = code;
      grown.push([r, c, code]);
    }
    if (grown.length) events.push({ t: "grow", cells: grown, boss: true });
  } else {
    // petrify: turn two colored gems to stone
    const colored = [];
    next.rows.forEach((row, r) => row.forEach((v, c) => { if (colorOf(v) != null && v[0] !== "C") colored.push([r, c]); }));
    const hits = [];
    for (let k = 0; k < 2 && colored.length; k++) {
      const idx = Math.floor(draws[1 + k] * colored.length);
      const [r, c] = colored.splice(idx, 1)[0];
      next.rows[r][c] = "S";
      hits.push([r, c]);
    }
    if (hits.length) events.push({ t: "bossShield", cells: hits });
  }
}

function swarmMove(next, events) {
  const rng = stream(next.seed, next.levelNo, "swarm");
  // advance the stream to this shot's slot (5 draws per shot, fixed budget)
  for (let i = 0; i < (next.shotIdx - 1) * 5; i++) rng();
  const draws = [rng(), rng(), rng(), rng(), rng()];
  // -- growth: +1 gem per shot (every 2nd shot below level 6; +2 from 22) --
  const growN = next.levelNo < 6 ? (next.shotIdx % 2 === 0 ? 1 : 0) : next.levelNo >= 22 ? 2 : 1;
  const grown = [];
  for (let gI = 0; gI < growN; gI++) {
    const spots = [];
    next.rows.forEach((row, r) => row.forEach((v, c) => {
      if (v == null) return;
      for (const [rr, cc] of neighbors(r, c)) {
        if (rr < 0 || cc < 0 || cc >= colsIn(rr) || rr >= DEAD_ROW - 1) continue;
        const occ = rr < next.rows.length ? next.rows[rr][cc] : null;
        if (occ == null && !spots.some(([sr, sc]) => sr === rr && sc === cc)) spots.push([rr, cc]);
      }
    }));
    if (!spots.length) break;
    spots.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const [r, c] = spots[Math.floor(draws[gI] * spots.length)];
    const code = String(Math.floor(draws[2 + gI] * next.palette));
    while (next.rows.length <= r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
    next.rows[r][c] = code;
    grown.push([r, c, code]);
  }
  if (grown.length) events.push({ t: "grow", cells: grown });
  // -- crawl: the whole formation slides one column left or right when room --
  const roll = draws[4];
  let dir = roll < 0.38 ? -1 : roll < 0.76 ? 1 : 0;
  const canShift = (d) => next.rows.every((row, r) => (d < 0 ? row[0] == null : row[colsIn(r) - 1] == null));
  if (dir !== 0 && !canShift(dir)) dir = canShift(-dir) ? -dir : 0;
  if (dir !== 0) {
    next.rows = next.rows.map((row) => {
      const out = row.slice();
      if (dir < 0) { out.shift(); out.push(null); }
      else { out.pop(); out.unshift(null); }
      return out;
    });
    events.push({ t: "drift", dir });
  }
}

// deterministic return fire: driven by shotIdx off the "junk" stream
function stormShot(next, events) {
  const rng = stream(next.seed, next.levelNo, "junk");
  const k = Math.floor(next.shotIdx / 4);
  let a = 0, b = 0;
  for (let i = 0; i < k; i++) { a = rng(); b = rng(); }
  const spots = [];
  next.rows.forEach((row, r) => row.forEach((v, c) => {
    if (v == null) return;
    for (const [rr, cc] of neighbors(r, c)) {
      if (rr < 0 || cc < 0 || cc >= colsIn(rr) || rr >= DEAD_ROW - 1) continue;
      const occ = rr < next.rows.length ? next.rows[rr][cc] : null;
      if (occ == null) spots.push([rr, cc]);
    }
  }));
  if (!spots.length) return;
  spots.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const [r, c] = spots[Math.floor(a * spots.length)];
  const code = String(Math.floor(b * next.palette));
  while (next.rows.length <= r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
  next.rows[r][c] = code;
  events.push({ t: "storm", r, c, code });
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
    // 🫀 CLUTCH: cleared from the brink of death
    const clutch = !!next.clutchArmed;
    if (clutch) next.score += 500;
    events.push({ t: "clear", score: next.score, clutch });
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
// ⚔️ online duel reconstruction: both phones derive the identical board by
// replaying the match's action log from its seed (applyShot routes by mode)
export function replayDuel(seed, actions) {
  let run = newDuelRun(seed >>> 0);
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

/* ============================== ⚔️ DUEL ==================================
   Pool-hall rules on ONE board, alternating shots. Player 0 is ALWAYS
   ● SOLIDS (codes 0,1,5), player 1 ◐ STRIPES (codes 2,3,4) — the UI decides
   which human is which. Offense: pop your own balls off the board. Defense:
   your balls stick where they land, walling the other side in. One 🎱
   EIGHT-BALL ("E") sits in the rack: whoever's shot knocks it out (popped
   loose OR dropped as an orphan) eats a -300 penalty. Win by emptying YOUR
   group; flooding the board on your turn loses it. */
export const WARM = ["0", "1", "5"];   // ● solids
export const COOL = ["2", "3", "4"];   // ◐ stripes
export const EIGHT = "E";
const groupOf = (p) => (p === 0 ? WARM : COOL);
const countGroup = (rows, group) => {
  let n = 0;
  rows.forEach((row) => row.forEach((v) => { const c = colorOf(v); if (c != null && group.includes(c)) n++; }));
  return n;
};
function duelDraw(run, p) {
  const group = groupOf(p);
  const present = colorsPresent(run.rows);
  const alive = group.filter((c) => present.has(c));
  if (!alive.length) return { code: group[0], bagIdx: run.bagIdx[p] };
  let idx = run.bagIdx[p];
  for (let guard = 0; guard < 40; guard++) {
    const gi = +bagAt(run.seed, "duel" + p, 3, idx);
    idx++;
    const code = group[gi];
    if (present.has(code)) return { code, bagIdx: idx };
  }
  return { code: alive[0], bagIdx: idx };
}
export function newDuelRun(seed) {
  const rng = stream(seed, "duel", "board");
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const cols = colsIn(r);
    const row = new Array(cols).fill(null);
    for (let c = 0; c < cols; c++) {
      let color = Math.floor(rng() * 6);
      if (rng() < 0.5) {
        const nbs = neighbors(r, c).map(([rr, cc]) => colorOf(at(rows.concat([row]), rr, cc))).filter((v) => v != null);
        if (nbs.length) color = +nbs[Math.floor(rng() * nbs.length)];
      }
      row[c] = String(color);
    }
    rows.push(row);
  }
  // 🎱 the eight-ball racks dead center — nobody wants to be the one to sink it
  rows[2][4] = EIGHT;
  const run = {
    mode: "duel", seed, levelNo: 1, palette: 6, rows, turn: 0,
    bagIdx: [0, 0], curs: [null, null], nexts: [null, null],
    cur: null, next: null, shotIdx: 0, misses: 0, drops: 0, moveEvery: 99,
    combo: 0, score: 0, scores: [0, 0], status: "playing", winner: null, ammo: [1, 1],
    shapeMode: false, formation: "duel", stormy: false, gift: false,
    mods: [], phys: { grav: 0, wind: 0, inset: 0 }, fog: false,
  };
  for (const p of [0, 1]) {
    let d = duelDraw(run, p); run.curs[p] = d.code; run.bagIdx = run.bagIdx.map((b, i) => (i === p ? d.bagIdx : b));
    d = duelDraw(run, p); run.nexts[p] = d.code; run.bagIdx = run.bagIdx.map((b, i) => (i === p ? d.bagIdx : b));
  }
  run.cur = run.curs[0]; run.next = run.nexts[0];
  return run;
}
function applyDuelShot(run, action) {
  if (run.status !== "playing") return { run, events: [] };
  const events = [];
  const p = run.turn;
  const next = { ...run, rows: run.rows.map((r) => r.slice()), bagIdx: run.bagIdx.slice(), curs: run.curs.slice(), nexts: run.nexts.slice(), scores: run.scores.slice() };

  if (action.t === "swap") {
    const c = next.curs[p]; next.curs[p] = next.nexts[p]; next.nexts[p] = c;
    next.cur = next.curs[p]; next.next = next.nexts[p];
    return { run: next, events: [{ t: "swap" }] };
  }
  if (action.t !== "shot") return { run, events: [] };

  // 🎯 each side packs ONE pellet per rack: it knocks out whatever ball it
  // hits — even the 🎱, penalty-free on a DIRECT hit (orphaning it is still
  // on you). The shooter keeps their held ball but the turn is spent; a
  // pellet that hits nothing spends neither.
  if (action.ammo && next.ammo[p] > 0) {
    const flight = simulateFlight(next.rows, next.drops, action.a, next.phys);
    events.push({ t: "fly", path: flight.path, bounces: flight.bounces, code: "P" });
    if (!flight.hit) { events.push({ t: "zapmiss" }); return { run, events }; }
    next.ammo = next.ammo.slice(); next.ammo[p]--;
    const [zr, zc] = flight.hit;
    const zapped = next.rows[zr][zc];
    next.rows[zr][zc] = null;
    events.push({ t: "zap", r: zr, c: zc, code: zapped });
    let eight = null;
    const orphans = findOrphans(next.rows);
    if (orphans.length) {
      const kept = [];
      for (const [r, c] of orphans) {
        if (next.rows[r][c] === EIGHT) { eight = [r, c]; next.rows[r][c] = null; continue; }
        kept.push([r, c]);
        next.rows[r][c] = null;
      }
      if (kept.length) {
        next.scores[p] += kept.length * 20;
        events.push({ t: "fall", cells: kept, pts: kept.length * 20 });
      }
    }
    if (eight) {
      next.scores[p] -= 300;
      events.push({ t: "eightball", by: p, r: eight[0], c: eight[1], pts: -300 });
    }
    const myLeft2 = countGroup(next.rows, groupOf(p));
    const theirLeft2 = countGroup(next.rows, groupOf(1 - p));
    if (myLeft2 === 0) { next.status = "duelend"; next.winner = p; events.push({ t: "duelend", winner: p }); return { run: next, events }; }
    if (theirLeft2 === 0) { next.status = "duelend"; next.winner = 1 - p; events.push({ t: "duelend", winner: 1 - p }); return { run: next, events }; }
    next.turn = 1 - p;
    next.cur = next.curs[next.turn]; next.next = next.nexts[next.turn];
    events.push({ t: "turn", turn: next.turn });
    return { run: next, events };
  }

  const flight = simulateFlight(next.rows, next.drops, action.a, next.phys);
  events.push({ t: "fly", path: flight.path, bounces: flight.bounces, code: next.curs[p] });
  const land = flight.landing;
  if (land) {
    while (next.rows.length <= land.r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
    next.rows[land.r][land.c] = next.curs[p];
    events.push({ t: "place", r: land.r, c: land.c, code: next.curs[p] });
    const group = matchGroup(next.rows, land.r, land.c);
    if (group.length >= 3) {
      group.forEach(([r, c]) => { next.rows[r][c] = null; });
      const pts = group.length * 10;
      next.scores[p] += pts;
      events.push({ t: "pop", cells: group, pts });
      // 🎱 a pop beside the eight-ball knocks it loose — shooter's fault
      let eight = null;
      for (const [r, c] of group) {
        for (const [rr, cc] of neighbors(r, c)) {
          if (at(next.rows, rr, cc) === EIGHT) { next.rows[rr][cc] = null; eight = [rr, cc]; }
        }
      }
      const orphans = findOrphans(next.rows);
      if (orphans.length) {
        const kept = [];
        for (const [r, c] of orphans) {
          if (next.rows[r][c] === EIGHT) { eight = [r, c]; next.rows[r][c] = null; continue; }
          kept.push([r, c]);
          next.rows[r][c] = null;
        }
        if (kept.length) {
          next.scores[p] += kept.length * 20;
          events.push({ t: "fall", cells: kept, pts: kept.length * 20 });
        }
      }
      if (eight) {
        next.scores[p] -= 300;
        events.push({ t: "eightball", by: p, r: eight[0], c: eight[1], pts: -300 });
      }
    }
  }
  next.shotIdx++;
  // pressure: a gem grows each shot, alternating warm/cool so neither side starves
  const rng = stream(next.seed, "duel", "grow");
  for (let i = 0; i < (next.shotIdx - 1) * 3; i++) rng();
  const draws = [rng(), rng(), rng()];
  const gGroup = next.shotIdx % 2 ? WARM : COOL;
  const spots = [];
  next.rows.forEach((row, r) => row.forEach((v, c) => {
    if (v == null) return;
    for (const [rr, cc] of neighbors(r, c)) {
      if (rr < 0 || cc < 0 || cc >= colsIn(rr) || rr >= DEAD_ROW - 1) continue;
      const occ = rr < next.rows.length ? next.rows[rr][cc] : null;
      if (occ == null && !spots.some(([sr, sc]) => sr === rr && sc === cc)) spots.push([rr, cc]);
    }
  }));
  if (spots.length) {
    spots.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [r, c] = spots[Math.floor(draws[0] * spots.length)];
    const code = gGroup[Math.floor(draws[1] * 3)];
    while (next.rows.length <= r) next.rows.push(new Array(colsIn(next.rows.length)).fill(null));
    next.rows[r][c] = code;
    events.push({ t: "grow", cells: [[r, c, code]] });
  }
  // outcomes: your colors gone = you win; flooding the lawn on your turn = you lose
  const myLeft = countGroup(next.rows, groupOf(p));
  const theirLeft = countGroup(next.rows, groupOf(1 - p));
  let lowest = -1;
  next.rows.forEach((row, r) => { if (row.some((v) => v != null)) lowest = r; });
  if (myLeft === 0) { next.status = "duelend"; next.winner = p; events.push({ t: "duelend", winner: p }); return { run: next, events }; }
  if (theirLeft === 0) { next.status = "duelend"; next.winner = 1 - p; events.push({ t: "duelend", winner: 1 - p }); return { run: next, events }; }
  if (lowest >= DEAD_ROW) { next.status = "duelend"; next.winner = 1 - p; events.push({ t: "duelend", winner: 1 - p, flooded: true }); return { run: next, events }; }
  // refresh the shooter's hand, then hand the sky to the other player
  next.curs[p] = next.nexts[p];
  const d = duelDraw(next, p);
  next.nexts[p] = d.code;
  next.bagIdx[p] = d.bagIdx;
  next.turn = 1 - p;
  next.cur = next.curs[next.turn]; next.next = next.nexts[next.turn];
  events.push({ t: "turn", turn: next.turn });
  return { run: next, events };
}
