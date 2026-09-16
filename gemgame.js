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

/* gems are EMOJI on soft paper chips — the app's native design language.
   Fruit for color levels (Peaches included, obviously); a celestial set for
   shape-match levels; real emoji for every special. COLORS drives particles
   and HUD accents, hue-matched to each fruit. */
const GEMOJI    = ["🍓", "🍋", "🍏", "🫐", "🍇", "🍑", "🥥"];
const SHAPEMOJI = ["⭐", "🌙", "☁️", "🌸", "⚡", "🍄", "🎈"];
const COLORS = ["#e8617a", "#ffd166", "#7fb069", "#5aa7d6", "#c4a6ff", "#ff9e7d", "#a9826b"];
const JOURNEY_SEED = "gq1";

/* ---- sprites: emoji pre-rendered onto soft paper chips (hot loop = drawImage) */
function makeSprites(px) {
  const mk = (paint) => { const c = document.createElement("canvas"); c.width = c.height = px; paint(c.getContext("2d"), px / 2); return c; };
  const chip = (emoji, opts = {}) => mk((g, r) => {
    g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.fillStyle = opts.bg || "rgba(255,253,250,.94)"; g.fill();
    g.lineWidth = Math.max(1.5, px * 0.045);
    g.strokeStyle = opts.rim || "rgba(217,161,115,.85)"; g.stroke();
    g.font = `${Math.round(r * 1.22)}px system-ui`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, r, r * 1.07);
  });
  const colors = GEMOJI.map((e, i) => chip(e, { rim: COLORS[i] }));
  const shapes = SHAPEMOJI.map((e, i) => chip(e, { rim: COLORS[i] }));
  const stone = chip("🪨", { bg: "rgba(206,200,192,.95)", rim: "#6f6a63" });
  const bomb = chip("💣", { bg: "rgba(255,236,214,.95)", rim: "#2b2521" });
  const star = chip("⭐", { bg: "rgba(255,240,205,.95)", rim: "#d9a827" });
  const rainbow = chip("🌈", { rim: "#c4a6ff" });
  const ice = chip("🧊", { bg: "rgba(230,244,252,.92)", rim: "#9cc8e0" });
  const heart = chip("💗", { bg: "rgba(253,238,242,.95)", rim: "#e8617a" });
  const crown = chip("👑", { bg: "rgba(255,240,205,.95)", rim: "#c9a227" });
  const cage = mk((g, r) => {
    g.strokeStyle = "rgba(43,37,33,.65)"; g.lineWidth = Math.max(2, px * 0.055); g.lineCap = "round";
    for (let i = -2; i <= 2; i++) { const x = r + i * r * 0.42; g.beginPath(); g.moveTo(x, r * 0.25); g.lineTo(x, px - r * 0.25); g.stroke(); }
    g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.stroke();
  });
  return { colors, shapes, stone, bomb, star, rainbow, cage, ice, heart, crown };
}

