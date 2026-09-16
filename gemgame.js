import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as G from "./gems.js";
import { GemMap } from "./gemmap.js";

const html = htm.bind(h);

/* 💎 Gem Quest — canvas renderer + input + Game Room card. The engine
   (gems.js) resolves every shot synchronously; this file only ANIMATES the
   precomputed result — so backgrounding, watchdogs, and (later) netcode can
   always jump straight to the known final board.
   Storybook-sky theme: transparent canvas over a CSS sky, the player's own
   emoji as the shooter on the lawn. */

/* gems are pure EMOJI with a soft shadow — no chrome. Each level picks one of
   several THEMES (deterministically from the seed, so both phones see the
   same set) so you're never staring at the same seven emoji every game.
   Hues drive the pop particles, matched per theme slot. */
const THEMES = [
  { name: "hearts",   emoji: ["❤️", "💛", "💚", "💙", "💜", "🧡", "🤎"],
    hues: ["#e0245e", "#ffd166", "#39b54a", "#4a90e2", "#9b59b6", "#ff8c42", "#8d6e63"] },
  { name: "fruits",   emoji: ["🍓", "🍋", "🍏", "🫐", "🍇", "🍑", "🥥"],
    hues: ["#e8617a", "#ffd166", "#7fb069", "#5aa7d6", "#c4a6ff", "#ff9e7d", "#a9826b"] },
  { name: "critters", emoji: ["🐞", "🐝", "🐸", "🦋", "🐙", "🦊", "🐻"],
    hues: ["#e8434a", "#ffcf3f", "#5fb85f", "#58a7e0", "#9b6bd6", "#f28c3a", "#a9826b"] },
  { name: "treats",   emoji: ["🍒", "🧀", "🥦", "🍙", "🍆", "🥕", "🍩"],
    hues: ["#d94352", "#f4c542", "#6ab04c", "#cfd8dc", "#7d4fb0", "#f39c4f", "#b5651d"] },
];
const SHAPEMOJI = ["⭐", "🌙", "☁️", "🌸", "⚡", "🍄", "🎈"];
const SHAPE_HUES = ["#ffd166", "#c4a6ff", "#cfe7f5", "#ffb4c8", "#f4c542", "#e8434a", "#e8617a"];
/* duel = pool balls: player 0 shoots ● SOLIDS, player 1 ◐ STRIPES, and the
   🎱 eight-ball ("E") is the shared hazard */
const POOL = {
  "0": { n: 1, hue: "#f4c542", stripe: false },
  "1": { n: 3, hue: "#d94352", stripe: false },
  "5": { n: 4, hue: "#7d4fb0", stripe: false },
  "2": { n: 10, hue: "#4a90e2", stripe: true },
  "3": { n: 13, hue: "#f28c3a", stripe: true },
  "4": { n: 14, hue: "#39b54a", stripe: true },
  "E": { n: 8, hue: "#26262b", stripe: false },
};
const themeFor = (seed, levelNo) => THEMES[G.hashStr(seed + ":theme:" + levelNo) % THEMES.length];
const JOURNEY_SEED = "gq1";

/* ---- 🔊 sound: a tiny synthesizer, no assets. Pops play an ascending
   pentatonic run with your combo (the Peggle trick); everything else is short
   plucks and noise taps. Muted state persists; AudioContext resumes lazily on
   the first real gesture (iOS rule). ---- */
const PENT = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0, 880.0];
const snd = {
  ctx: null, muted: (() => { try { return localStorage.getItem("pp.gq.mute") === "1"; } catch { return false; } })(),
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return this.ctx; },
  tone(freq, dur = 0.18, type = "sine", vol = 0.16, when = 0) {
    const ctx = this.muted ? null : this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g2).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  noise(dur = 0.12, vol = 0.1, when = 0, freq = 900, type = "lowpass") {
    const ctx = this.muted ? null : this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g2 = ctx.createGain(); g2.gain.value = vol;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    src.connect(f).connect(g2).connect(ctx.destination);
    src.start(t0);
  },
  // 🎱 pool acoustics via MODAL synthesis: a resin ball click is a handful of
  // pure high partials dying in ~40ms — no noise (noise = static = annoying).
  // Everything short, quiet, and round.
  clack(vol = 0.13, when = 0) {
    [[2600, 0.5], [3950, 0.3], [5300, 0.18]].forEach(([f, a]) => this.tone(f, 0.045, "sine", vol * a, when));
    this.tone(165, 0.035, "sine", vol * 0.7, when);       // the body of the hit
  },
  cushion() { this.tone(110, 0.08, "sine", 0.1); },       // one soft felt thump
  pocket(n = 3) {
    this.clack(0.11);
    if (n >= 4) this.clack(0.07, 0.09);                   // big drops get one echo, not a rattle
    this.tone(78, 0.2, "sine", 0.1, 0.05);                // roll into the pocket
  },
  pop(combo, size) { const base = Math.min(PENT.length - 1, (combo - 1) * 2); this.tone(PENT[base], 0.2, "triangle", 0.18); if (size >= 5) this.tone(PENT[Math.min(PENT.length - 1, base + 2)], 0.24, "triangle", 0.14, 0.06); },
  thunk() { this.tone(120, 0.09, "sine", 0.12); },
  bounce() { this.tone(660, 0.05, "square", 0.05); },
  boom() { this.noise(0.3, 0.22); this.tone(70, 0.3, "sine", 0.2); },
  fall() { this.tone(392, 0.1, "sine", 0.07); this.tone(293, 0.12, "sine", 0.07, 0.07); },
  fever() { [0, 1, 2, 3].forEach((i) => this.tone(PENT[4 + i], 0.14, "triangle", 0.14, i * 0.07)); },
  clear() { [0, 2, 4, 7].forEach((s2, i) => this.tone(PENT[s2], 0.3, "triangle", 0.16, i * 0.1)); },
  clutch() { this.tone(196, 0.5, "sawtooth", 0.1); [4, 7, 9].forEach((s2, i) => this.tone(PENT[s2], 0.4, "triangle", 0.18, 0.18 + i * 0.12)); },
  bossHit() { this.noise(0.16, 0.18); this.tone(150, 0.2, "square", 0.12); },
  bossRoar() { this.tone(90, 0.7, "sawtooth", 0.16); this.tone(96, 0.7, "sawtooth", 0.12, 0.05); },
  bossDown() { this.noise(0.5, 0.25); [0, 4, 7, 9].forEach((s2, i) => this.tone(PENT[s2], 0.5, "triangle", 0.18, 0.25 + i * 0.12)); },
  dead() { this.tone(196, 0.4, "sine", 0.14); this.tone(146, 0.6, "sine", 0.14, 0.25); },
};

