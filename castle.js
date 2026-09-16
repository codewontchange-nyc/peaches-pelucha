import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useRef, useEffect, useCallback, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🏰 The Castle — the app's hub world (Mario 64 energy, storybook flat-vector
   art, all original). One phone screen: a cutaway castle whose doors ARE the
   navigation. Tap a door → it glows open → the room mounts. The ROOMS registry
   is the single source of truth for door geometry (SVG viewBox units), labels,
   and badge anchors; app.js reads it for room titles too.
   viewBox is 0 0 390 720 (drawn under the ~64px sticky topbar). */

/* A STRICT 2×4 grid: two columns (centers x=133 and x=257), four floors whose
   lines sit at y = 268 / 396 / 524 / 652 (ground). Every door base rests ON its
   floor line; windows share the columns; the gallery painting hangs just above
   its line. Uniform sizes: doors 52×78, windows 44×58. Labels are nameplates
   just under each floor line. */
export const ROOMS = {
  map:      { label: "Observatory", emoji: "🔭", door: { x: 111, y: 210, w: 44, h: 58 } },   // floor 1 L
  chapel:   { label: "Sunroom",     emoji: "☀️", door: { x: 235, y: 210, w: 44, h: 58 } },   // floor 1 R
  memories: { label: "Gallery",     emoji: "🖼️", door: { x: 102, y: 330, w: 62, h: 62 } },   // floor 2 L
  plans:    { label: "Ballroom",    emoji: "📅", door: { x: 231, y: 318, w: 52, h: 78 } },   // floor 2 R
  gameroom: { label: "Game Room",   emoji: "🃏", door: { x: 107, y: 446, w: 52, h: 78 } },   // floor 3 L
  schmoney: { label: "Vault",       emoji: "💗", door: { x: 229, y: 468, w: 56, h: 56 } },   // floor 3 R
  joinme:   { label: "Zen Garden",  emoji: "🌿", door: { x: 107, y: 574, w: 52, h: 78 } },   // ground L
  more:     { label: "Workshop",    emoji: "🔧", door: { x: 231, y: 574, w: 52, h: 78 } },   // ground R
};

// door center in viewBox units — the avatar walk target (phase 2) + zoom origin
export const doorCenter = (key) => {
  const d = ROOMS[key].door;
  return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
};

/* Tap choreography — the Mario-64 beat, timer-driven end to end (never trust
   transitionend on iOS): idle → running (avatar walks to the door) → opening
   (leaf swings, warm light) → zooming (the world dives into the doorway) →
   onEnter(key). The hub then UNMOUNTS, so its zoom transform can never trap a
   room's position:fixed overlays. A second tap mid-walk retargets; taps during
   open/zoom are ignored; backgrounding mid-walk settles back to idle.
   Reduced motion short-circuits to a 120ms door brighten. */
