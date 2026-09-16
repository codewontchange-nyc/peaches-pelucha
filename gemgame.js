import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as G from "./gems.js";

const html = htm.bind(h);

/* 💎 Gem Quest — canvas renderer + input + Game Room card. The engine
   (gems.js) resolves every shot synchronously; this file only ANIMATES the
   precomputed result — so backgrounding, watchdogs, and (later) netcode can
   always jump straight to the known final board.
   Storybook-sky theme: transparent canvas over a CSS sky, the player's own
   emoji as the shooter on the lawn. */

const COLORS = ["#e8617a", "#ffd166", "#7fb069", "#5aa7d6", "#c4a6ff", "#ff9e7d", "#1f8c8a"];
const RIMS   = ["#c64360", "#d9a827", "#5d8a4e", "#3d83b0", "#9a79e8", "#e07a5f", "#15706e"];
const JOURNEY_SEED = "gq1";

/* ---- sprites: each color pre-rendered once per size (hot loop = drawImage) */
function makeSprites(px) {
  return COLORS.map((fill, i) => {
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    const r = px / 2;
    g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
    g.lineWidth = Math.max(2, px * 0.07); g.strokeStyle = RIMS[i]; g.stroke();
    g.beginPath(); g.arc(r - r * 0.32, r - r * 0.36, r * 0.22, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,.75)"; g.fill();
    return c;
  });
}

