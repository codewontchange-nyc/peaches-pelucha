import { h } from "https://esm.sh/preact@10.23.2";
import { useEffect, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🗺💎 The Gem Quest journey map — a winding path of cloud-stops climbing from
   the castle lawn into the stars (the UFO-map beat, storybook style). Cleared
   stops show their stars; the current stop pulses; your partner's balloon
   floats at their frontier. Scrolls bottom-up; any cleared stop replays. */

const STOP_GAP = 96;                     // px between stops (vertical)
const xFor = (i) => 50 + 33 * Math.sin(i * 0.9);   // % across, winding

export function GemMap({ me, partner, prog, onPlay, onClose }) {
  const scroller = useRef(null);

  const mine = new Map();
  const theirsSet = new Map();
  (prog || []).forEach((r) => {
    if (r.player_id === me.id) mine.set(r.level, r);
    else if (partner && r.player_id === partner.id) theirsSet.set(r.level, r);
  });
  const myMax = [...mine.keys()].reduce((m, l) => Math.max(m, l), 0);
  const theirMax = [...theirsSet.keys()].reduce((m, l) => Math.max(m, l), 0);
  const current = myMax + 1;
  const top = Math.max(current, theirMax + 1) + 6;   // a little sky above the frontier

  // stops from 1 (bottom) to `top`; the column is drawn top-down, so reverse
  const stops = [];
  for (let l = top; l >= 1; l--) stops.push(l);
  const yFor = (l) => (top - l) * STOP_GAP + 60;      // px from the top of the column
  const height = top * STOP_GAP + 140;

  // open scrolled to the current stop
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, yFor(current) - el.clientHeight * 0.6);
  }, []);   // eslint-disable-line

  // the winding path as one SVG polyline through every stop
  const pathD = stops.map((l, i) => {
    const x = xFor(l), y = yFor(l);
    return (i === 0 ? "M" : "L") + " " + x + " " + y;
  }).join(" ");

  return html`<div class="gamefs gemmapfs">
    <div class="gamefs-bar">
      <button class="iconbtn" onClick=${onClose}>✕</button>
      <div class="gemfs-title">💎 The Journey</div>
      <div class="gemfs-score tnum">lvl ${current}</div>
    </div>
    <div class="gemmap-scroll" ref=${scroller}>
      <div class="gemmap-col" style=${`height:${height}px`}>
        <svg class="gemmap-path" viewBox=${`0 0 100 ${height}`} preserveAspectRatio="none">
          <path d=${pathD} fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2.5"
            stroke-dasharray="0.1 7" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
        ${stops.map((l) => {
          const row = mine.get(l);
          const cleared = !!row && row.stars > 0;
          const isCurrent = l === current;
          const locked = l > current;
          const boss = l >= 10 && l % 10 === 0;
          const gift = l % 5 === 0 && !boss;
          return html`<button key=${l}
            class=${`gemstop ${cleared ? "done" : ""} ${isCurrent ? "now" : ""} ${locked ? "locked" : ""} ${gift ? "gift" : ""} ${boss ? "boss" : ""}`}
            style=${`left:${xFor(l)}%; top:${yFor(l)}px`}
            disabled=${locked}
            onClick=${() => !locked && onPlay(l)}>
            <span class="gemstop-n">${boss ? "⛈️" : gift ? "🎁" : l}</span>
            ${cleared && html`<span class="gemstop-stars">${"⭐".repeat(row.stars)}</span>`}
            ${partner && theirMax + 1 === l && html`<span class="gemstop-partner">${partner.emoji}🎈</span>`}
          </button>`;
        })}
        <div class="gemmap-lawn"></div>
      </div>
    </div>
  </div>`;
}