const RUG = { x: 195, y: 684 };   // on the lawn, below the castle steps
export function CastleHub({ me, balances, badges = {}, onEnter }) {
  const [opening, setOpening] = useState(null);
  const [zoom, setZoom] = useState(null);            // {ox, oy} px transform-origin
  const [pos, setPos] = useState(RUG);               // avatar, viewBox units
  const [face, setFace] = useState(1);
  const [walking, setWalking] = useState(false);
  const [walkMs, setWalkMs] = useState(0);
  const wrapRef = useRef(null);
  const timers = useRef([]);
  const phase = useRef("idle");
  const heading = useRef(null);                      // door key mid-journey
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clearAll = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const openThenEnter = useCallback((key) => {
    phase.current = "opening";
    setWalking(false);
    setOpening(key);
    try { navigator.vibrate && navigator.vibrate(12); } catch {}
    later(() => {
      phase.current = "zooming";
      // dive into the doorway: origin at the door's on-screen center
      const el = wrapRef.current;
      if (el && !reduced) {
        const s = el.clientWidth / 390;
        const c = doorCenter(key);
        setZoom({ ox: c.x * s, oy: c.y * s + (el.querySelector(".castle-svg")?.offsetTop || 0) });
      }
      later(() => { phase.current = "idle"; clearAll(); onEnter(key); }, reduced ? 60 : 320);
    }, reduced ? 120 : 260);
  }, [onEnter, reduced]);

  const onDoor = useCallback((key) => {
    if (phase.current === "opening" || phase.current === "zooming") return;
    clearAll();
    heading.current = key;
    if (reduced) { openThenEnter(key); return; }
    // walk first: target just below the door, duration scaled by distance
    const d = ROOMS[key].door;
    const target = { x: d.x + d.w / 2, y: Math.min(d.y + d.h + 6, 690) };
    const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
    const ms = Math.max(260, Math.min(760, dist * 2.1));
    phase.current = "running";
    setFace(target.x < pos.x ? -1 : 1);
    setWalkMs(ms);
    setPos(target);
    setWalking(true);
    later(() => openThenEnter(key), ms + 40);
  }, [pos, reduced, openThenEnter]);

  // Backgrounded mid-journey → honor the tap: after a REAL absence (quick
  // hidden→visible blips like a notification-shade peek don't count), skip the
  // rest of the cinematic and land in the room they were headed to. Timers are
  // throttled while hidden, so "finish instantly on return" beats replaying.
  useEffect(() => {
    let hiddenAt = null;
    const onVis = () => {
      if (document.visibilityState === "hidden") { hiddenAt = hiddenAt || Date.now(); return; }
      if (phase.current !== "idle" && heading.current && hiddenAt && Date.now() - hiddenAt > 1500) {
        const key = heading.current;
        clearAll(); phase.current = "idle"; heading.current = null;
        onEnter(key);
      }
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); clearAll(); };
  }, [onEnter]);

  return html`<div ref=${wrapRef} class=${`castle-wrap ${zoom ? "zoom" : ""}`}
    style=${zoom ? `transform-origin:${zoom.ox}px ${zoom.oy}px` : ""}>
    <div class="castle-bg"></div>
    <${CastleSVG} opening=${opening} badges=${badges} onDoor=${onDoor} />
    <${SkyLife} />
    <div class=${`hub-avatar ${walking ? "walking" : ""} ${opening ? "entering" : ""}`}
      style=${`left:${(pos.x / 390 * 100).toFixed(2)}%; top:${(pos.y / 720 * 100).toFixed(2)}%; transition-duration:${walking ? walkMs : 0}ms`}>
      <span style=${`transform:scaleX(${face})`}><i>${(me && me.emoji) || "💗"}</i></span>
    </div>
  </div>`;
}

/* ---- sky life: clouds + birds ported from Collide's map, plus a hot-air
   balloon and a kite in the same ink-outline style. Everything lives in the
   band ABOVE the top row of windows (top ~24% of the scene), drifting across
   on slow linear loops; negative delays populate the sky from first paint. */
const rnd = (a, b) => a + Math.random() * (b - a);
const CLOUD_PATH = "M24 62 C11 62 5 52 12 43 C6 33 18 26 28 32 C30 17 50 13 58 25 C65 11 89 13 90 31 C107 29 115 45 103 55 C109 64 96 67 88 63 C80 67 32 67 24 62 Z";

