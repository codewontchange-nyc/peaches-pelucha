import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useRef, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🏰 The Castle — the app's hub world (Mario 64 energy, storybook flat-vector
   art, all original). One phone screen: a cutaway castle whose doors ARE the
   navigation. Tap a door → it glows open → the room mounts. The ROOMS registry
   is the single source of truth for door geometry (SVG viewBox units), labels,
   and badge anchors; app.js reads it for room titles too.
   viewBox is 0 0 390 720 (drawn under the ~64px sticky topbar). */

/* Door bases sit ON their floor lines (292 / 456 / 592 / foyer 648) — windows
   (observatory porthole, sunroom) and the hanging painting are the exceptions,
   since windows and paintings live mid-wall. Door proportions follow the
   birthday-book house: slim arches ~1:1.8, thin warm-tan strokes, gold knobs. */
export const ROOMS = {
  gameroom: { label: "Game Room",   emoji: "🎴", door: { x: 52,  y: 486, w: 64,  h: 106 } },
  chapel:   { label: "Sunroom",     emoji: "☀️", door: { x: 295, y: 168, w: 48,  h: 88 } },
  plans:    { label: "Ballroom",    emoji: "💃", door: { x: 228, y: 328, w: 96,  h: 128 } },
  map:      { label: "Observatory", emoji: "🔭", door: { x: 43,  y: 175, w: 56,  h: 56 } },
  memories: { label: "Gallery",     emoji: "🖼️", door: { x: 58,  y: 318, w: 108, h: 108 } },
  schmoney: { label: "Vault",       emoji: "💗", door: { x: 214, y: 508, w: 80,  h: 80 } },
  joinme:   { label: "Garden",      emoji: "🌿", door: { x: 330, y: 502, w: 42,  h: 90 } },
  more:     { label: "Workshop",    emoji: "🔧", door: { x: 170, y: 608, w: 50,  h: 36 } },
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
    const target = { x: d.x + d.w / 2, y: Math.min(d.y + d.h + 6, 648) };
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
    <div class=${`hub-avatar ${walking ? "walking" : ""} ${opening ? "entering" : ""}`}
      style=${`left:${(pos.x / 390 * 100).toFixed(2)}%; top:${(pos.y / 720 * 100).toFixed(2)}%; transition-duration:${walking ? walkMs : 0}ms`}>
      <span style=${`transform:scaleX(${face})`}><i>${(me && me.emoji) || "💗"}</i></span>
    </div>
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
    <ellipse cx="195" cy="90" rx="230" ry="90" fill="#cfe7f5" opacity=".4" filter="url(#c-wash)" />
    <ellipse cx="195" cy="400" rx="220" ry="200" fill="#ffd9cf" opacity=".28" filter="url(#c-wash)" />
    <ellipse cx="195" cy="676" rx="260" ry="46" fill="#cdeac0" opacity=".7" filter="url(#c-wash)" />

    <!-- sun with little rays -->
    <circle cx="336" cy="56" r="18" fill="#ffd166" filter="url(#c-wc)" />
    <g stroke="#ffd166" stroke-width="3" stroke-linecap="round" opacity=".8">
      <path d="M336 28 v-9" /><path d="M360 38 l7 -7" /><path d="M312 38 l-7 -7" /><path d="M364 56 h9" />
    </g>

    <!-- scattered stars + hearts (her book's confetti) -->
    <path transform="translate(46 60)" fill="#ff8fa3" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
    <path transform="translate(140 36) scale(.8)" fill="#ffd166" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
    <path transform="translate(250 52) scale(.7)" fill="#c4a6ff" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
    <path transform="translate(22 118) scale(1.1)" fill="#ff8fa3" opacity=".8" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />
    <path transform="translate(372 130)" fill="#c4a6ff" opacity=".7" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />

    <!-- lawn -->
    <rect x="0" y="652" width="390" height="68" fill="#cdeac0" filter="url(#c-wc)" />
    <ellipse cx="60" cy="668" rx="26" ry="7" fill="#7fb069" opacity=".5" />
    <ellipse cx="330" cy="672" rx="30" ry="8" fill="#7fb069" opacity=".45" />

    <!-- towers -->
    <g stroke="#d9a173" stroke-width="2" filter="url(#c-wc)">
      <rect x="24" y="112" width="94" height="548" fill="#fff4e6" />
      <rect x="272" y="112" width="94" height="548" fill="#fff4e6" />
      <path d="M14 116 L71 42 L128 116 Z" fill="#ff9e7d" stroke="#e07a5f" />
      <path d="M262 116 L319 42 L376 116 Z" fill="#ff9e7d" stroke="#e07a5f" />
    </g>
    <line x1="71" y1="42" x2="71" y2="22" stroke="#b96f4e" stroke-width="2" />
    <path d="M71 22 L95 29 L71 36 Z" fill="#ff8fa3" />
    <line x1="319" y1="42" x2="319" y2="22" stroke="#b96f4e" stroke-width="2" />
    <path d="M319 22 L343 29 L319 36 Z" fill="#ff8fa3" />

    <!-- keep + battlements -->
    <rect x="102" y="158" width="186" height="502" fill="#fff4e6" stroke="#d9a173" stroke-width="2" filter="url(#c-wc)" />
    <g fill="#fff4e6" stroke="#d9a173" stroke-width="2">
      <rect x="104" y="144" width="24" height="15" /><rect x="144" y="144" width="24" height="15" />
      <rect x="184" y="144" width="24" height="15" /><rect x="224" y="144" width="24" height="15" />
      <rect x="262" y="144" width="24" height="15" />
    </g>
    <!-- rose window -->
    <circle cx="195" cy="214" r="24" fill="#ffd9cf" stroke="#e07a5f" stroke-width="2" />
    <circle cx="195" cy="214" r="15" fill="none" stroke="#e07a5f" stroke-width="1.6" />
    <path d="M195 199 v30 M180 214 h30" stroke="#e07a5f" stroke-width="1.4" />
    <path transform="translate(195 214) scale(.8)" fill="#ff8fa3" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />

    <!-- floor lines (cutaway hint) -->
    <g stroke="#e8dfd4" stroke-width="1.6">
      <line x1="30" y1="292" x2="360" y2="292" />
      <line x1="30" y1="456" x2="360" y2="456" />
      <line x1="30" y1="592" x2="360" y2="592" />
    </g>

    <!-- foyer checker floor -->
    <g fill="#f0e8dd">
      <rect x="120" y="644" width="18" height="10"/><rect x="156" y="644" width="18" height="10"/>
      <rect x="192" y="644" width="18" height="10"/><rect x="228" y="644" width="18" height="10"/>
      <rect x="138" y="654" width="18" height="6"/><rect x="174" y="654" width="18" height="6"/>
      <rect x="210" y="654" width="18" height="6"/><rect x="246" y="654" width="18" height="6"/>
    </g>

    <!-- ================= doors (registry-driven) ================= -->

    <!-- 🔭 Observatory: round porthole window, pale-blue glass -->
    <${Door} k="map" opening=${opening} badge=${badges.map} onDoor=${onDoor}>
      <g class="leaf">
        <circle cx="71" cy="203" r="28" fill="#cfe7f5" stroke="#d9a173" stroke-width="2" />
        <path d="M71 175 v56 M43 203 h56" stroke="#d9a173" stroke-width="1.4" />
      </g>
      <circle cx="71" cy="203" r="28" fill="url(#c-glow)" class="doorlight" />
      <circle cx="71" cy="203" r="28" fill="none" stroke="#d9a173" stroke-width="2" />
      <text class="door-glyph" x="71" y="211" font-size="20">🔭</text>
    <//>

    <!-- ☀️ Sunroom: arched window, pale-blue glass -->
    <${Door} k="chapel" opening=${opening} badge=${null} onDoor=${onDoor}>
      <g class="leaf">
        <path d="M295 256 v-64 a24 24 0 0 1 48 0 v64 Z" fill="#cfe7f5" stroke="#d9a173" stroke-width="2" />
        <path d="M319 172 v84 M295 214 h48" stroke="#d9a173" stroke-width="1.4" />
      </g>
      <path d="M295 256 v-64 a24 24 0 0 1 48 0 v64 Z" fill="url(#c-glow)" class=${`doorlight ${badges.chapel ? "lit" : ""}`} />
      <path d="M295 256 v-64 a24 24 0 0 1 48 0 v64 Z" fill="none" stroke="#d9a173" stroke-width="2" />
      <text class="door-glyph" x="319" y="224" font-size="19">☀️</text>
    <//>

    <!-- 🖼 Gallery: a little watercolor in a gold frame (frame stays; canvas lights) -->
    <${Door} k="memories" opening=${opening} badge=${badges.memories} onDoor=${onDoor}>
      <rect x="58" y="318" width="108" height="108" rx="5" fill="#e8c39e" stroke="#c9a227" stroke-width="2.5" />
      <rect x="66" y="326" width="92" height="92" rx="3" fill="#fffdfb" />
      <g class="leaf">
        <rect x="66" y="326" width="92" height="92" rx="3" fill="#cfe7f5" />
        <circle cx="138" cy="346" r="8" fill="#ffd166" />
        <path d="M66 392 q22 -22 44 -6 q24 18 48 -14 v46 h-92 Z" fill="#7fb069" opacity=".85" />
        <path d="M66 402 q30 -16 52 0 q22 14 40 -4 v20 h-92 Z" fill="#cdeac0" />
      </g>
      <rect x="66" y="326" width="92" height="92" rx="3" fill="url(#c-glow)" class="doorlight" />
      <rect x="66" y="326" width="92" height="92" rx="3" fill="none" stroke="#d9a173" stroke-width="1.4" />
      <text class="door-glyph" x="112" y="380" font-size="20">🖼️</text>
    <//>

    <!-- 💃 Ballroom: tall double doors, warm wood + gold knobs -->
    <${Door} k="plans" opening=${opening} badge=${badges.plans} onDoor=${onDoor}>
      <path d="M228 456 v-80 a48 48 0 0 1 96 0 v80 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M228 456 v-80 a48 48 0 0 1 96 0 v80 Z" fill="#b96f4e" />
        <line x1="276" y1="330" x2="276" y2="456" stroke="#8a5a44" stroke-width="2" />
        <path d="M240 452 v-72 a36 36 0 0 1 32 -22 v94 Z" fill="none" stroke="#8a5a44" stroke-width="1.3" opacity=".55" />
        <path d="M312 452 v-72 a36 36 0 0 0 -32 -22 v94 Z" fill="none" stroke="#8a5a44" stroke-width="1.3" opacity=".55" />
        <circle cx="268" cy="400" r="3" fill="#ffd166" /><circle cx="284" cy="400" r="3" fill="#ffd166" />
      </g>
      <path d="M228 456 v-80 a48 48 0 0 1 96 0 v80 Z" fill="none" stroke="#8a5a44" stroke-width="2" />
      <text class="door-glyph" x="276" y="416" font-size="22">💃</text>
    <//>

    <!-- 🎴 Game Room: slim arch door, storybook proportions -->
    <${Door} k="gameroom" opening=${opening} badge=${badges.gameroom} onDoor=${onDoor}>
      <path d="M52 592 v-74 a32 32 0 0 1 64 0 v74 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M52 592 v-74 a32 32 0 0 1 64 0 v74 Z" fill="#b96f4e" />
        <path d="M62 588 v-68 a22 22 0 0 1 44 0 v68 Z" fill="none" stroke="#8a5a44" stroke-width="1.3" opacity=".55" />
        <circle cx="106" cy="548" r="3" fill="#ffd166" />
      </g>
      <path d="M52 592 v-74 a32 32 0 0 1 64 0 v74 Z" fill="none" stroke="#8a5a44" stroke-width="2" />
      <text class="door-glyph" x="84" y="556" font-size="21">🎴</text>
    <//>

    <!-- 💗 Vault: round pink door with a gold heart lock -->
    <${Door} k="schmoney" opening=${opening} badge=${badges.schmoney} onDoor=${onDoor}>
      <circle cx="254" cy="548" r="40" fill="url(#c-glow)" />
      <g class="leaf">
        <circle cx="254" cy="548" r="40" fill="#ff8fa3" />
        <circle cx="254" cy="548" r="29" fill="none" stroke="#cf4a63" stroke-width="2" opacity=".7" />
        <circle cx="254" cy="548" r="35" fill="none" stroke="#ffd166" stroke-width="1.6" stroke-dasharray="1 8" stroke-linecap="round" />
      </g>
      <circle cx="254" cy="548" r="40" fill="none" stroke="#cf4a63" stroke-width="2" />
      <text class="door-glyph" x="254" y="557" font-size="22">💗</text>
    <//>

    <!-- 🌿 Garden: a green gate you can peek through -->
    <${Door} k="joinme" opening=${opening} badge=${badges.joinme} onDoor=${onDoor}>
      <path d="M330 592 v-62 a21 21 0 0 1 42 0 v62 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M330 592 v-62 a21 21 0 0 1 42 0 v62 Z" fill="#cdeac0" />
        <g stroke="#7fb069" stroke-width="3" stroke-linecap="round">
          <path d="M336 590 v-54 M345 590 v-61 M357 590 v-61 M366 590 v-54" />
        </g>
        <circle cx="339" cy="586" r="3.4" fill="#ff8fa3" />
        <circle cx="362" cy="582" r="3" fill="#ffd166" />
      </g>
      <path d="M330 592 v-62 a21 21 0 0 1 42 0 v62 Z" fill="none" stroke="#7fb069" stroke-width="2" />
      <text class="door-glyph" x="351" y="564" font-size="17">🌿</text>
    <//>

    <!-- 🔧 Workshop: little cellar hatch in the foyer -->
    <${Door} k="more" opening=${opening} badge=${badges.more} onDoor=${onDoor}>
      <rect x="170" y="608" width="50" height="36" rx="6" fill="url(#c-glow)" />
      <g class="leaf">
        <rect x="170" y="608" width="50" height="36" rx="6" fill="#8a5a44" />
        <line x1="178" y1="617" x2="212" y2="617" stroke="#b96f4e" stroke-width="2" />
        <circle cx="210" cy="629" r="2.6" fill="#ffd166" />
      </g>
      <rect x="170" y="608" width="50" height="36" rx="6" fill="none" stroke="#8a5a44" stroke-width="2" />
      <text class="door-glyph" x="195" y="634" font-size="15">🔧</text>
    <//>

    <!-- the player's starting spot: a soft circle in the grass -->
    <ellipse cx="195" cy="687" rx="34" ry="9" fill="#7fb069" opacity=".45" />
    <ellipse cx="195" cy="687" rx="22" ry="6" fill="#fdf1e7" opacity=".85" />
  </svg>`;
}