/* ---- sprites: bare emoji + soft drop shadow, pre-rendered (hot loop =
   drawImage; the shadow costs once at sprite build, never per frame) */
function makeSprites(px, themeEmoji) {
  const mk = (paint) => { const c = document.createElement("canvas"); c.width = c.height = px; paint(c.getContext("2d"), px / 2); return c; };
  const glyph = (emoji) => mk((g, r) => {
    g.shadowColor = "rgba(43,37,33,.32)";
    g.shadowBlur = px * 0.09;
    g.shadowOffsetY = px * 0.055;
    g.font = `${Math.round(px * 0.82)}px system-ui`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, r, r * 1.08);
  });
  const colors = themeEmoji.map(glyph);
  const shapes = SHAPEMOJI.map(glyph);
  const cage = mk((g, r) => {
    g.strokeStyle = "rgba(43,37,33,.6)"; g.lineWidth = Math.max(2, px * 0.05); g.lineCap = "round";
    for (let i = -2; i <= 2; i++) { const x = r + i * r * 0.42; g.beginPath(); g.moveTo(x, r * 0.3); g.lineTo(x, px - r * 0.3); g.stroke(); }
  });
  // classic drawn pool balls for duel: colored base (or white with a colored
  // stripe band), white number circle, rim, shine — the 🎱 is black
  const poolBall = (spec) => mk((g, r) => {
    g.shadowColor = "rgba(43,37,33,.3)"; g.shadowBlur = px * 0.07; g.shadowOffsetY = px * 0.045;
    g.beginPath(); g.arc(r, r, r * 0.92, 0, Math.PI * 2);
    g.fillStyle = spec.stripe ? "#fdfaf4" : spec.hue; g.fill();
    g.shadowColor = "transparent";
    if (spec.stripe) {
      g.save(); g.beginPath(); g.arc(r, r, r * 0.92, 0, Math.PI * 2); g.clip();
      g.fillStyle = spec.hue; g.fillRect(0, r * 0.52, px, r * 0.96);
      g.restore();
    }
    g.lineWidth = Math.max(1.5, px * 0.035); g.strokeStyle = "rgba(38,32,28,.55)";
    g.beginPath(); g.arc(r, r, r * 0.92, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(r, r, r * 0.4, 0, Math.PI * 2); g.fillStyle = "#fdfaf4"; g.fill();
    g.fillStyle = "#26262b";
    g.font = `800 ${Math.round(r * 0.5)}px Inter, system-ui`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(spec.n), r, r * 1.03);
    g.beginPath(); g.arc(r * 0.68, r * 0.6, r * 0.16, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,.8)"; g.fill();
  });
  const pool = {};
  for (const code of Object.keys(POOL)) pool[code] = poolBall(POOL[code]);
  return {
    colors, shapes, cage, pool,
    stone: glyph("🪨"), bomb: glyph("💣"), star: glyph("⭐"), rainbow: glyph("🌈"),
    ice: glyph("🧊"), heart: glyph("💗"), crown: glyph("👑"),
  };
}