function SkyLife() {
  const clouds = useMemo(() => Array.from({ length: 3 }, () => {
    const dur = rnd(85, 165);
    return { top: `${rnd(1, 16).toFixed(1)}%`, width: `${rnd(9, 18).toFixed(1)}%`,
      animationDuration: `${dur.toFixed(0)}s`, animationDelay: `-${rnd(0, dur).toFixed(0)}s`, opacity: rnd(0.68, 0.92).toFixed(2) };
  }), []);
  const birds = useMemo(() => {
    const out = [];
    for (let f = 0; f < 2; f++) {
      const n = f === 0 ? 3 : 1 + Math.floor(Math.random() * 2);
      const ltr = Math.random() < 0.5, dur = rnd(38, 72), delay = -rnd(0, dur);
      const yy = rnd(3, 17), drift = rnd(-4, 4), sz = rnd(1.4, 2.1), dx = ltr ? 112 : -112;
      for (let i = 0; i < n; i++) {
        const off = i * sz * 0.9 * (ltr ? -1 : 1);
        const vy = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * sz * 0.4;
        const x0 = (ltr ? -6 : 106) + off;
        out.push({ "--bx0": `${x0.toFixed(1)}%`, "--bx1": `${(x0 + dx).toFixed(1)}%`,
          "--by0": `${(yy + vy).toFixed(1)}%`, "--by1": `${(yy + vy + drift).toFixed(1)}%`,
          "--dur": `${dur.toFixed(0)}s`, "--delay": `${delay.toFixed(1)}s`,
          "--flap": `${rnd(0.5, 0.85).toFixed(2)}s`, "--flapd": `-${rnd(0, 0.8).toFixed(2)}s`,
          width: `${sz.toFixed(2)}%` });
      }
    }
    return out;
  }, []);
  const balloon = useMemo(() => ({ top: `${rnd(2, 9).toFixed(1)}%`,
    animationDuration: "150s", animationDelay: `-${rnd(0, 150).toFixed(0)}s` }), []);
  const kite = useMemo(() => ({ top: `${rnd(8, 15).toFixed(1)}%`,
    animationDuration: "95s", animationDelay: `-${rnd(0, 95).toFixed(0)}s` }), []);

  return html`<div class="castle-sky" aria-hidden="true">
    ${clouds.map((s, i) => html`<svg key=${`c${i}`} class="sky-cloud" style=${s} viewBox="0 0 120 74" fill="none">
      <path d=${CLOUD_PATH} fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>`)}
    ${birds.map((s, i) => html`<svg key=${`b${i}`} class="sky-bird" style=${s} viewBox="0 0 26 14">
      <path class="w1" d="M2 10 Q8 2 13 8 Q18 2 24 10" />
      <path class="w2" d="M2 6 Q8 10 13 7 Q18 10 24 6" />
    </svg>`)}
    <svg class="sky-balloon" style=${balloon} viewBox="0 0 60 84" fill="none">
      <g class="bob">
        <path d="M30 4 C13 4 6 18 6 30 C6 44 20 54 26 60 L34 60 C40 54 54 44 54 30 C54 18 47 4 30 4 Z"
          fill="#ff8fa3" stroke="#111" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        <path d="M22 5.5 C16 14 16 46 25 59 M38 5.5 C44 14 44 46 35 59" stroke="#cf4a63" stroke-width="2" fill="none" />
        <path d="M26 60 L27 70 M34 60 L33 70" stroke="#111" stroke-width="2" />
        <rect x="24" y="70" width="12" height="10" rx="2" fill="#e8c39e" stroke="#111" stroke-width="2.5" vector-effect="non-scaling-stroke" />
      </g>
    </svg>
    <svg class="sky-kite" style=${kite} viewBox="0 0 60 92" fill="none">
      <g class="sway">
        <path d="M30 4 L52 30 L30 56 L8 30 Z" fill="#ffd166" stroke="#111" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        <path d="M30 4 V56 M8 30 H52" stroke="#c9a227" stroke-width="1.6" />
        <path d="M30 56 C36 66 24 74 30 88" stroke="#111" stroke-width="2" fill="none" />
        <path d="M33 66 l6 -4 l-1 7 Z" fill="#ff8fa3" stroke="#111" stroke-width="1.6" />
        <path d="M25 78 l-6 -3 l2 7 Z" fill="#c4a6ff" stroke="#111" stroke-width="1.6" />
      </g>
    </svg>
  </div>`;
}

/* ---- the castle drawing ---------------------------------------------- */
// door group helper: hit rect + label live with the art
const Door = ({ k, opening, badge, onDoor, children }) => {
  const d = ROOMS[k].door;
  const cx = d.x + d.w / 2;
  return html`<g class=${`door ${opening === k ? "open" : ""}`} onClick=${() => onDoor(k)}>
    ${children}
    <text class="door-label" x=${cx} y=${d.y + d.h + 15}>${ROOMS[k].label.toUpperCase()}</text>
    ${badge && html`<g class="door-badge">
      <circle cx=${d.x + d.w - 2} cy=${d.y + 2} r="10" class="badge-halo" />
      ${typeof badge === "string"
        ? html`<text class="badge-emoji" x=${d.x + d.w - 2} y=${d.y + 8}>${badge}</text>`
        : html`<circle cx=${d.x + d.w - 2} cy=${d.y + 2} r="7.5" class="badge-dot" />`}
    </g>`}
    <rect class="door-hit" x=${cx - 34} y=${d.y - 8} width="68" height=${Math.max(d.h + 26, 68)} />
  </g>`;
};