/* ================= the playable surface (gamefs) ======================== */
function GemPlay({ me, startLevel, onExit, onCleared }) {
  const [levelNo, setLevelNo] = useState(startLevel);
  const [phase, setPhase] = useState("play");        // play | cleared | dead
  const [hud, setHud] = useState(null);              // {score, misses, moveEvery, cur, next, stars}
  const wrapRef = useRef(null), cvRef = useRef(null);
  const S = useRef(null);                            // ALL mutable game state (never re-render per frame)

  const boot = useCallback((lvl) => {
    const run = G.newRun(JOURNEY_SEED, lvl);
    S.current = {
      run, display: run.rows.map((r) => r.slice()), drops: run.drops,
      queue: [], pending: null, anim: null, particles: [], falling: [],
      aim: null, raf: 0, last: 0, watchdog: 0, sprites: null, scale: 1, offX: 0, dpr: 1,
      shotsUsed: 0, par: run.rows.flat().filter((v) => v != null).length / 2 + 5,
    };
    setHud({ score: 0, misses: 0, moveEvery: run.moveEvery, cur: run.cur, next: run.next });
    setPhase("play");
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
    g.setTransform(s * dpr, 0, 0, s * dpr, offX * dpr, 0);
    const yOff = st.drops * G.ROWH;
    const sprite = (code) => st.sprites[+code % st.sprites.length];
    const px = 2 * G.R;

    // descended-ceiling fringe
    if (st.drops > 0) {
      g.fillStyle = "rgba(217,161,115,.35)";
      g.fillRect(0, 0, G.WUNITS, yOff);
      g.fillStyle = "rgba(138,90,68,.5)";
      g.fillRect(0, yOff - 60, G.WUNITS, 60);
    }
    // board
    st.display.forEach((row, r) => row.forEach((v, c) => {
      if (v == null) return;
      g.drawImage(sprite(v), G.cellX(r, c) - G.R, G.cellY(r) + yOff - G.R, px, px);
    }));
    // falling gems
    for (const f of st.falling) g.drawImage(sprite(f.code), f.x - G.R, f.y - G.R, px, px);
    // aim preview: the dotted line IS the flight (same simulate)
    if (st.aim != null && phaseRef.current === "play" && !st.anim) {
      const fl = G.simulateFlight(st.run.rows, st.run.drops, st.aim);
      g.setLineDash([160, 260]); g.lineWidth = 90;
      g.strokeStyle = "rgba(138,90,68,.55)";
      g.beginPath();
      fl.path.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke(); g.setLineDash([]);
      if (fl.landing) {
        g.beginPath(); g.arc(G.cellX(fl.landing.r, fl.landing.c), G.cellY(fl.landing.r) + yOff, G.R * 0.5, 0, Math.PI * 2);
        g.strokeStyle = "rgba(138,90,68,.4)"; g.lineWidth = 70; g.stroke();
      }
    }
    // flying gem
    if (st.anim && st.anim.fly) g.drawImage(sprite(st.anim.fly.code), st.anim.fly.x - G.R, st.anim.fly.y - G.R, px, px);
    // particles
    for (const p of st.particles) {
      g.globalAlpha = Math.max(0, p.life / p.life0);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // launcher: the player, holding the current gem
    const lx = G.WUNITS / 2, ly = G.LAUNCH_Y;
    if (st.run.cur != null && !st.anim) g.drawImage(sprite(st.run.cur), lx - G.R, ly - G.R, px, px);
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
        }
        a.fly.seg = seg; a.fly.t = t;
        if (seg >= a.fly.path.length - 1) { a.fly = null; nextEvent(); }
      } else if (a.wait > 0) {
        a.wait -= dt;
        if (a.wait <= 0) nextEvent();
      }
    }
    // particles + falls always advance
    for (const p of st.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.02 * dt * G.R / 60; p.life -= dt; }
    st.particles = st.particles.filter((p) => p.life > 0);
    for (const f of st.falling) { f.y += f.vy * dt; f.vy += 0.05 * dt * G.R / 16; }
    st.falling = st.falling.filter((f) => f.y < G.LAUNCH_Y + 4 * G.R);
    if (st.particles.length || st.falling.length) busy = true;
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
    if (ev.t === "fly") st.anim = { fly: { path: ev.path, code: ev.code, seg: 0, t: 0, x: ev.path[0].x, y: ev.path[0].y } };
    else if (ev.t === "place") {
      while (st.display.length <= ev.r) st.display.push(new Array(G.colsIn(st.display.length)).fill(null));
      st.display[ev.r][ev.c] = ev.code;
      st.anim = { wait: 40 };
    }
    else if (ev.t === "pop") {
      for (const [r, c] of ev.cells) {
        const code = st.display[r] && st.display[r][c];
        if (st.display[r]) st.display[r][c] = null;
        for (let i = 0; i < 8 && st.particles.length < 160; i++) {
          st.particles.push({ x: G.cellX(r, c), y: G.cellY(r) + yOff, vx: (Math.random() - 0.5) * G.R / 22, vy: (Math.random() - 0.7) * G.R / 22, r: G.R * (0.12 + Math.random() * 0.16), life: 420, life0: 420, color: COLORS[+(code || 0) % COLORS.length] });
        }
      }
      try { navigator.vibrate && navigator.vibrate(12); } catch {}
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
    else st.anim = { wait: 10 };                     // next / clear / dead — HUD updates at finish
  }, []);

  const fire = useCallback((angleMil) => {
    const st = S.current;
    if (!st || st.anim || st.pending || phaseRef.current !== "play") return;
    const { run, events } = G.applyShot(st.run, { t: "shot", a: angleMil });
    st.pending = run;
    st.shotsUsed++;
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
    // iOS may never deliver pointerup — a silence watchdog cancels WITHOUT firing
    const guard = setInterval(() => {
      if (aiming && Date.now() - silent > 1600) { aiming = false; S.current.aim = null; draw(); }
    }, 500);
    cv.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      clearInterval(guard);
      cv.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
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
      <button class="gemfs-next" onClick=${swap} title="Swap">
        next <span class="gemdot" style=${`background:${COLORS[+(hud && hud.next || 0) % COLORS.length]}`}></span> ⇄
      </button>
    </div>
    <div class="gemfs-stage" ref=${wrapRef}>
      <canvas ref=${cvRef}></canvas>
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
  const [playing, setPlaying] = useState(false);

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

  // select→insert-or-update (the demo builder has no upsert)
  const saveClear = useCallback(async (level, stars, score) => {
    try {
      const { data } = await client.from("gem_progress").select("*").eq("player_id", me.id).eq("level", level);
      const row = data && data[0];
      if (!row) await client.from("gem_progress").insert({ player_id: me.id, level, stars, best_score: score });
      else if (stars > row.stars || score > row.best_score)
        await client.from("gem_progress").update({ stars: Math.max(stars, row.stars), best_score: Math.max(score, row.best_score), updated_at: new Date().toISOString() }).eq("id", row.id);
      load();
    } catch {}
  }, [client, me.id, load]);

  if (playing) return html`<${GemPlay} me=${me} startLevel=${myLevel}
    onCleared=${saveClear}
    onExit=${() => { setPlaying(false); load(); }} />`;

  return html`<div class="card gamehero gemhero" onClick=${() => setPlaying(true)}>
    <div class="eyebrow">Gem Quest 💎</div>
    <div class="gamehero-title">Level ${myLevel}</div>
    <div class="gamehero-meta tnum">
      ${myBest ? `best ${myBest}` : "a new journey"}${partner && theirLevel ? ` · ${partner.emoji} is on ${theirLevel + 1}` : ""}
    </div>
    <button class="btn gamehero-btn">Play ▸</button>
  </div>`;
}