/* ================= the playable surface (gamefs) ======================== */
function GemPlay({ me, startLevel, onExit, onCleared }) {
  const [levelNo, setLevelNo] = useState(startLevel);
  const [phase, setPhase] = useState("play");        // play | cleared | dead
  const [hud, setHud] = useState(null);              // {score, misses, moveEvery, cur, next, stars}
  const wrapRef = useRef(null), cvRef = useRef(null);
  const S = useRef(null);                            // ALL mutable game state (never re-render per frame)

  const [intro, setIntro] = useState(null);          // level intro card {title, sub}
  const [combo, setCombo] = useState(0);
  const boot = useCallback((lvl) => {
    const run = G.newRun(JOURNEY_SEED, lvl);
    S.current = {
      run, display: run.rows.map((r) => r.slice()), drops: run.drops,
      queue: [], pending: null, anim: null, particles: [], falling: [],
      trail: [], popups: [], jiggles: [], shake: 0, recoil: 0,
      aim: null, raf: 0, last: 0, watchdog: 0, sprites: null, scale: 1, offX: 0, dpr: 1,
      shotsUsed: 0, par: Math.round(run.rows.flat().filter((v) => v != null).length * 0.6) + 8,
    };
    setHud({ score: 0, misses: 0, moveEvery: run.moveEvery, cur: run.cur, next: run.next });
    setCombo(0);
    setPhase("play");
    const FORM = { rows: "", blob: "☁️ Cloudbank", ring: "⭕ The Ring", rope: "⛓ Hanging Chains", spiral: "🌀 The Spiral", heart: "💞 Heart of the Sky" };
    const bits = [FORM[run.formation], run.shapeMode ? "🔷 Shape match" : "", run.stormy ? "⛈ The sky shoots back" : "", run.gift ? "🎁 Gift level" : "", ...run.mods].filter(Boolean);
    setIntro({ title: `Level ${lvl}`, sub: bits.join(" · ") || "clear the sky" });
    setTimeout(() => setIntro(null), 1900);
  }, []);
  useEffect(() => { boot(levelNo); }, []);           // eslint-disable-line

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
    st.sprites = makeSprites(Math.max(24, Math.round(2 * G.R * s * dpr)));
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

  // phase in a ref so draw() (stable) can read it
  const phaseRef = useRef(phase); phaseRef.current = phase;

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
    setHud({ score: run.score, misses: run.misses, moveEvery: run.moveEvery, cur: run.cur, next: run.next });
    setCombo(run.combo >= 2 ? run.combo : 0);
    if (run.status === "cleared") {
      const stars = st.shotsUsed <= st.par * 0.7 ? 3 : st.shotsUsed <= st.par * 1.15 ? 2 : 1;
      setPhase("cleared");
      setHud((h0) => ({ ...h0, stars }));
      onCleared && onCleared(st.run.levelNo, stars, run.score);
    } else if (run.status === "dead") setPhase("dead");
    draw();
  }, [draw, onCleared]);

  const tick = useCallback((now) => {
    const st = S.current; if (!st) return;
    const dt = Math.min(48, now - (st.last || now)); st.last = now;
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
      st.anim = { wait: 40 };
    }
    else if (ev.t === "pop") {
      for (const [r, c] of ev.cells) {
        const code = st.display[r] && st.display[r][c];
        if (st.display[r]) st.display[r][c] = null;
        const ci = parseInt(G.colorOf(code) ?? "0", 10) % COLORS.length;
        for (let i = 0; i < 8 && st.particles.length < 160; i++) {
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 22, vy: (Math.random() - 0.7) * G.R / 22, r: G.R * (0.12 + Math.random() * 0.16), life: 420, life0: 420, color: COLORS[ci] });
        }
      }
      try { navigator.vibrate && navigator.vibrate(12); } catch {}
      // score popup at the group's centroid; big pops rattle the sky
      const cx = ev.cells.reduce((s2, [r, c]) => s2 + G.cellX(r, c), 0) / ev.cells.length;
      const cy = ev.cells.reduce((s2, [r]) => s2 + G.cellY(r), 0) / ev.cells.length + yOff;
      st.popups.push({ x: cx, y: cy, txt: "+" + ev.pts, t: 0 });
      if (ev.cells.length >= 5) st.shake = Math.max(st.shake, 3 + Math.min(5, ev.cells.length - 4));
      st.anim = { wait: 140 };
    }
    else if (ev.t === "fall") {
      for (const [r, c] of ev.cells) {
        const code = st.display[r] && st.display[r][c];
        if (st.display[r]) st.display[r][c] = null;
        st.falling.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vy: G.R / 40, code: code || "0" });
      }
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
    else st.anim = { wait: 10 };                     // next / clear / dead — HUD updates at finish
  }, []);

  const fire = useCallback((angleMil) => {
    const st = S.current;
    if (!st || st.anim || st.pending || phaseRef.current !== "play") return;
    const { run, events } = G.applyShot(st.run, { t: "shot", a: angleMil });
    st.pending = run;
    st.shotsUsed++;
    st.recoil = 1;
    st.trail = [];
    // hand + next-chip update IMMEDIATELY (score/pips settle when the play
    // animation lands) — nothing in the bear's hand ever changes late
    setHud((h0) => ({ ...h0, cur: run.cur, next: run.next }));
    st.queue = events.slice();
    nextEvent();
    ensureRaf();
    // watchdog: never let a stalled playback strand the board
    clearTimeout(st.watchdog);
    st.watchdog = setTimeout(() => { const s2 = S.current; if (s2 && s2.pending) { s2.queue = []; s2.anim = null; finishAnim(); } }, 2600);
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
  return html`<div class="gamefs gemfs">
    <div class="gamefs-bar">
      <button class="iconbtn" onClick=${() => onExit(levelNo)}>✕</button>
      <div class="gemfs-title">💎 Level ${levelNo}</div>
      <div class="gemfs-score tnum">${hud ? hud.score : 0}</div>
    </div>
    <div class="gemfs-hud">
      <span class="gemfs-pips">${Array.from({ length: hud ? hud.moveEvery : 0 }, (_, i) => html`<i key=${i} class=${i < pips ? "on" : ""}></i>`)}</span>
      ${S.current && S.current.run.mods.length > 0 && html`<span class="gemfs-mods">${S.current.run.mods.map((m) => html`<em key=${m}>${m}</em>`)}</span>`}
      <button class="gemfs-next" onClick=${swap} title="Swap">
        next <span class="gememoji">${(() => {
          const n = (hud && hud.next) || "0";
          if (n === "W") return "🌈";
          const set = S.current && S.current.run.shapeMode ? SHAPEMOJI : GEMOJI;
          return set[parseInt(G.colorOf(n) ?? "0", 10) % set.length];
        })()}</span> ⇄
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
    <div class="row" style="gap:10px; justify-content:center">
      <button class="btn gamehero-btn" onClick=${() => setPlaying({ level: myLevel })}>Play ▸</button>
      <button class="btn ghost" onClick=${() => setMapOpen(true)}>🗺 Journey</button>
    </div>
  </div>`;
}
