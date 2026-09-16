import { h } from "https://esm.sh/preact@10.23.2";
import { useEffect, useRef, useState } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🎖 Journey badges — all derived purely from a player's gem_progress rows,
   so they need no schema, sync for free, and work identically in ?demo=1. */
export const BADGES = [
  { id: "first",   e: "🐣", name: "First Pop",     req: "clear level 1",           test: (a) => a.cleared.has(1) },
  { id: "lift",    e: "🎈", name: "Liftoff",       req: "reach level 5",           test: (a) => a.maxLevel >= 5 },
  { id: "kite",    e: "🪁", name: "Sky High",      req: "reach level 10",          test: (a) => a.maxLevel >= 10 },
  { id: "moon",    e: "🌙", name: "Moonwalker",    req: "reach level 20",          test: (a) => a.maxLevel >= 20 },
  { id: "cosmos",  e: "🌌", name: "Star Sailor",   req: "reach level 30",          test: (a) => a.maxLevel >= 30 },
  { id: "stars",   e: "⭐", name: "Collector",     req: "15 stars total",          test: (a) => a.totalStars >= 15 },
  { id: "perfect", e: "🌟", name: "Perfectionist", req: "five 3-star clears",      test: (a) => a.threeStars >= 5 },
  { id: "storm1",  e: "⛈️", name: "Storm Tamer",   req: "beat a boss storm",       test: (a) => a.bossClears >= 1 },
  { id: "storm3",  e: "⚡", name: "Storm Chaser",  req: "beat 3 boss storms",      test: (a) => a.bossClears >= 3 },
  { id: "gifts",   e: "🎁", name: "Gift Getter",   req: "open 3 gift levels",      test: (a) => a.giftClears >= 3 },
  { id: "score",   e: "💯", name: "Show-off",      req: "2,500 pts in one level",  test: (a) => a.bestScore >= 2500 },
  { id: "legend",  e: "🏆", name: "Legend",        req: "5,000 pts in one level",  test: (a) => a.bestScore >= 5000 },
];

export function badgeAgg(rows) {
  const cleared = new Set();
  let totalStars = 0, threeStars = 0, bossClears = 0, giftClears = 0, bestScore = 0;
  for (const r of rows) {
    if (!(r.stars > 0)) continue;
    cleared.add(r.level);
    totalStars += r.stars;
    if (r.stars >= 3) threeStars++;
    if (r.level >= 10 && r.level % 10 === 0) bossClears++;
    else if (r.level % 5 === 0) giftClears++;
    if (r.best_score > bestScore) bestScore = r.best_score;
  }
  return { cleared, maxLevel: cleared.size ? Math.max(...cleared) : 0, totalStars, threeStars, bossClears, giftClears, bestScore };
}
export const earnedBadges = (rows) => { const a = badgeAgg(rows); return BADGES.filter((b) => b.test(a)); };

/* 🗺💎 The Gem Quest journey map — a winding path of cloud-stops climbing from
   the castle lawn into the stars (the UFO-map beat, storybook style). Cleared
   stops show their stars; the current stop pulses; your partner's balloon
   floats at their frontier. Scrolls bottom-up; any cleared stop replays. */

const STOP_GAP = 96;                     // px between stops (vertical)
const xFor = (i) => 50 + 33 * Math.sin(i * 0.9);   // % across, winding

export function GemMap({ me, partner, prog, onPlay, onClose }) {
  const scroller = useRef(null);
  const [showBadges, setShowBadges] = useState(false);

  const mine = new Map();
  const theirsSet = new Map();
  (prog || []).forEach((r) => {
    if (r.player_id === me.id) mine.set(r.level, r);
    else if (partner && r.player_id === partner.id) theirsSet.set(r.level, r);
  });
  const myRows = [...mine.values()];
  const myAgg = badgeAgg(myRows);
  const myBadges = new Set(BADGES.filter((b) => b.test(myAgg)).map((b) => b.id));
  const theirAgg = badgeAgg([...theirsSet.values()]);
  const theirBadges = new Set(BADGES.filter((b) => b.test(theirAgg)).map((b) => b.id));
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
      <button class="gembadge-btn tnum" onClick=${() => setShowBadges((v) => !v)}>🎖 ${myBadges.size}/${BADGES.length}</button>
      <div class="gemfs-score tnum">lvl ${current}</div>
    </div>
    ${showBadges && html`<div class="gembadges" onClick=${() => setShowBadges(false)}>
      <div class="gembadges-panel" onClick=${(e) => e.stopPropagation()}>
        <div class="eyebrow">🎖 badges</div>
        <div class="gembadges-stats tnum">
          ${myAgg.cleared.size} cleared · ${myAgg.totalStars} ⭐ · ${myAgg.bossClears} ⛈️ · best ${myAgg.bestScore}
        </div>
        <div class="gembadges-grid">
          ${BADGES.map((b) => {
            const got = myBadges.has(b.id);
            return html`<div key=${b.id} class=${`gembadge ${got ? "got" : ""}`}>
              <span class="gembadge-e">${b.e}</span>
              <span class="gembadge-name">${b.name}</span>
              <span class="gembadge-req">${b.req}</span>
              ${partner && theirBadges.has(b.id) && html`<span class="gembadge-them">${partner.emoji}</span>`}
            </div>`;
          })}
        </div>
      </div>
    </div>`}
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
            ${cleared && row.best_score > 0 && html`<span class="gemstop-score tnum">${row.best_score}</span>`}
            ${partner && theirMax + 1 === l && html`<span class="gemstop-partner">${partner.emoji}🎈</span>`}
          </button>`;
        })}
        <div class="gemmap-lawn"></div>
      </div>
    </div>
  </div>`;
}