/* ================= the playable surface (gamefs) ======================== */
function GemPlay({ me, startLevel, onExit, onCleared, duel }) {
  const [levelNo, setLevelNo] = useState(startLevel || 1);
  const [phase, setPhase] = useState("play");        // play | cleared | dead | duelend
  const [hud, setHud] = useState(null);              // {score, misses, moveEvery, cur, next, stars, warmLeft, coolLeft}
  const wrapRef = useRef(null), cvRef = useRef(null);
  const S = useRef(null);                            // ALL mutable game state (never re-render per frame)

  const [intro, setIntro] = useState(null);          // level intro card {title, sub}
  const [combo, setCombo] = useState(0);
  const [fever, setFever] = useState(false);
  const [bossUi, setBossUi] = useState(null);        // {hp, maxHp, exposed, hitN}
  const [turn, setTurn] = useState(0);               // duel: whose sky it is
  const [muted, setMuted] = useState(snd.muted);
  const duelCounts = (rows) => ({
    warmLeft: rows.flat().filter((v) => G.colorOf(v) != null && G.WARM.includes(G.colorOf(v))).length,
    coolLeft: rows.flat().filter((v) => G.colorOf(v) != null && G.COOL.includes(G.colorOf(v))).length,
  });
  const boot = useCallback((lvl) => {
    const run = duel ? G.newDuelRun(lvl) : G.newRun(JOURNEY_SEED, lvl);
    S.current = {
      run, theme: duel ? THEMES[0] : themeFor(JOURNEY_SEED, lvl),   // duel = colored hearts: 🔥❤️💛🧡 vs ❄️💚💙💜
      display: run.rows.map((r) => r.slice()), drops: run.drops,
      queue: [], pending: null, anim: null, particles: [], falling: [],
      trail: [], popups: [], jiggles: [], shake: 0, recoil: 0, slowUntil: 0,
      aim: null, raf: 0, last: 0, watchdog: 0, sprites: null, scale: 1, offX: 0, dpr: 1,
      shotsUsed: 0, par: Math.round(run.rows.flat().filter((v) => v != null).length * 0.6) + 8,
    };
    setHud({ score: 0, misses: 0, moveEvery: run.moveEvery, cur: run.cur, next: run.next, ...(duel ? duelCounts(run.rows) : {}) });
    setCombo(0); setFever(false); setTurn(0);
    setBossUi(run.boss ? { hp: run.boss.hp, maxHp: run.boss.maxHp, exposed: false, hitN: 0 } : null);
    setPhase("play");
    const FORM = { rows: "", blob: "☁️ Cloudbank", ring: "⭕ The Ring", rope: "⛓ Hanging Chains", spiral: "🌀 The Spiral", heart: "💞 Heart of the Sky" };
    const bits = duel ? ["● solids vs ◐ stripes — clear YOURS first, don't sink the 🎱"]
      : [run.boss ? "⛈ BOSS: wound the storm with pops!" : FORM[run.formation], run.shapeMode ? "🔷 Shape match" : "", run.stormy ? "⛈ The sky shoots back" : "", run.gift ? "🎁 Gift level" : "", ...run.mods].filter(Boolean);
    setIntro({ title: duel ? "Gem Duel ⚔️" : `Level ${lvl}`, sub: bits.join(" · ") || "clear the sky" });
    setTimeout(() => setIntro(null), 1900);
  }, [duel]);
  useEffect(() => { boot(duel ? ((Math.random() * 4294967296) >>> 0) : levelNo); }, []);   // eslint-disable-line

  /* ---- canvas sizing + sprites ---- */
  const fit = useCallback(() => {
    const wrap = wrapRef.current, cv = cvRef.current, st = S.current;
    if (!wrap || !cv || !st) return;
    const cw = wrap.clientWidth, chh = wrap.clientHeight;
    const WORLDH = G.LAUNCH_Y + 2.2 * G.R;
    const s = Math.min(cw / G.WUNITS, chh / WORLDH);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr);
    cv.style.width = cw + "px"; cv.style.height = chh + "px";
    st.scale = s; st.dpr = dpr; st.offX = (cw - G.WUNITS * s) / 2;
    st.sprites = makeSprites(Math.max(24, Math.round(2 * G.R * s * dpr)), st.theme.emoji);
    draw();
  }, []);
  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  /* ---- drawing (world units through one transform) ---- */
  const draw = useCallback(() => {
    const st = S.current, cv = cvRef.current;
    if (!st || !cv) return;
    const g = cv.getContext("2d");
    const { scale: s, dpr, offX } = st;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    // screen shake lives INSIDE the canvas transform (never on DOM ancestors)
    const shx = st.shake > 0 ? (Math.random() - 0.5) * st.shake * G.R * 0.06 : 0;
    const shy = st.shake > 0 ? (Math.random() - 0.5) * st.shake * G.R * 0.06 : 0;
    g.setTransform(s * dpr, 0, 0, s * dpr, (offX + shx * s) * dpr, shy * s * dpr);
    const yOff = st.drops * G.ROWH;
    const phys = st.run.phys || {};
    // inset hedge walls on narrow-sky levels
    if (phys.inset) {
      g.fillStyle = "rgba(127,176,105,.5)";
      g.fillRect(0, 0, phys.inset + G.R * 0.4, G.LAUNCH_Y - G.R);
      g.fillRect(G.WUNITS - phys.inset - G.R * 0.4, 0, phys.inset + G.R * 0.4, G.LAUNCH_Y - G.R);
    }
    const sp = st.sprites;
    const shapeMode = st.run.shapeMode;
    const sprite = (code) => {
      if (st.run.mode === "duel") return sp.pool[code] || sp.pool["0"];
      if (code === "S") return sp.stone;
      if (code === "B") return sp.bomb;
      if (code === "*") return sp.star;
      if (code === "W") return sp.rainbow;
      if (code === "I") return sp.ice;
      if (code === "H") return sp.heart;
      if (code === "K") return sp.crown;
      const col = +(code[0] === "C" ? code.slice(1) : code) % sp.colors.length;
      return (shapeMode ? sp.shapes : sp.colors)[col];
    };
    const px = 2 * G.R;

    // descended-ceiling fringe
    if (st.drops > 0) {
      g.fillStyle = "rgba(217,161,115,.35)";
      g.fillRect(0, 0, G.WUNITS, yOff);
      g.fillStyle = "rgba(138,90,68,.5)";
      g.fillRect(0, yOff - 60, G.WUNITS, 60);
    }
    // board (caged gems wear the bars overlay; freshly-hit neighbors jiggle;
    // a crawling swarm slides in from its pre-drift position)
    const driftDX = st.driftFx ? -st.driftFx.dir * 2 * G.R * (1 - st.driftFx.t / st.driftFx.dur) : 0;
    st.display.forEach((row, r) => row.forEach((v, c) => {
      if (v == null) return;
      let jx = 0, jy = 0;
      for (const j of st.jiggles) if (j.r === r && j.c === c) {
        const k = 1 - j.t / 260;
        jx = Math.sin(j.t / 22) * G.R * 0.14 * k; jy = Math.cos(j.t / 30) * G.R * 0.1 * k;
      }
      const x = G.cellX(r, c) - G.R + jx + driftDX, y = G.cellY(r) + yOff - G.R + jy;
      g.drawImage(sprite(v), x, y, px, px);
      if (v[0] === "C") g.drawImage(sp.cage, x, y, px, px);
    }));
    // storm gem dropping in
    if (st.anim && st.anim.storm) { const s2 = st.anim.storm; g.drawImage(sprite(s2.code), s2.x - G.R, s2.y - G.R, px, px); }
    // falling gems
    for (const f of st.falling) g.drawImage(sprite(f.code), f.x - G.R, f.y - G.R, px, px);
    // aim preview: the dotted line IS the flight (same simulate, same physics);
    // fog levels fade the line out early — that's the whole gimmick
    if (st.aim != null && phaseRef.current === "play" && !st.anim) {
      const fl = G.simulateFlight(st.run.rows, st.run.drops, st.aim, phys);
      const pts = st.run.fog ? fl.path.slice(0, Math.max(3, Math.ceil(fl.path.length * 0.35))) : fl.path;
      g.setLineDash([160, 260]); g.lineWidth = 90;
      g.strokeStyle = "rgba(138,90,68,.55)";
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke(); g.setLineDash([]);
      if (fl.landing && !st.run.fog) {
        g.beginPath(); g.arc(G.cellX(fl.landing.r, fl.landing.c), G.cellY(fl.landing.r) + yOff, G.R * 0.5, 0, Math.PI * 2);
        g.strokeStyle = "rgba(138,90,68,.4)"; g.lineWidth = 70; g.stroke();
      }
      // crosswind streamers so the drift reads at a glance
      if (phys.wind) {
        g.strokeStyle = "rgba(90,167,214,.5)"; g.lineWidth = 60; g.lineCap = "round";
        const dir = phys.wind > 0 ? 1 : -1, t = Date.now() / 500;
        for (let i = 0; i < 4; i++) {
          const wy = G.ROWH * (5.5 + i * 1.6), wx = ((t * 2200 * dir + i * 4500) % G.WUNITS + G.WUNITS) % G.WUNITS;
          g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + dir * 1400, wy); g.stroke();
        }
      }
    }
    // trail behind the flying gem
    for (const t2 of st.trail) {
      g.globalAlpha = Math.max(0, t2.life / 260) * 0.5;
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(t2.x, t2.y, G.R * 0.28 * (t2.life / 260), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // flying gem
    if (st.anim && st.anim.fly) g.drawImage(sprite(st.anim.fly.code), st.anim.fly.x - G.R, st.anim.fly.y - G.R, px, px);
    // fog veil over the upper board
    if (st.run.fog) {
      const fogGrad = g.createLinearGradient(0, yOff, 0, yOff + G.ROWH * 4.5);
      fogGrad.addColorStop(0, "rgba(250,245,239,.92)");
      fogGrad.addColorStop(1, "rgba(250,245,239,0)");
      g.fillStyle = fogGrad;
      g.fillRect(0, yOff - G.R, G.WUNITS, G.ROWH * 4.5 + G.R);
    }
    // particles
    for (const p of st.particles) {
      g.globalAlpha = Math.max(0, p.life / p.life0);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // 😰 near-death drama: dark vignette + a worried bear when the swarm
    // is within two rows of the lawn
    let lowestNow = -1;
    st.display.forEach((row, r) => { if (row.some((v) => v != null)) lowestNow = r; });
    const danger = lowestNow >= 0 && lowestNow + st.drops >= G.DEAD_ROW - 2 && phaseRef.current === "play";
    if (danger) {
      const vg = g.createRadialGradient(G.WUNITS / 2, G.LAUNCH_Y / 2, G.WUNITS * 0.45, G.WUNITS / 2, G.LAUNCH_Y / 2, G.WUNITS * 1.05);
      vg.addColorStop(0, "rgba(120,30,40,0)");
      vg.addColorStop(1, "rgba(120,30,40,.32)");
      g.fillStyle = vg;
      g.fillRect(0, 0, G.WUNITS, G.LAUNCH_Y + 4 * G.R);
      g.font = `${1.3 * G.R}px system-ui`; g.textAlign = "center";
      g.fillText("💦", G.WUNITS / 2 + 1.8 * G.R, G.LAUNCH_Y + 0.4 * G.R);
    }
    // floating score popups
    g.textAlign = "center";
    for (const pu of st.popups) {
      const k = pu.t / 800;
      g.globalAlpha = Math.max(0, 1 - k);
      g.font = `600 ${1.35 * G.R}px Fraunces, serif`;
      g.fillStyle = pu.color || "#8a5a44";
      g.fillText(pu.txt, pu.x, pu.y - k * 2.4 * G.R);
    }
    g.globalAlpha = 1;
    // launcher: the player, holding the current gem (recoil kick on fire).
    // The moment a shot leaves, the bear ALREADY holds the next gem (pending
    // run) — what's in hand never changes after the fact.
    const held = (st.pending || st.run).cur;
    const lx = G.WUNITS / 2, ly = G.LAUNCH_Y + (st.recoil > 0 ? st.recoil * G.R * 0.5 : 0);
    if (held != null) g.drawImage(sprite(held), lx - G.R, ly - G.R, px, px);
    g.font = `${2.6 * G.R}px system-ui`;
    g.textAlign = "center";
    g.fillText((me && me.emoji) || "💗", lx, ly + 2.6 * G.R);
  }, [me]);

  // phase/fever in refs so draw()/tick() (stable) can read them
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const feverRef = useRef(fever); feverRef.current = fever;

  /* ---- animation playback of engine events ---- */
  const FLY_SPEED = 34;                              // units per ms
  const finishAnim = useCallback(() => {
    const st = S.current; if (!st || !st.pending) return;
    clearTimeout(st.watchdog);
    const run = st.pending;
    st.run = run; st.pending = null; st.anim = null;
    st.display = run.rows.map((r) => r.slice());
    st.drops = run.drops;
    st.particles = []; st.falling = [];
    setHud({ score: run.mode === "duel" ? run.scores[0] + run.scores[1] : run.score, misses: run.misses, moveEvery: run.moveEvery, cur: run.cur, next: run.next, ...(run.mode === "duel" ? duelCounts(run.rows) : {}) });
    setCombo(run.combo >= 2 ? run.combo : 0);
    if (run.combo < 2) setFever(false);
    if (run.boss) setBossUi((b) => ({ hp: run.boss.hp, maxHp: run.boss.maxHp, exposed: run.boss.exposed, hitN: (b ? b.hitN : 0) }));
    if (run.mode === "duel") setTurn(run.turn);
    if (run.status === "cleared") {
      const stars = st.shotsUsed <= st.par * 0.7 ? 3 : st.shotsUsed <= st.par * 1.15 ? 2 : 1;
      setPhase("cleared");
      setHud((h0) => ({ ...h0, stars }));
      onCleared && onCleared(st.run.levelNo, stars, run.score);
    } else if (run.status === "dead") { snd.dead(); setPhase("dead"); }
    else if (run.status === "duelend") setPhase("duelend");
    draw();
  }, [draw, onCleared]);

  const tick = useCallback((now) => {
    const st = S.current; if (!st) return;
    let dt = Math.min(48, now - (st.last || now)); st.last = now;
    // fever + final-clear play in dramatic slow motion
    if (feverRef.current || now < st.slowUntil) dt *= 0.55;
    let busy = false;
    const a = st.anim;
    if (a) {
      busy = true;
      if (a.fly) {
        a.fly.t += dt * FLY_SPEED;
        // advance along path
        let seg = a.fly.seg, t = a.fly.t;
        const path = a.fly.path;
        while (seg < path.length - 1) {
          const p0 = path[seg], p1 = path[seg + 1];
          const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          if (t <= len) { a.fly.x = p0.x + (p1.x - p0.x) * (t / len); a.fly.y = p0.y + (p1.y - p0.y) * (t / len); break; }
          t -= len; seg++;
          // wall bounce passed → sparks + a tiny kick
          if (a.fly.bounces && a.fly.bounces.includes(seg)) {
            for (let i = 0; i < 6 && st.particles.length < 160; i++)
              st.particles.push({ x: path[seg].x, y: path[seg].y, vx: (Math.random() - 0.5) * G.R / 20, vy: (Math.random() - 0.5) * G.R / 20, r: G.R * 0.12, life: 240, life0: 240, color: "#fff" });
            st.shake = Math.max(st.shake, 2);
            if (st.run.mode === "duel") snd.cushion(); else snd.bounce();
          }
        }
        a.fly.seg = seg; a.fly.t = t;
        st.trail.push({ x: a.fly.x, y: a.fly.y, life: 260 });
        if (st.trail.length > 26) st.trail.shift();
        if (seg >= a.fly.path.length - 1) { a.fly = null; nextEvent(); }
      } else if (a.storm) {
        a.storm.t += dt;
        const k = Math.min(1, a.storm.t / a.storm.dur);
        a.storm.y = a.storm.y0 + (a.storm.y1 - a.storm.y0) * k * k;   // accelerating drop
        if (k >= 1) {
          while (st.display.length <= a.storm.r) st.display.push(new Array(G.colsIn(st.display.length)).fill(null));
          st.display[a.storm.r][a.storm.c] = a.storm.code;
          nextEvent();
        }
      } else if (a.wait > 0) {
        a.wait -= dt;
        if (a.wait <= 0) nextEvent();
      }
    }
    // particles + falls + juice always advance
    for (const p of st.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.02 * dt * G.R / 60; p.life -= dt; }
    st.particles = st.particles.filter((p) => p.life > 0);
    for (const f of st.falling) {
      f.y += f.vy * dt; f.vy += 0.05 * dt * G.R / 16;
      // falling gems BOUNCE on the lawn before vanishing
      if (f.y >= G.LAUNCH_Y + G.R && f.vy > 0 && (f.bounces || 0) < 2) {
        f.y = G.LAUNCH_Y + G.R; f.vy = -f.vy * 0.45; f.vx = (f.vx || 0) + (Math.random() - 0.5) * G.R / 30; f.bounces = (f.bounces || 0) + 1;
      }
      f.x += (f.vx || 0) * dt;
    }
    st.falling = st.falling.filter((f) => (f.bounces || 0) < 2 || f.y < G.LAUNCH_Y + G.R + 1);
    for (const j of st.jiggles) j.t += dt;
    st.jiggles = st.jiggles.filter((j) => j.t < 260);
    if (st.driftFx) { st.driftFx.t += dt; if (st.driftFx.t >= st.driftFx.dur) st.driftFx = null; else busy = true; }
    for (const pu of st.popups) pu.t += dt;
    st.popups = st.popups.filter((pu) => pu.t < 800);
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt / 40);
    if (st.recoil > 0) st.recoil = Math.max(0, st.recoil - dt / 180);
    for (const t2 of st.trail) t2.life -= dt;
    st.trail = st.trail.filter((t2) => t2.life > 0);
    if (st.particles.length || st.falling.length || st.jiggles.length || st.popups.length || st.shake > 0 || st.recoil > 0 || st.trail.length) busy = true;
    draw();
    if (busy) st.raf = requestAnimationFrame(tick);
    else { st.raf = 0; if (st.pending && !st.anim) finishAnim(); }
  }, [draw, finishAnim]);

  const ensureRaf = () => { const st = S.current; if (st && !st.raf) { st.last = 0; st.raf = requestAnimationFrame(tick); } };

  const nextEvent = useCallback(() => {
    const st = S.current; if (!st) return;
    const ev = st.queue.shift();
    if (!ev) { st.anim = null; return; }
    const yOff = st.drops * G.ROWH;
    if (ev.t === "fly") st.anim = { fly: { path: ev.path, bounces: ev.bounces || [], code: ev.code, seg: 0, t: 0, x: ev.path[0].x, y: ev.path[0].y } };
    else if (ev.t === "place") {
      while (st.display.length <= ev.r) st.display.push(new Array(G.colsIn(st.display.length)).fill(null));
      st.display[ev.r][ev.c] = ev.code;
      // the cluster takes the hit: neighbors jiggle
      G.neighbors(ev.r, ev.c).forEach(([rr, cc]) => {
        if (rr >= 0 && st.display[rr] && st.display[rr][cc] != null) st.jiggles.push({ r: rr, c: cc, t: 0 });
      });
      if (st.run.mode === "duel") snd.clack(); else snd.thunk();
      st.anim = { wait: 40 };
    }
    else if (ev.t === "pop") {
      for (const [r, c] of ev.cells) {
        const code = st.display[r] && st.display[r][c];
        if (st.display[r]) st.display[r][c] = null;
        const hueNow = st.run.mode === "duel"
          ? (POOL[G.colorOf(code) ?? "0"] || POOL["0"]).hue
          : (st.run.shapeMode ? SHAPE_HUES : st.theme.hues)[parseInt(G.colorOf(code) ?? "0", 10) % 7];
        for (let i = 0; i < 8 && st.particles.length < 160; i++) {
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 22, vy: (Math.random() - 0.7) * G.R / 22, r: G.R * (0.12 + Math.random() * 0.16), life: 420, life0: 420, color: hueNow });
        }
      }
      try { navigator.vibrate && navigator.vibrate(12); } catch {}
      // score popup at the group's centroid; big pops rattle the sky
      const cx = ev.cells.reduce((s2, [r, c]) => s2 + G.cellX(r, c), 0) / ev.cells.length;
      const cy = ev.cells.reduce((s2, [r]) => s2 + G.cellY(r), 0) / ev.cells.length + yOff;
      st.popups.push({ x: cx, y: cy, txt: "+" + ev.pts, t: 0 });
      if (ev.cells.length >= 5) st.shake = Math.max(st.shake, 3 + Math.min(5, ev.cells.length - 4));
      if (st.run.mode === "duel") snd.pocket(ev.cells.length);
      else snd.pop((st.pending && st.pending.combo) || 1, ev.cells.length);
      st.anim = { wait: 140 };
    }
    else if (ev.t === "fall") {
      for (const [r, c] of ev.cells) {
        const code = st.display[r] && st.display[r][c];
        if (st.display[r]) st.display[r][c] = null;
        st.falling.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vy: G.R / 40, code: code || "0" });
      }
      if (st.run.mode === "duel") snd.pocket(ev.cells.length); else snd.fall();
      st.anim = { wait: 120 };
    }
    else if (ev.t === "descend") { st.drops = ev.drops; st.anim = { wait: 200 }; }
    else if (ev.t === "uncage") {
      for (const [r, c] of ev.cells) {
        const v = st.display[r] && st.display[r][c];
        if (v && v[0] === "C") st.display[r][c] = v.slice(1);
        for (let i = 0; i < 5 && st.particles.length < 160; i++)
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 26, vy: (Math.random() - 0.8) * G.R / 26, r: G.R * 0.12, life: 320, life0: 320, color: "#4a423a" });
      }
      st.anim = { wait: 90 };
    }
    else if (ev.t === "boom") {
      for (const [r, c] of ev.cells) {
        if (st.display[r]) st.display[r][c] = null;
        for (let i = 0; i < 10 && st.particles.length < 160; i++)
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 14, vy: (Math.random() - 0.6) * G.R / 14, r: G.R * (0.14 + Math.random() * 0.2), life: 500, life0: 500, color: i % 3 ? "#ffd166" : "#ff9e7d" });
      }
      try { navigator.vibrate && navigator.vibrate(24); } catch {}
      const bx = ev.cells.reduce((s2, [r, c]) => s2 + G.cellX(r, c), 0) / ev.cells.length;
      const by = ev.cells.reduce((s2, [r]) => s2 + G.cellY(r), 0) / ev.cells.length + yOff;
      st.popups.push({ x: bx, y: by, txt: "+" + ev.pts, t: 0, color: "#cf4a63" });
      st.shake = Math.max(st.shake, 7);
      snd.boom();
      st.anim = { wait: 200 };
    }
    else if (ev.t === "heartpop") {
      for (const [r, c] of ev.cells) {
        if (st.display[r]) st.display[r][c] = null;
        for (let i = 0; i < 14 && st.particles.length < 160; i++)
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 16, vy: (Math.random() - 0.85) * G.R / 16, r: G.R * (0.14 + Math.random() * 0.14), life: 640, life0: 640, color: i % 2 ? "#e8617a" : "#ffb4c8" });
        st.popups.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, txt: "+500 💗", t: 0, color: "#e8617a" });
      }
      try { navigator.vibrate && navigator.vibrate([16, 40, 16]); } catch {}
      st.anim = { wait: 240 };
    }
    else if (ev.t === "storm") {
      st.anim = { storm: { r: ev.r, c: ev.c, code: ev.code, x: G.cellX(ev.r, ev.c), y0: -2 * G.R, y1: G.cellY(ev.r) + yOff, y: -2 * G.R, t: 0, dur: 300 } };
    }
    else if (ev.t === "grow") {
      for (const [r, c, code] of ev.cells) {
        while (st.display.length <= r) st.display.push(new Array(G.colsIn(st.display.length)).fill(null));
        st.display[r][c] = code;
        st.jiggles.push({ r, c, t: 0 });
        for (let i = 0; i < 5 && st.particles.length < 160; i++)
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 30, vy: (Math.random() - 0.5) * G.R / 30, r: G.R * 0.1, life: 260, life0: 260, color: "#fff" });
      }
      st.anim = { wait: 130 };
    }
    else if (ev.t === "drift") {
      st.display = st.display.map((row, r) => {
        const out = row.slice();
        if (ev.dir < 0) { out.shift(); out.push(null); } else { out.pop(); out.unshift(null); }
        return out;
      });
      st.driftFx = { dir: ev.dir, t: 0, dur: 240 };
      st.anim = { wait: 250 };
    }
    else if (ev.t === "clear") {
      // 🎆 the last-shot moment: slow motion + fireworks across the sky
      st.slowUntil = performance.now() + 900;
      const hues = st.run.shapeMode ? SHAPE_HUES : st.theme.hues;
      for (let b = 0; b < 3; b++) {
        const fx = G.WUNITS * (0.25 + b * 0.25), fy = G.ROWH * (2 + (b % 2) * 2.5);
        for (let i = 0; i < 26 && st.particles.length < 220; i++) {
          const ang = (i / 26) * Math.PI * 2;
          st.particles.push({ x: fx, y: fy, vx: Math.cos(ang) * G.R / 18, vy: Math.sin(ang) * G.R / 18, r: G.R * 0.16, life: 800 + b * 120, life0: 800 + b * 120, color: hues[(i + b) % hues.length] });
        }
      }
      if (ev.clutch) { st.popups.push({ x: G.WUNITS / 2, y: G.ROWH * 5, txt: "CLUTCH! +500", t: 0, color: "#cf4a63" }); snd.clutch(); }
      else snd.clear();
      st.shake = Math.max(st.shake, 5);
      st.anim = { wait: 900 };
    }
    else if (ev.t === "bossHit") {
      snd.bossHit();
      st.shake = Math.max(st.shake, 6);
      st.popups.push({ x: G.WUNITS / 2, y: G.ROWH * 1.4, txt: `-${ev.dmg}`, t: 0, color: "#cf4a63" });
      setBossUi((b) => (b ? { ...b, hp: ev.hp, exposed: false, hitN: b.hitN + 1 } : b));
      st.anim = { wait: 160 };
    }
    else if (ev.t === "bossExposed") {
      snd.bossRoar();
      st.popups.push({ x: G.WUNITS / 2, y: G.ROWH * 2, txt: "NOW! Hit it!", t: 0, color: "#cf4a63" });
      setBossUi((b) => (b ? { ...b, exposed: true } : b));
      st.anim = { wait: 260 };
    }
    else if (ev.t === "bossShield") {
      for (const [r, c] of ev.cells) {
        if (st.display[r]) st.display[r][c] = "S";
        st.jiggles.push({ r, c, t: 0 });
        for (let i = 0; i < 6 && st.particles.length < 200; i++)
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 26, vy: (Math.random() - 0.5) * G.R / 26, r: G.R * 0.12, life: 320, life0: 320, color: "#a9a29a" });
      }
      st.anim = { wait: 220 };
    }
    else if (ev.t === "bossDown") {
      snd.bossDown();
      st.slowUntil = performance.now() + 1000;
      st.shake = Math.max(st.shake, 10);
      st.popups.push({ x: G.WUNITS / 2, y: G.ROWH * 3, txt: "STORM BROKEN! +1500", t: 0, color: "#cf4a63" });
      for (let i = 0; i < 40 && st.particles.length < 220; i++) {
        const ang = (i / 40) * Math.PI * 2;
        st.particles.push({ x: G.WUNITS / 2, y: G.ROWH * 1.5, vx: Math.cos(ang) * G.R / 14, vy: Math.sin(ang) * G.R / 14, r: G.R * 0.2, life: 900, life0: 900, color: i % 2 ? "#ffd166" : "#cfe7f5" });
      }
      st.anim = { wait: 1000 };
    }
    else if (ev.t === "eightball") {
      // ☠️ somebody sank the eight-ball
      if (st.display[ev.r]) st.display[ev.r][ev.c] = null;
      for (let i = 0; i < 22 && st.particles.length < 200; i++) {
        const ang = (i / 22) * Math.PI * 2;
        st.particles.push({ x: G.cellX(ev.r, ev.c), y: G.cellY(ev.r) + yOff, vx: Math.cos(ang) * G.R / 18, vy: Math.sin(ang) * G.R / 18, r: G.R * 0.16, life: 640, life0: 640, color: i % 3 ? "#26262b" : "#fdfaf4" });
      }
      st.popups.push({ x: G.cellX(ev.r, ev.c), y: G.cellY(ev.r) + yOff, txt: "🎱 -300!", t: 0, color: "#26262b" });
      st.shake = Math.max(st.shake, 8);
      snd.boom(); snd.dead();
      try { navigator.vibrate && navigator.vibrate([30, 60, 30]); } catch {}
      st.anim = { wait: 450 };
    }
    else if (ev.t === "duelend") st.anim = { wait: 300 };
    else st.anim = { wait: 10 };                     // next / turn / dead — HUD updates at finish
  }, []);

  const fire = useCallback((angleMil) => {
    const st = S.current;
    if (!st || st.anim || st.pending || phaseRef.current !== "play") return;
    snd.ensure();                                    // first gesture unlocks audio (iOS)
    const { run, events } = G.applyShot(st.run, { t: "shot", a: angleMil });
    st.pending = run;
    st.shotsUsed++;
    st.recoil = 1;
    st.trail = [];
    // 🔥 FEVER: chain 4+ combos and the sky goes golden slow-mo
    if (run.combo >= 4 && !feverRef.current) { setFever(true); snd.fever(); }
    // hand + next-chip update IMMEDIATELY (score/pips settle when the play
    // animation lands) — nothing in the bear's hand ever changes late
    setHud((h0) => ({ ...h0, cur: run.cur, next: run.next }));
    st.queue = events.slice();
    nextEvent();
    ensureRaf();
    // watchdog: never let a stalled playback strand the board
    clearTimeout(st.watchdog);
    // must outlast the LONGEST possible event chain (boss defeat 1s + clear
    // celebration .9s + flight/falls) — snapping mid-fireworks was possible at 2.6s
    st.watchdog = setTimeout(() => { const s2 = S.current; if (s2 && s2.pending) { s2.queue = []; s2.anim = null; finishAnim(); } }, 4200);
  }, [nextEvent, finishAnim]);

  const swap = useCallback(() => {
    const st = S.current;
    if (!st || st.anim || st.pending || phaseRef.current !== "play") return;
    const { run } = G.applyShot(st.run, { t: "swap" });
    st.run = run;
    setHud((h0) => ({ ...h0, cur: run.cur, next: run.next }));
    draw();
  }, [draw]);

  /* ---- input: drag to aim, release to fire (window listeners + watchdog) */
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    let aiming = false, silent = 0;
    const angleFor = (e) => {
      const st = S.current; if (!st) return 0;
      const rect = cv.getBoundingClientRect();
      const wx = (e.clientX - rect.left - st.offX) / st.scale;
      const wy = (e.clientY - rect.top) / st.scale;
      const a = Math.atan2(wx - G.WUNITS / 2, Math.max(200, G.LAUNCH_Y - wy));
      return Math.max(-1300, Math.min(1300, Math.round(a * 1000)));
    };
    const down = (e) => {
      if (phaseRef.current !== "play") return;
      aiming = true; silent = Date.now();
      S.current.aim = angleFor(e); draw();
    };
    const move = (e) => { if (!aiming) return; silent = Date.now(); S.current.aim = angleFor(e); draw(); };
    const up = (e) => {
      if (!aiming) return;
      aiming = false;
      const a = angleFor(e);
      S.current.aim = null;
      fire(a);
    };
    // a CANCELLED pointer (iOS system gesture stole it) must never fire
    const cancel = () => { if (!aiming) return; aiming = false; S.current.aim = null; draw(); };
    // iOS may never deliver pointerup — a silence watchdog cancels WITHOUT firing
    const guard = setInterval(() => {
      if (aiming && Date.now() - silent > 1600) { aiming = false; S.current.aim = null; draw(); }
    }, 500);
    cv.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      clearInterval(guard);
      cv.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [fire, draw]);

  // backgrounded → snap every animation to its known end state
  useEffect(() => {
    const snap = () => { if (document.visibilityState === "hidden") { const st = S.current; if (st && st.pending) { st.queue = []; st.anim = null; finishAnim(); } } };
    document.addEventListener("visibilitychange", snap);
    return () => document.removeEventListener("visibilitychange", snap);
  }, [finishAnim]);

  useEffect(() => () => { const st = S.current; if (st) { cancelAnimationFrame(st.raf); clearTimeout(st.watchdog); } }, []);

  const nextLevel = () => { const n = levelNo + 1; setLevelNo(n); boot(n); setTimeout(fit, 30); };
  const retry = () => { boot(levelNo); setTimeout(fit, 30); };

  const pips = hud ? Math.max(0, hud.moveEvery - hud.misses) : 0;
  const duelP = duel && (turn === 0 ? duel.p0 : duel.p1);
  return html`<div class=${`gamefs gemfs ${fever ? "fever" : ""}`}>
    <div class="gamefs-bar">
      <button class="iconbtn" onClick=${() => onExit(levelNo)}>✕</button>
      <div class="gemfs-title">${duel ? "⚔️ Gem Duel" : `💎 Level ${levelNo}`}</div>
      <button class="iconbtn" onClick=${() => { snd.muted = !snd.muted; try { localStorage.setItem("pp.gq.mute", snd.muted ? "1" : "0"); } catch {} setMuted(snd.muted); }}>${muted ? "🔇" : "🔊"}</button>
      <div class="gemfs-score tnum">${hud ? hud.score : 0}</div>
    </div>
    ${bossUi && html`<div class=${`gemfs-boss ${bossUi.exposed ? "exposed" : ""}`} key=${"hit" + bossUi.hitN}>
      <span class="gemfs-boss-face">⛈️</span>
      <span class="gemfs-boss-hp">${"❤️".repeat(bossUi.hp)}${"🖤".repeat(Math.max(0, bossUi.maxHp - bossUi.hp))}</span>
      ${bossUi.exposed && html`<span class="gemfs-boss-now">weak spot open!</span>`}
    </div>`}
    ${duel && html`<div class=${`gemfs-turnbar ${turn === 0 ? "warm" : "cool"}`}>
      <span class="gemfs-turn-who">${duelP.emoji} ${duelP.name}'s shot</span>
      <span class="gemfs-turn-side">${turn === 0 ? "● solids" : "◐ stripes"}</span>
      <span class="gemfs-turn-counts tnum">● ${hud ? hud.warmLeft : 0} · ◐ ${hud ? hud.coolLeft : 0}</span>
    </div>`}
    <div class="gemfs-hud">
      <span class="gemfs-pips">${hud && hud.moveEvery < 99 ? Array.from({ length: hud.moveEvery }, (_, i) => html`<i key=${i} class=${i < pips ? "on" : ""}></i>`) : ""}</span>
      ${S.current && S.current.run.mods.length > 0 && html`<span class="gemfs-mods">${S.current.run.mods.map((m) => html`<em key=${m}>${m}</em>`)}</span>`}
      <button class="gemfs-next" onClick=${swap} title="Swap">
        next ${(() => {
          const n = (hud && hud.next) || "0";
          if (duel) {
            const spec = POOL[n] || POOL["0"];
            const bg = spec.stripe ? `linear-gradient(180deg,#fdfaf4 0 26%,${spec.hue} 26% 74%,#fdfaf4 74% 100%)` : spec.hue;
            return html`<span class="gemdot" style=${`background:${bg}`}></span>`;
          }
          if (n === "W") return html`<span class="gememoji">🌈</span>`;
          const set = S.current && S.current.run.shapeMode ? SHAPEMOJI : (S.current ? S.current.theme.emoji : THEMES[0].emoji);
          return html`<span class="gememoji">${set[parseInt(G.colorOf(n) ?? "0", 10) % set.length]}</span>`;
        })()} ⇄
      </button>
    </div>
    <div class="gemfs-stage" ref=${wrapRef}>
      <canvas ref=${cvRef}></canvas>
      ${intro && html`<div class="gemfs-intro">
        <div class="gemfs-intro-title">${intro.title}</div>
        <div class="gemfs-intro-sub">${intro.sub}</div>
      </div>`}
      ${combo >= 2 && phase === "play" && html`<div class="gemfs-combo" key=${combo}>Combo ×${combo}!</div>`}
      ${phase === "cleared" && html`<div class="gemfs-over">
        <div class="gemfs-big">Level ${levelNo} cleared!</div>
        <div class="gemfs-stars">${"⭐".repeat((hud && hud.stars) || 1)}</div>
        <div class="tnum" style="font-size:18px">${hud ? hud.score : 0} pts</div>
        <button class="btn" onClick=${nextLevel}>Next level ▸</button>
        <button class="linkbtn" onClick=${() => onExit(levelNo + 1)}>Back to the castle</button>
      </div>`}
      ${phase === "dead" && html`<div class="gemfs-over">
        <div class="gemfs-big">The gems reached the lawn 😵</div>
        <button class="btn" onClick=${retry}>Try again</button>
        <button class="linkbtn" onClick=${() => onExit(levelNo)}>Back to the castle</button>
      </div>`}
      ${phase === "duelend" && duel && (() => {
        const w = S.current.run.winner === 0 ? duel.p0 : duel.p1;
        return html`<div class="gemfs-over">
          <div class="gemfs-big">${w.emoji} ${w.name} runs the table!</div>
          <div class="gemfs-stars">${S.current.run.winner === 0 ? "●" : "◐"} 🎱</div>
          <div class="tnum" style="font-size:16px">● ${S.current.run.scores[0]} · ◐ ${S.current.run.scores[1]}</div>
          <button class="btn" onClick=${() => { boot((Math.random() * 4294967296) >>> 0); setTimeout(fit, 30); }}>Rematch ⚔️</button>
          <button class="linkbtn" onClick=${() => onExit(levelNo)}>Back to the castle</button>
        </div>`; })()}
    </div>
    <div class="gemfs-lawn"></div>
  </div>`;
}

/* ================= Game Room entry card ================================= */
export function GemQuestCard({ client, me, players, flash }) {
  const partner = players.find((p) => p.id !== me.id);
  const [prog, setProg] = useState(null);            // all gem_progress rows
  const [playing, setPlaying] = useState(null);      // null | {level}
  const [mapOpen, setMapOpen] = useState(false);
  const [duelSetup, setDuelSetup] = useState(false);
  const [dueling, setDueling] = useState(null);      // {p0, p1} — p0 is warm 🔥

  const load = useCallback(async () => {
    const { data } = await client.from("gem_progress").select("*").order("level");
    setProg(data || []);
  }, [client]);
  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-gems-" + Math.random().toString(36).slice(2, 6))
        .on("postgres_changes", { event: "*", schema: "public", table: "gem_progress" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const mine = (prog || []).filter((r) => r.player_id === me.id);
  const theirs = partner ? (prog || []).filter((r) => r.player_id === partner.id) : [];
  const myLevel = mine.reduce((m, r) => (r.stars > 0 ? Math.max(m, r.level) : m), 0) + 1;
  const theirLevel = theirs.reduce((m, r) => (r.stars > 0 ? Math.max(m, r.level) : m), 0);
  const myBest = mine.reduce((m, r) => Math.max(m, r.best_score), 0);

  // select→insert-or-update (the demo builder has no upsert). A FIRST clear
  // (the insert path) pays hearts — single-writer: my phone only awards ME,
  // and the unique(player_id, level) constraint dedupes cross-session races.
  const saveClear = useCallback(async (level, stars, score) => {
    try {
      const { data } = await client.from("gem_progress").select("*").eq("player_id", me.id).eq("level", level);
      const row = data && data[0];
      if (!row) {
        const { error } = await client.from("gem_progress").insert({ player_id: me.id, level, stars, best_score: score });
        if (!error) {
          const amount = level % 5 === 0 ? 3 : 1;
          await client.from("transactions").insert({ player_id: me.id, amount, type: "earn", description: `Gem Quest: level ${level} cleared 💎` });
          flash(`+${amount} 💗 for level ${level}!`);
        }
      } else if (stars > row.stars || score > row.best_score)
        await client.from("gem_progress").update({ stars: Math.max(stars, row.stars), best_score: Math.max(score, row.best_score), updated_at: new Date().toISOString() }).eq("id", row.id);
      load();
    } catch {}
  }, [client, me.id, load, flash]);

  if (dueling) return html`<${GemPlay} me=${me} duel=${dueling}
    onExit=${() => setDueling(null)} />`;

  if (playing) return html`<${GemPlay} me=${me} startLevel=${playing.level}
    onCleared=${saveClear}
    onExit=${() => { setPlaying(null); load(); }} />`;

  if (mapOpen) return html`<${GemMap} me=${me} partner=${partner} prog=${prog || []}
    onPlay=${(level) => { setMapOpen(false); setPlaying({ level }); }}
    onClose=${() => setMapOpen(false)} />`;

  return html`<div class="card gamehero gemhero">
    <div class="eyebrow">Gem Quest 💎</div>
    <div class="gamehero-title">Level ${myLevel}</div>
    <div class="gamehero-meta tnum">
      ${myBest ? `best ${myBest}` : "a new journey"}${partner && theirLevel ? ` · ${partner.emoji} is on ${theirLevel + 1}` : ""}
    </div>
    <div class="row" style="gap:10px; justify-content:center; flex-wrap:wrap">
      <button class="btn gamehero-btn" onClick=${() => setPlaying({ level: myLevel })}>Play ▸</button>
      <button class="btn ghost" onClick=${() => setMapOpen(true)}>🗺 Journey</button>
      ${partner && html`<button class="btn ghost" onClick=${() => setDuelSetup(true)}>⚔️ Duel</button>`}
    </div>
    ${duelSetup && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setDuelSetup(false); }}>
      <div class="modal" onClick=${(e) => e.stopPropagation()}>
        <div class="handle"></div>
        <div class="eyebrow" style="margin-bottom:6px">🎱 gem duel — pass the phone</div>
        <p class="sub" style="margin-bottom:12px">One rack, alternating shots. Clear <b>your</b> balls first — and wall theirs in. But mind the 🎱: whoever knocks the eight-ball loose eats <b>-300</b>. Who shoots ● solids? The other gets ◐ stripes.</p>
        <div class="row" style="gap:10px">
          <button class="btn block" onClick=${() => { setDuelSetup(false); setDueling({ p0: me, p1: partner }); }}>● ${me.emoji} ${me.name}</button>
          <button class="btn block" onClick=${() => { setDuelSetup(false); setDueling({ p0: partner, p1: me }); }}>● ${partner.emoji} ${partner.name}</button>
        </div>
      </div>
    </div>`}
  </div>`;
}
