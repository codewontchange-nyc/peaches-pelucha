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
   since windows and paintings live mid-wall. */
export const ROOMS = {
  gameroom: { label: "Game Room",   emoji: "🎴", door: { x: 48,  y: 482, w: 78,  h: 110 } },
  chapel:   { label: "Sunroom",     emoji: "☀️", door: { x: 286, y: 162, w: 52,  h: 94 } },
  plans:    { label: "Ballroom",    emoji: "💃", door: { x: 224, y: 324, w: 104, h: 132 } },
  map:      { label: "Observatory", emoji: "🔭", door: { x: 41,  y: 173, w: 60,  h: 60 } },
  memories: { label: "Gallery",     emoji: "🖼️", door: { x: 56,  y: 316, w: 112, h: 112 } },
  schmoney: { label: "Vault",       emoji: "💗", door: { x: 210, y: 498, w: 88,  h: 88 } },
  joinme:   { label: "Garden",      emoji: "🌿", door: { x: 328, y: 500, w: 44,  h: 92 } },
  more:     { label: "Workshop",    emoji: "🔧", door: { x: 168, y: 606, w: 54,  h: 40 } },
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
const RUG = { x: 150, y: 640 };
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
      <linearGradient id="c-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22344a" />
        <stop offset=".62" stop-color="#3d5670" />
        <stop offset="1" stop-color="#59728b" />
      </linearGradient>
      <linearGradient id="c-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f8f2e9" />
        <stop offset="1" stop-color="#efe5d6" />
      </linearGradient>
      <linearGradient id="c-glow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe9b8" />
        <stop offset="1" stop-color="#f7c97e" />
      </linearGradient>
      <linearGradient id="c-paint" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7fa3c0" />
        <stop offset="1" stop-color="#cfdde8" />
      </linearGradient>
    </defs>

    <!-- sky -->
    <rect x="0" y="0" width="390" height="720" fill="url(#c-sky)" />
    <g fill="#fdf6e3" opacity=".85">
      <circle cx="38" cy="46" r="1.6"/><circle cx="96" cy="24" r="1.2"/><circle cx="152" cy="58" r="1.4"/>
      <circle cx="238" cy="30" r="1.2"/><circle cx="300" cy="52" r="1.6"/><circle cx="354" cy="26" r="1.2"/>
      <circle cx="192" cy="18" r="1.1"/><circle cx="330" cy="86" r="1.1"/><circle cx="64" cy="88" r="1.1"/>
    </g>
    <circle cx="330" cy="64" r="17" fill="#f7ecd2" opacity=".95" />
    <circle cx="324" cy="58" r="4" fill="#e8dcbc" opacity=".6" />

    <!-- lawn -->
    <rect x="0" y="648" width="390" height="72" fill="#2c4438" />
    <ellipse cx="195" cy="652" rx="260" ry="16" fill="#35513f" />

    <!-- towers -->
    <g stroke="#3a2f28" stroke-width="2">
      <rect x="24" y="112" width="94" height="548" fill="url(#c-wall)" />
      <rect x="272" y="112" width="94" height="548" fill="url(#c-wall)" />
      <path d="M14 116 L71 44 L128 116 Z" fill="#c15f3c" />
      <path d="M262 116 L319 44 L376 116 Z" fill="#c15f3c" />
    </g>
    <line x1="71" y1="44" x2="71" y2="24" stroke="#3a2f28" stroke-width="2" />
    <path d="M71 24 L96 31 L71 38 Z" fill="#e8a48f" stroke="#3a2f28" stroke-width="1.5" />
    <line x1="319" y1="44" x2="319" y2="24" stroke="#3a2f28" stroke-width="2" />
    <path d="M319 24 L344 31 L319 38 Z" fill="#e8a48f" stroke="#3a2f28" stroke-width="1.5" />

    <!-- keep (center block) + battlements -->
    <rect x="102" y="158" width="186" height="502" fill="url(#c-wall)" stroke="#3a2f28" stroke-width="2" />
    <g fill="#efe5d6" stroke="#3a2f28" stroke-width="2">
      <rect x="102" y="144" width="26" height="16" /><rect x="142" y="144" width="26" height="16" />
      <rect x="182" y="144" width="26" height="16" /><rect x="222" y="144" width="26" height="16" />
      <rect x="262" y="144" width="26" height="16" />
    </g>
    <!-- rose window -->
    <circle cx="195" cy="216" r="26" fill="#f3d9c8" stroke="#3a2f28" stroke-width="2" />
    <circle cx="195" cy="216" r="16" fill="none" stroke="#c15f3c" stroke-width="2" />
    <path d="M195 200 v32 M179 216 h32 M184 205 l22 22 M206 205 l-22 22" stroke="#c15f3c" stroke-width="1.6" />

    <!-- floor lines (cutaway hint) -->
    <g stroke="#d8c9b4" stroke-width="1.5">
      <line x1="30" y1="292" x2="360" y2="292" />
      <line x1="30" y1="456" x2="360" y2="456" />
      <line x1="30" y1="592" x2="360" y2="592" />
    </g>

    <!-- foyer checker floor -->
    <g fill="#e2d4bf" opacity=".8">
      <rect x="120" y="644" width="18" height="10"/><rect x="156" y="644" width="18" height="10"/>
      <rect x="192" y="644" width="18" height="10"/><rect x="228" y="644" width="18" height="10"/>
      <rect x="138" y="654" width="18" height="6"/><rect x="174" y="654" width="18" height="6"/>
      <rect x="210" y="654" width="18" height="6"/><rect x="246" y="654" width="18" height="6"/>
    </g>

    <!-- ================= doors (registry-driven) ================= -->

    <!-- 🔭 Observatory: round porthole in the left tower -->
    <${Door} k="map" opening=${opening} badge=${badges.map} onDoor=${onDoor}>
      <circle cx="71" cy="203" r="30" fill="#20344a" stroke="#3a2f28" stroke-width="2.5" class="leaf" />
      <circle cx="71" cy="203" r="30" fill="url(#c-glow)" class="doorlight" />
      <circle cx="71" cy="203" r="22" fill="none" stroke="#b9852e" stroke-width="2" />
      <text class="door-glyph" x="71" y="211" font-size="22">🔭</text>
    <//>

    <!-- ☀️ Sunroom: arched window in the right tower -->
    <!-- an unanswered daily question lights this window from inside (no dot) -->
    <${Door} k="chapel" opening=${opening} badge=${null} onDoor=${onDoor}>
      <path d="M286 256 v-68 a26 26 0 0 1 52 0 v68 Z" fill="#2c4054" stroke="#3a2f28" stroke-width="2.5" class="leaf" />
      <path d="M286 256 v-68 a26 26 0 0 1 52 0 v68 Z" fill="url(#c-glow)" class=${`doorlight ${badges.chapel ? "lit" : ""}`} />
      <line x1="312" y1="188" x2="312" y2="256" stroke="#b9852e" stroke-width="2" />
      <text class="door-glyph" x="312" y="228" font-size="22">☀️</text>
    <//>

    <!-- 🖼 Gallery: the gilt painting you jump into (frame stays; canvas lights) -->
    <${Door} k="memories" opening=${opening} badge=${badges.memories} onDoor=${onDoor}>
      <rect x="56" y="316" width="112" height="112" rx="6" fill="#b9852e" stroke="#3a2f28" stroke-width="2.5" />
      <rect x="66" y="326" width="92" height="92" rx="3" fill="url(#c-paint)" class="leaf" />
      <path d="M66 396 q24 -26 46 -6 q22 20 46 -12 v40 h-92 Z" fill="#4c7a5e" class="leaf" />
      <circle cx="140" cy="346" r="9" fill="#fdf6e3" class="leaf" />
      <rect x="66" y="326" width="92" height="92" rx="3" fill="url(#c-glow)" class="doorlight" />
      <text class="door-glyph" x="112" y="380" font-size="22">🖼️</text>
    <//>

    <!-- 💃 Ballroom: tall double doors seated on the floor -->
    <${Door} k="plans" opening=${opening} badge=${badges.plans} onDoor=${onDoor}>
      <path d="M224 456 v-102 a52 52 0 0 1 104 0 v102 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M224 456 v-102 a52 52 0 0 1 104 0 v102 Z" fill="#8a4a33" stroke="#3a2f28" stroke-width="2.5" />
        <line x1="276" y1="352" x2="276" y2="456" stroke="#3a2f28" stroke-width="2" />
        <circle cx="266" cy="408" r="3.5" fill="#e8c98f" /><circle cx="286" cy="408" r="3.5" fill="#e8c98f" />
      </g>
      <path d="M224 456 v-102 a52 52 0 0 1 104 0 v102 Z" fill="none" stroke="#3a2f28" stroke-width="2.5" />
      <text class="door-glyph" x="276" y="416" font-size="24">💃</text>
    <//>

    <!-- 🎴 Game Room: arched door seated on the floor -->
    <${Door} k="gameroom" opening=${opening} badge=${badges.gameroom} onDoor=${onDoor}>
      <path d="M48 592 v-71 a39 39 0 0 1 78 0 v71 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M48 592 v-71 a39 39 0 0 1 78 0 v71 Z" fill="#5b3b2c" stroke="#3a2f28" stroke-width="2.5" />
        <circle cx="112" cy="556" r="3.5" fill="#e8c98f" />
      </g>
      <path d="M48 592 v-71 a39 39 0 0 1 78 0 v71 Z" fill="none" stroke="#3a2f28" stroke-width="2.5" />
      <text class="door-glyph" x="87" y="564" font-size="24">🎴</text>
    <//>

    <!-- 💗 Vault: round door resting on the floor -->
    <${Door} k="schmoney" opening=${opening} badge=${badges.schmoney} onDoor=${onDoor}>
      <circle cx="254" cy="542" r="44" fill="url(#c-glow)" />
      <g class="leaf">
        <circle cx="254" cy="542" r="44" fill="#7d8894" stroke="#3a2f28" stroke-width="2.5" />
        <circle cx="254" cy="542" r="33" fill="none" stroke="#5c6670" stroke-width="3" />
        <circle cx="254" cy="542" r="44" fill="none" stroke="#b9852e" stroke-width="1.5" stroke-dasharray="3 7" />
      </g>
      <circle cx="254" cy="542" r="44" fill="none" stroke="#3a2f28" stroke-width="2.5" />
      <text class="door-glyph" x="254" y="552" font-size="24">💗</text>
    <//>

    <!-- 🌿 Garden: gate at the right edge, seated on the floor -->
    <${Door} k="joinme" opening=${opening} badge=${badges.joinme} onDoor=${onDoor}>
      <path d="M328 592 v-62 a22 22 0 0 1 44 0 v62 Z" fill="url(#c-glow)" />
      <g class="leaf">
        <path d="M328 592 v-62 a22 22 0 0 1 44 0 v62 Z" fill="#24404f" stroke="#3a2f28" stroke-width="2.5" />
        <g stroke="#4c7a5e" stroke-width="3" stroke-linecap="round">
          <path d="M334 592 v-56 M344 592 v-62 M356 592 v-62 M366 592 v-56" />
        </g>
      </g>
      <path d="M328 592 v-62 a22 22 0 0 1 44 0 v62 Z" fill="none" stroke="#3a2f28" stroke-width="2.5" />
      <text class="door-glyph" x="350" y="566" font-size="20">🌿</text>
    <//>

    <!-- 🔧 Workshop: basement hatch in the foyer floor -->
    <${Door} k="more" opening=${opening} badge=${badges.more} onDoor=${onDoor}>
      <rect x="168" y="606" width="54" height="40" rx="6" fill="url(#c-glow)" />
      <g class="leaf">
        <rect x="168" y="606" width="54" height="40" rx="6" fill="#4a423a" stroke="#3a2f28" stroke-width="2.5" />
        <line x1="176" y1="616" x2="214" y2="616" stroke="#6a5f52" stroke-width="2" />
      </g>
      <rect x="168" y="606" width="54" height="40" rx="6" fill="none" stroke="#3a2f28" stroke-width="2.5" />
      <text class="door-glyph" x="195" y="634" font-size="16">🔧</text>
    <//>

    <!-- avatar rug -->
    <ellipse cx="150" cy="649" rx="34" ry="9" fill="#c15f3c" opacity=".55" />
  </svg>`;
}