function CastleSVG({ opening, badges, onDoor }) {
  return html`<svg class="castle-svg" viewBox="0 0 390 720" xmlns="http://www.w3.org/2000/svg" role="navigation" aria-label="Castle">
    <defs>
      <!-- the birthday book's hand-painted wobble -->
      <filter id="c-wc" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="5" />
      </filter>
      <filter id="c-wash" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="16" />
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
      <linearGradient id="c-glow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe9b8" />
        <stop offset="1" stop-color="#f7c97e" />
      </linearGradient>
    </defs>

    <!-- paper sky with soft washes, like a page from her book -->
    <rect x="0" y="0" width="390" height="720" fill="#faf5ef" />
    <ellipse cx="195" cy="86" rx="230" ry="86" fill="#cfe7f5" opacity=".4" filter="url(#c-wash)" />
    <ellipse cx="195" cy="400" rx="220" ry="200" fill="#ffd9cf" opacity=".26" filter="url(#c-wash)" />
    <ellipse cx="195" cy="676" rx="260" ry="46" fill="#cdeac0" opacity=".7" filter="url(#c-wash)" />

    <!-- sun with little rays -->
    <circle cx="336" cy="52" r="16" fill="#ffd166" filter="url(#c-wc)" />
    <g stroke="#ffd166" stroke-width="3" stroke-linecap="round" opacity=".8">
      <path d="M336 27 v-8" /><path d="M358 36 l6 -6" /><path d="M314 36 l-6 -6" /><path d="M361 52 h8" />
    </g>

    <!-- scattered stars + hearts (her book's confetti) -->
    <path transform="translate(44 54)" fill="#ff8fa3" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
    <path transform="translate(150 34) scale(.8)" fill="#ffd166" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
    <path transform="translate(248 48) scale(.7)" fill="#c4a6ff" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
    <path transform="translate(20 130) scale(1.1)" fill="#ff8fa3" opacity=".8" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />
    <path transform="translate(372 122)" fill="#c4a6ff" opacity=".7" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />

    <!-- lawn -->
    <rect x="0" y="652" width="390" height="68" fill="#cdeac0" filter="url(#c-wc)" />
    <ellipse cx="60" cy="666" rx="26" ry="7" fill="#7fb069" opacity=".5" />
    <ellipse cx="330" cy="670" rx="30" ry="8" fill="#7fb069" opacity=".45" />

    <!-- ONE castle silhouette (no interior seams — the door grid stays clean):
         two towers joined by a battlemented wall -->
    <path d="M50 652 V128 H140 V152 H156 V128 H186 V152 H204 V128 H234 V152 H250 V128 H340 V652 Z"
      fill="#fff4e6" stroke="#d9a173" stroke-width="2" filter="url(#c-wc)" />
    <!-- tower roofs + flags -->
    <g filter="url(#c-wc)">
      <path d="M40 132 L95 58 L150 132 Z" fill="#ff9e7d" stroke="#e07a5f" stroke-width="2" />
      <path d="M240 132 L295 58 L350 132 Z" fill="#ff9e7d" stroke="#e07a5f" stroke-width="2" />
    </g>
    <line x1="95" y1="58" x2="95" y2="38" stroke="#b96f4e" stroke-width="2" />
    <path d="M95 38 L118 45 L95 52 Z" fill="#ff8fa3" />
    <line x1="295" y1="58" x2="295" y2="38" stroke="#b96f4e" stroke-width="2" />
    <path d="M295 38 L318 45 L295 52 Z" fill="#ff8fa3" />

    <!-- rose window, top center -->
    <circle cx="195" cy="196" r="20" fill="#ffd9cf" stroke="#e07a5f" stroke-width="2" />
    <circle cx="195" cy="196" r="12" fill="none" stroke="#e07a5f" stroke-width="1.4" />
    <path transform="translate(195 196) scale(.75)" fill="#ff8fa3" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />

    <!-- floor lines: the grid's rows -->
    <g stroke="#e8dfd4" stroke-width="1.6">
      <line x1="56" y1="268" x2="334" y2="268" />
      <line x1="56" y1="396" x2="334" y2="396" />
      <line x1="56" y1="524" x2="334" y2="524" />
    </g>

    <!-- foyer checker floor, just above the ground line -->
    <g fill="#f0e8dd">
      <rect x="130" y="636" width="16" height="8"/><rect x="162" y="636" width="16" height="8"/>
      <rect x="194" y="636" width="16" height="8"/><rect x="226" y="636" width="16" height="8"/>
      <rect x="146" y="644" width="16" height="8"/><rect x="178" y="644" width="16" height="8"/>
      <rect x="210" y="644" width="16" height="8"/><rect x="242" y="644" width="16" height="8"/>
    </g>

    <!-- ============ the door grid: 2 columns × 4 floors ============ -->

    <!-- floor 1 L · 🔭 Observatory: arched window -->
    <${Door} k="map" opening=${opening} badge=${badges.map} onDoor=${onDoor}>
      <g class="leaf">
        <path d="M111 268 v-36 a22 22 0 0 1 44 0 v36 Z" fill="#cfe7f5" stroke="#d9a173" stroke-width="2" />
        <path d="M133 212 v56 M111 240 h44" stroke="#d9a173" stroke-width="1.3" />
      </g>
      <path d="M111 268 v-36 a22 22 0 0 1 44 0 v36 Z" fill="url(#c-glow)" class="doorlight" />
      <path d="M111 268 v-36 a22 22 0 0 1 44 0 v36 Z" fill="none" stroke="#d9a173" stroke-width="2" />
      <text class="door-glyph" x="133" y="246" font-size="17">🔭</text>
    <//>

    <!-- floor 1 R · ☀️ Sunroom: arched window -->
    <${Door} k="chapel" opening=${opening} badge=${null} onDoor=${onDoor}>
      <g class="leaf">
        <path d="M235 268 v-36 a22 22 0 0 1 44 0 v36 Z" fill="#cfe7f5" stroke="#d9a173" stroke-width="2" />
        <path d="M257 212 v56 M235 240 h44" stroke="#d9a173" stroke-width="1.3" />
      </g>
      <path d="M235 268 v-36 a22 22 0 0 1 44 0 v36 Z" fill="url(#c-glow)" class=${`doorlight ${badges.chapel ? "lit" : ""}`} />
      <path d="M235 268 v-36 a22 22 0 0 1 44 0 v36 Z" fill="none" stroke="#d9a173" stroke-width="2" />
      <text class="door-glyph" x="257" y="246" font-size="17">☀️</text>
    <//>

    <!-- floor 2 L · 🖼 Gallery: gold-framed watercolor, hung above the line -->
    <${Door} k="memories" opening=${opening} badge=${badges.memories} onDoor=${onDoor}>
      <rect x="102" y="330" width="62" height="62" rx="4" fill="#e8c39e" stroke="#c9a227" stroke-width="2" />
      <rect x="108" y="336" width="50" height="50" rx="2" fill="#fffdfb" />
      <g class="leaf">
        <rect x="108" y="336" width="50" height="50" rx="2" fill="#cfe7f5" />
        <circle cx="147" cy="347" r="5" fill="#ffd166" />
        <path d="M108 372 q12 -12 24 -3 q13 10 26 -8 v25 h-50 Z" fill="#7fb069" opacity=".85" />
        <path d="M108 378 q16 -9 28 0 q12 8 22 -2 v10 h-50 Z" fill="#cdeac0" />
      </g>
      <rect x="108" y="336" width="50" height="50" rx="2" fill="url(#c-glow)" class="doorlight" />
      <rect x="108" y="336" width="50" height="50" rx="2" fill="none" stroke="#d9a173" stroke-width="1.3" />
      <text class="door-glyph" x="133" y="366" font-size="16">🖼️</text>
    <//>

    <!-- floor 2 R · 💃 Ballroom: double door, gold knobs -->
    <${Door} k="plans" opening=${opening} badge=${badges.plans} onDoor=${onDoor}>
      <path d="M231 396 v-52 a26 26 0 0 1 52 0 v52 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M231 396 v-52 a26 26 0 0 1 52 0 v52 Z" fill="#b96f4e" />
        <line x1="257" y1="320" x2="257" y2="396" stroke="#8a5a44" stroke-width="1.6" />
        <circle cx="251" cy="362" r="2.4" fill="#ffd166" /><circle cx="263" cy="362" r="2.4" fill="#ffd166" />
      </g>
      <path d="M231 396 v-52 a26 26 0 0 1 52 0 v52 Z" fill="none" stroke="#8a5a44" stroke-width="2" />
      <text class="door-glyph" x="257" y="372" font-size="17">📅</text>
    <//>

    <!-- floor 3 L · 🎴 Game Room: arch door -->
    <${Door} k="gameroom" opening=${opening} badge=${badges.gameroom} onDoor=${onDoor}>
      <path d="M107 524 v-52 a26 26 0 0 1 52 0 v52 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M107 524 v-52 a26 26 0 0 1 52 0 v52 Z" fill="#b96f4e" />
        <path d="M114 521 v-47 a19 19 0 0 1 38 0 v47 Z" fill="none" stroke="#8a5a44" stroke-width="1.1" opacity=".55" />
        <circle cx="151" cy="490" r="2.4" fill="#ffd166" />
      </g>
      <path d="M107 524 v-52 a26 26 0 0 1 52 0 v52 Z" fill="none" stroke="#8a5a44" stroke-width="2" />
      <text class="door-glyph" x="133" y="500" font-size="17">🃏</text>
    <//>

    <!-- floor 3 R · 💗 Vault: round pink door -->
    <${Door} k="schmoney" opening=${opening} badge=${badges.schmoney} onDoor=${onDoor}>
      <circle cx="257" cy="496" r="28" fill="url(#c-glow)" />
      <g class="leaf">
        <circle cx="257" cy="496" r="28" fill="#ff8fa3" />
        <circle cx="257" cy="496" r="20" fill="none" stroke="#cf4a63" stroke-width="1.6" opacity=".7" />
        <circle cx="257" cy="496" r="24" fill="none" stroke="#ffd166" stroke-width="1.4" stroke-dasharray="1 6" stroke-linecap="round" />
      </g>
      <circle cx="257" cy="496" r="28" fill="none" stroke="#cf4a63" stroke-width="2" />
      <text class="door-glyph" x="257" y="503" font-size="17">💗</text>
    <//>

    <!-- ground L · 🌿 Garden: green gate -->
    <${Door} k="joinme" opening=${opening} badge=${badges.joinme} onDoor=${onDoor}>
      <path d="M107 652 v-52 a26 26 0 0 1 52 0 v52 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M107 652 v-52 a26 26 0 0 1 52 0 v52 Z" fill="#cdeac0" />
        <g stroke="#7fb069" stroke-width="2.6" stroke-linecap="round">
          <path d="M114 650 v-44 M126 650 v-51 M140 650 v-51 M152 650 v-44" />
        </g>
        <circle cx="117" cy="646" r="2.8" fill="#ff8fa3" />
        <circle cx="149" cy="643" r="2.5" fill="#ffd166" />
      </g>
      <path d="M107 652 v-52 a26 26 0 0 1 52 0 v52 Z" fill="none" stroke="#7fb069" stroke-width="2" />
      <text class="door-glyph" x="133" y="628" font-size="15">🌿</text>
    <//>

    <!-- ground R · 🔧 Workshop: arch door in darker wood, iron cross-braces -->
    <${Door} k="more" opening=${opening} badge=${badges.more} onDoor=${onDoor}>
      <path d="M231 652 v-52 a26 26 0 0 1 52 0 v52 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M231 652 v-52 a26 26 0 0 1 52 0 v52 Z" fill="#8a5a44" />
        <line x1="236" y1="612" x2="278" y2="612" stroke="#b96f4e" stroke-width="2" />
        <line x1="236" y1="634" x2="278" y2="634" stroke="#b96f4e" stroke-width="2" />
        <circle cx="275" cy="618" r="2.4" fill="#ffd166" />
      </g>
      <path d="M231 652 v-52 a26 26 0 0 1 52 0 v52 Z" fill="none" stroke="#8a5a44" stroke-width="2" />
      <text class="door-glyph" x="257" y="628" font-size="16">🔧</text>
    <//>

    <!-- the player's starting spot: a soft circle in the grass -->
    <ellipse cx="195" cy="687" rx="34" ry="9" fill="#7fb069" opacity=".45" />
    <ellipse cx="195" cy="687" rx="22" ry="6" fill="#fdf1e7" opacity=".85" />
  </svg>`;
}
