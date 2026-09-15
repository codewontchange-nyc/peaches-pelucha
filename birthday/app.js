// For Peaches 🍑, from Pelucha 🧸 — her birthday app. A letter, ten poems, four promises.
// Same stack as home: Preact + htm + supabase-js, no build step.
import { h, render } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";

const html = htm.bind(h);

const PELUCHA_ID = "b8db6a45-06e8-4bb0-bf67-b716c2179393"; // the giver — gets the redemption pushes
const PEACHES_ID = "4f9fcad1-63f8-4a98-a5ac-02f0367a0e05"; // the birthday girl / reigning champion
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

// ——— Cam: everything she reads lives in LETTER, PHOTOS[].poem, and COUPONS[].sub ———

const LETTER = `My Peaches,

You took my birthday out of my hands and made it unforgettable — which means you never let me plan yours. So this year you get something better than one surprise: a stack of promises, already yours, waiting on your word.

Pick your dates. I'm there for every one of them.

Being loved by you is the best thing that has ever happened to me. Happy birthday, my love.`;

const PHOTOS = [
  {
    path: "m0056.jpg", thumb: "thumb/m0056.jpg", date: "April 4",
    poem: "April, and already\nyour laugh was my favorite room —\nI kissed your cheek\nand moved in for good.",
  },
  {
    path: "m0276.jpg", thumb: "thumb/m0276.jpg", date: "April 4",
    poem: "Four little frames,\na dollar's worth of forever.\nIn the last one\nI couldn't help myself.",
  },
  {
    path: "u1781744975261-9fzgsm.jpg", thumb: "t1781744975261-9fzgsm.webp", date: "May 16",
    poem: "You walked into the tall grass\nand the sun leaned down\nfor a better look.\nI know the feeling.",
  },
  {
    path: "u1781299267195-tm2ufa.jpg", thumb: "thumb/u1781299267195-tm2ufa.jpg", date: "May 16",
    poem: "The sky spent the whole evening\npainting the water gold —\nand still came in second.",
  },
  {
    path: "u1781316190383-q31kax.jpg", thumb: "thumb/u1781316190383-q31kax.jpg", date: "June 12",
    poem: "Golden hour, they call it,\nas if the light does this\nfor everyone.",
  },
  {
    path: "u1781316204863-6uq3vy.jpg", thumb: "t1781316204863-6uq3vy.webp", date: "June 12",
    poem: "Even this face.\nEspecially this face.\nI love every weather\nyou've ever been.",
  },
  {
    path: "u1782005373821-991u58.jpg", thumb: "t1782005373821-991u58.webp", date: "June 20",
    poem: "You collect sunsets;\nI collect the way you look\nreaching for them.\nWe are both rich.",
  },
  {
    path: "u1783646428795-f3jdvs.jpg", thumb: "t1783646428795-f3jdvs.jpg", date: "July 9",
    poem: "July taught me nothing new.\nI already knew where the light\nin the garden\nwas coming from.",
  },
  {
    path: "u1783621284279-wbm3jq.jpg", thumb: "t1783621284279-wbm3jq.webp", date: "July 9",
    poem: "That gasp —\na room full of balloons\nand still nothing in it\nas bright as you.",
  },
  {
    path: "u1783708582218-48xhhe.jpg", thumb: "t1783708582218-48xhhe.webp", date: "Today", finale: true,
    poem: "And today the hills wore\ntheir softest blue for you,\nthe garden held its breath —\nanother year of you,\nimpossibly, gloriously you.\n\nHappy birthday, my Peaches.",
  },
];

const COUPONS = [
  {
    slug: "manipedi", no: "01", emoji: "💅", kind: "date",
    title: "Mani & Pedi Day",
    sub: "Hands, feet, zero responsibilities — a whole day of being pampered.",
    cta: "Book our day",
  },
  {
    slug: "staycation", no: "02", emoji: "🏝️", kind: "range",
    title: "The Staycation",
    sub: "Days checked in somewhere lovely, checked out of real life.",
    cta: "Claim your days",
  },
  {
    slug: "sewing", no: "03", emoji: "🪡", kind: "instant",
    title: "Sewing & Fashion Design Classes",
    sub: "The clothes in your head, out in the world. Your classes are on me.",
    cta: "Redeem",
  },
  {
    slug: "thrift", no: "04", emoji: "🛍️", kind: "instant",
    title: "$250 Thrift Voucher",
    sub: "A treasure hunt, funded — $250 lands in your account when you redeem.",
    cta: "Redeem",
  },
];

// № 05 — the headliner 🎧. Locked until the other four are hers. No form:
// she just comes and talks to Pelucha. The photo is her at the decks.
const FINALE = {
  slug: "djparty", no: "05", emoji: "🎧", kind: "instant",
  title: "The Headliner",
  photo: "u1781743779854-3y6lwj.jpg",
  cta: "I'm ready — let's plan it",
};

// ——— boot: credentials (injected config in prod; live config for local dev) ———
async function getCreds() {
  const c = window.PP_CONFIG || {};
  if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) return c;
  const t = await (await fetch("https://codewontchange-nyc.github.io/peaches-pelucha/config.js")).text();
  return new Function(`const window = {}; ${t}; return window.PP_CONFIG;`)();
}

let SB_URL = "";
const renderUrl = (p, w) => `${SB_URL}/storage/v1/render/image/public/memories/${p}?width=${w}&quality=80`;
const pubUrl = (p) => `${SB_URL}/storage/v1/object/public/memories/${p}`;

function notifyPelucha(client, title, body) {
  if (IS_LOCAL) return; // never ping his phone from a dev run
  try {
    client.functions.invoke("notify-turn", { body: { player_id: PELUCHA_ID, title, body } }).catch(() => {});
  } catch {}
}

// ——— confetti (canvas, her peach + his purple + gold) ———
const CONF_COLORS = ["#ff7a91", "#ffb4c8", "#9b6bff", "#c15f3c", "#ffd166", "#fffdfb"];
let confCanvas = null, confParts = [], confRaf = 0;
function confetti(n = 140) {
  if (!confCanvas) {
    confCanvas = document.createElement("canvas");
    confCanvas.className = "confetti";
    document.body.appendChild(confCanvas);
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  confCanvas.width = innerWidth * dpr;
  confCanvas.height = innerHeight * dpr;
  const W = confCanvas.width, H = confCanvas.height;
  for (let i = 0; i < n; i++) {
    confParts.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.35 + (Math.random() - 0.5) * H * 0.2,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (-6 - Math.random() * 10) * dpr,
      w: (5 + Math.random() * 6) * dpr,
      h: (8 + Math.random() * 8) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONF_COLORS[(Math.random() * CONF_COLORS.length) | 0],
      life: 1,
    });
  }
  if (!confRaf) {
    const ctx = confCanvas.getContext("2d");
    const tick = () => {
      ctx.clearRect(0, 0, confCanvas.width, confCanvas.height);
      confParts = confParts.filter((p) => p.life > 0);
      for (const p of confParts) {
        p.vy += 0.35 * (window.devicePixelRatio || 1);
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        p.vx *= 0.99;
        if (p.y > confCanvas.height * 0.65) p.life -= 0.02;
        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (confParts.length) { confRaf = requestAnimationFrame(tick); }
      else { confRaf = 0; ctx.clearRect(0, 0, confCanvas.width, confCanvas.height); }
    };
    confRaf = requestAnimationFrame(tick);
  }
}

// ——— date helpers ———
const fmtLong = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtShort = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function payloadLine(c, row) {
  const p = row?.payload || {};
  if (c.kind === "date" && p.date) return fmtLong(p.date);
  if (c.kind === "range" && p.start) return `${fmtShort(p.start)} – ${fmtShort(addDays(p.start, p.days - 1))} · ${p.days} days`;
  if (c.slug === "thrift") return "$250, incoming 💸";
  return "yours, whenever you're ready";
}

// ——— sections ———

function Envelope({ onOpen }) {
  const [opening, setOpening] = useState(false);
  const go = () => {
    if (opening) return;
    setOpening(true);
    confetti(180);
    setTimeout(onOpen, 1050);
  };
  return html`
    <div class="gate ${opening ? "opening" : ""}" onClick=${go}>
      <div class="gate-inner">
        <div class="env">
          <div class="env-flap"></div>
          <div class="env-letter"><span>🎂</span></div>
          <div class="env-body"></div>
          <div class="env-seal">🧸</div>
        </div>
        <div class="gate-name">Peaches</div>
        <div class="gate-sub">something for your birthday</div>
        <div class="gate-hint">tap to open</div>
      </div>
    </div>
  `;
}

// ——— the pop-up storybook: her last year, in watercolor & paper ———

function SceneDefs() {
  return html`
    <defs>
      <filter id="wc" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="6" />
      </filter>
      <filter id="wash" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="16" />
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
    </defs>
  `;
}

const Wash = ({ cx, cy, rx, ry, fill, o = 0.45 }) =>
  html`<ellipse cx=${cx} cy=${cy} rx=${rx} ry=${ry} fill=${fill} opacity=${o} filter="url(#wash)" />`;

// Peaches Shortcake herself: curly hair, peach beret, shortcake tights.
function Girl({ x = 0, y = 0, s = 1, hair = "short", arms = "down", lean = 0 }) {
  const curl = (cx, cy, r) => html`<circle cx=${cx} cy=${cy} r=${r} fill="#46312a" />`;
  return html`
    <g transform="translate(${x} ${y}) rotate(${lean}) scale(${s})">
      ${curl(-18, -108, 11)} ${curl(0, -116, 12)} ${curl(18, -108, 11)}
      ${curl(-24, -96, 9)} ${curl(24, -96, 9)}
      ${hair !== "short" && html`${curl(-26, -80, 8)} ${curl(26, -80, 8)} ${curl(-28, -66, 8)} ${curl(28, -66, 8)}`}
      ${hair === "long" && html`
        ${curl(-30, -52, 8)} ${curl(30, -52, 8)}
        ${curl(-31, -38, 7)} ${curl(31, -38, 7)}
        ${curl(-30, -25, 7)} ${curl(30, -25, 7)}
      `}
      <rect x="-11" y="-28" width="7" height="27" rx="3.5" fill="#fff1e2" />
      <rect x="4" y="-28" width="7" height="27" rx="3.5" fill="#fff1e2" />
      <rect x="-11" y="-22" width="7" height="4" fill="#ffab8a" />
      <rect x="4" y="-22" width="7" height="4" fill="#ffab8a" />
      <rect x="-11" y="-13" width="7" height="4" fill="#ffab8a" />
      <rect x="4" y="-13" width="7" height="4" fill="#ffab8a" />
      <ellipse cx="-7.5" cy="0" rx="7" ry="4" fill="#8a5a44" />
      <ellipse cx="7.5" cy="0" rx="7" ry="4" fill="#8a5a44" />
      <path d="M -13 -76 L 13 -76 C 20 -55 24 -40 26 -26 C 10 -19 -10 -19 -26 -26 C -24 -40 -20 -55 -13 -76 Z"
        fill="#ff9e7d" stroke="#e07a5f" stroke-width="1.5" />
      <circle cx="-8" cy="-52" r="3" fill="#fff4e6" />
      <circle cx="9" cy="-44" r="3" fill="#fff4e6" />
      <circle cx="-2" cy="-33" r="3" fill="#fff4e6" />
      ${arms === "up" ? html`
        <path d="M -12 -68 C -22 -76 -28 -84 -31 -92" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
        <path d="M 12 -68 C 22 -76 28 -84 31 -92" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
      ` : arms === "reach" ? html`
        <path d="M -12 -68 C -20 -66 -28 -62 -35 -57" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
        <path d="M 12 -68 C 20 -66 28 -62 35 -57" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
      ` : html`
        <path d="M -12 -68 C -18 -60 -21 -52 -22 -46" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
        <path d="M 12 -68 C 18 -60 21 -52 22 -46" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
      `}
      <circle cx="0" cy="-94" r="23" fill="#cf9d78" />
      ${curl(-14, -111, 8)} ${curl(2, -114, 8)} ${curl(15, -110, 7)}
      <circle cx="-9" cy="-89" r="3.6" fill="#ff9d94" opacity="0.75" />
      <circle cx="9" cy="-89" r="3.6" fill="#ff9d94" opacity="0.75" />
      <circle cx="-7.5" cy="-96" r="2.3" fill="#3a2a24" />
      <circle cx="7.5" cy="-96" r="2.3" fill="#3a2a24" />
      <path d="M -4 -88 Q 0 -84 4 -88" stroke="#3a2a24" stroke-width="1.6" stroke-linecap="round" fill="none" />
      <path d="M -20 -110 C -17 -123 17 -123 20 -110 C 8 -116 -8 -116 -20 -110 Z"
        fill="#ff8f70" stroke="#e07a5f" stroke-width="1.2" />
      <ellipse cx="15" cy="-121" rx="6" ry="3" fill="#7fb069" transform="rotate(-24 15 -121)" />
    </g>
  `;
}

// Pelucha, as himself: a soft brown teddy boy with his purple bow.
function Bear({ x = 0, y = 0, s = 1 }) {
  return html`
    <g transform="translate(${x} ${y}) scale(${s})">
      <ellipse cx="-9" cy="-4" rx="8" ry="9" fill="#a9765b" />
      <ellipse cx="9" cy="-4" rx="8" ry="9" fill="#a9765b" />
      <ellipse cx="0" cy="-38" rx="24" ry="28" fill="#a9765b" />
      <ellipse cx="0" cy="-34" rx="14" ry="17" fill="#c9987b" />
      <path d="M -20 -48 C -28 -50 -34 -53 -39 -57" stroke="#a9765b" stroke-width="9" stroke-linecap="round" fill="none" />
      <path d="M 20 -48 C 28 -50 34 -53 39 -57" stroke="#a9765b" stroke-width="9" stroke-linecap="round" fill="none" />
      <circle cx="-16" cy="-112" r="10" fill="#a9765b" />
      <circle cx="16" cy="-112" r="10" fill="#a9765b" />
      <circle cx="-16" cy="-112" r="5" fill="#c9987b" />
      <circle cx="16" cy="-112" r="5" fill="#c9987b" />
      <circle cx="0" cy="-92" r="24" fill="#a9765b" />
      <ellipse cx="0" cy="-83" rx="11" ry="8.5" fill="#e7c3a4" />
      <circle cx="0" cy="-88" r="3" fill="#4a3529" />
      <path d="M 0 -85 L 0 -81" stroke="#4a3529" stroke-width="1.6" stroke-linecap="round" />
      <path d="M -4 -79 Q 0 -76 4 -79" stroke="#4a3529" stroke-width="1.6" stroke-linecap="round" fill="none" />
      <circle cx="-9" cy="-96" r="2.3" fill="#3a2a24" />
      <circle cx="9" cy="-96" r="2.3" fill="#3a2a24" />
      <circle cx="-15" cy="-87" r="3.4" fill="#ff9d94" opacity="0.55" />
      <circle cx="15" cy="-87" r="3.4" fill="#ff9d94" opacity="0.55" />
      <path d="M 0 -64 L -12 -70 L -12 -58 Z" fill="#9b6bff" />
      <path d="M 0 -64 L 12 -70 L 12 -58 Z" fill="#9b6bff" />
      <circle cx="0" cy="-64" r="3.4" fill="#8253e6" />
    </g>
  `;
}

const Star = ({ x, y, s = 1, fill = "#ffd166" }) =>
  html`<path transform="translate(${x} ${y}) scale(${s})" fill=${fill}
    d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />`;

const Heart = ({ x, y, s = 1, fill = "#ff8fa3", o = 1 }) =>
  html`<path transform="translate(${x} ${y}) scale(${s})" fill=${fill} opacity=${o}
    d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />`;

function SceneCover() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1"><${Wash} cx="160" cy="130" rx="120" ry="90" fill="#ffd9cf" o="0.55" /></g>
      <g class="pop p2">
        <circle cx="160" cy="130" r="56" fill="#ff9e7d" filter="url(#wc)" />
        <path d="M 160 80 C 152 100 152 160 160 184" stroke="#e07a5f" stroke-width="2" fill="none" opacity="0.5" />
        <ellipse cx="176" cy="72" rx="13" ry="6" fill="#7fb069" transform="rotate(-28 176 72)" />
        <path d="M 160 80 Q 158 70 150 66" stroke="#8a5a44" stroke-width="3" stroke-linecap="round" fill="none" />
        <circle cx="141" cy="128" r="6" fill="#ff9d94" opacity="0.8" />
        <circle cx="179" cy="128" r="6" fill="#ff9d94" opacity="0.8" />
        <circle cx="146" cy="118" r="3.4" fill="#3a2a24" />
        <circle cx="174" cy="118" r="3.4" fill="#3a2a24" />
        <path d="M 152 132 Q 160 140 168 132" stroke="#3a2a24" stroke-width="2.4" stroke-linecap="round" fill="none" />
      </g>
      <g class="pop p3">
        <${Star} x="70" y="70" s="1.2" />
        <${Star} x="250" y="86" s="0.9" fill="#ff8fa3" />
        <${Star} x="238" y="188" s="1.1" />
        <${Star} x="84" y="182" s="0.8" fill="#c4a6ff" />
        <${Heart} x="256" y="140" s="1.2" o="0.8" />
        <${Heart} x="64" y="126" s="1" o="0.7" fill="#c4a6ff" />
      </g>
    </svg>
  `;
}

function SceneHome() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1">
        <${Wash} cx="160" cy="204" rx="150" ry="26" fill="#cdeac0" o="0.7" />
        <${Wash} cx="160" cy="60" rx="150" ry="42" fill="#cfe7f5" o="0.4" />
      </g>
      <g class="pop p2">
        <circle cx="52" cy="48" r="20" fill="#ffd166" filter="url(#wc)" />
        <g stroke="#ffd166" stroke-width="3" stroke-linecap="round" opacity="0.8">
          <path d="M 52 18 L 52 8" /><path d="M 78 26 L 85 19" /><path d="M 26 26 L 19 19" />
          <path d="M 82 48 L 92 48" />
        </g>
      </g>
      <g class="pop p3">
        <rect x="150" y="118" width="110" height="80" rx="4" fill="#fff4e6" stroke="#d9a173" stroke-width="2" filter="url(#wc)" />
        <path d="M 142 122 L 205 82 L 268 122 Z" fill="#ff9e7d" stroke="#e07a5f" stroke-width="2" filter="url(#wc)" />
        <rect x="232" y="92" width="12" height="24" fill="#b96f4e" />
        <rect x="192" y="150" width="26" height="48" rx="13" fill="#b96f4e" />
        <circle cx="212" cy="176" r="2.4" fill="#ffd166" />
        <rect x="162" y="136" width="20" height="20" rx="2" fill="#cfe7f5" stroke="#d9a173" stroke-width="1.6" />
        <path d="M 172 136 L 172 156 M 162 146 L 182 146" stroke="#d9a173" stroke-width="1.4" />
        <rect x="230" y="136" width="20" height="20" rx="2" fill="#cfe7f5" stroke="#d9a173" stroke-width="1.6" />
        <path d="M 240 136 L 240 156 M 230 146 L 250 146" stroke="#d9a173" stroke-width="1.4" />
        <${Heart} x="205" y="132" s="0.9" />
      </g>
      <g class="pop p4">
        <rect x="96" y="172" width="34" height="26" rx="2" fill="#e8c39e" stroke="#b96f4e" stroke-width="1.6" />
        <path d="M 96 178 L 130 178 M 113 172 L 113 198" stroke="#b96f4e" stroke-width="1.4" />
        <circle cx="106" cy="168" r="5" fill="#ff9e7d" />
        <ellipse cx="122" cy="166" rx="4" ry="2" fill="#7fb069" transform="rotate(-20 122 166)" />
      </g>
      <g class="pop p5">
        <${Girl} x="56" y="202" s="0.72" hair="short" arms="up" />
        <g transform="translate(84 132) rotate(24)">
          <circle cx="0" cy="0" r="6" fill="none" stroke="#d9a827" stroke-width="3.4" />
          <path d="M 5 3 L 16 12 M 12 9 L 9 13 M 16 12 L 13 16" stroke="#d9a827" stroke-width="3.4" stroke-linecap="round" />
        </g>
      </g>
    </svg>
  `;
}

function SceneCareer() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1">
        <${Wash} cx="160" cy="150" rx="130" ry="70" fill="#ffe8a3" o="0.4" />
        <${Wash} cx="230" cy="70" rx="80" ry="46" fill="#ffd9cf" o="0.45" />
      </g>
      <g class="pop p2">
        <path d="M 30 26 Q 160 6 290 26" stroke="#c9987b" stroke-width="1.6" fill="none" />
        <path d="M 70 22 L 78 40 L 86 23 Z" fill="#ff8fa3" />
        <path d="M 120 19 L 128 37 L 136 20 Z" fill="#cdeac0" />
        <path d="M 170 18 L 178 36 L 186 19 Z" fill="#ffd166" />
        <path d="M 220 20 L 228 38 L 236 21 Z" fill="#c4a6ff" />
      </g>
      <g class="pop p3">
        <g transform="translate(236 130) rotate(14)">
          <rect x="-20" y="-14" width="40" height="28" rx="5" fill="#b96f4e" stroke="#8a5a44" stroke-width="1.6" />
          <path d="M -8 -14 C -8 -22 8 -22 8 -14" stroke="#8a5a44" stroke-width="3" fill="none" />
          <rect x="-3" y="-4" width="6" height="5" rx="1" fill="#ffd166" />
        </g>
        <g transform="translate(66 118) rotate(-12)">
          <rect x="-14" y="-18" width="28" height="36" rx="2" fill="#fffdfb" stroke="#d9a173" stroke-width="1.4" />
          <path d="M -8 -10 L 8 -10 M -8 -3 L 8 -3 M -8 4 L 4 4" stroke="#b7ada1" stroke-width="1.6" />
        </g>
      </g>
      <g class="pop p4">
        <${Star} x="90" y="66" s="1.3" />
        <${Star} x="226" y="56" s="1" fill="#ff8fa3" />
        <${Star} x="270" y="100" s="0.8" fill="#c4a6ff" />
        <${Star} x="52" y="160" s="0.9" />
        <${Star} x="196" y="88" s="0.7" fill="#7fb069" />
      </g>
      <g class="pop p5">
        <ellipse cx="150" cy="212" rx="26" ry="7" fill="#e8dfd4" opacity="0.8" />
        <ellipse cx="128" cy="214" rx="10" ry="5" fill="#f0e8dd" />
        <ellipse cx="172" cy="214" rx="10" ry="5" fill="#f0e8dd" />
        <${Girl} x="150" y="196" s="0.78" hair="mid" arms="up" lean="-6" />
      </g>
    </svg>
  `;
}

function SceneHair() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1"><${Wash} cx="160" cy="120" rx="110" ry="86" fill="#ffd9cf" o="0.5" /></g>
      <g class="pop p2"><${Girl} x="160" y="216" s="0.95" hair="long" arms="down" /></g>
      <g class="pop p3">
        <circle cx="139" cy="118" r="4" fill="#fffdfb" />
        <circle cx="136" cy="115" r="1.6" fill="#ffd166" />
        <circle cx="184" cy="128" r="4" fill="#fffdfb" />
        <circle cx="187" cy="125" r="1.6" fill="#ffd166" />
        <circle cx="132" cy="160" r="3.4" fill="#ff8fa3" />
        <circle cx="190" cy="168" r="3.4" fill="#c4a6ff" />
      </g>
      <g class="pop p4">
        <g transform="translate(74 90) rotate(-14)">
          <ellipse cx="-5" cy="0" rx="7" ry="10" fill="#ff8fa3" opacity="0.85" />
          <ellipse cx="5" cy="0" rx="7" ry="10" fill="#ffb4c8" opacity="0.85" />
          <path d="M 0 -8 L 0 8" stroke="#8a5a44" stroke-width="2" stroke-linecap="round" />
        </g>
        <g transform="translate(248 122) rotate(16)">
          <ellipse cx="-5" cy="0" rx="6" ry="9" fill="#cdeac0" opacity="0.9" />
          <ellipse cx="5" cy="0" rx="6" ry="9" fill="#a8dadc" opacity="0.9" />
          <path d="M 0 -7 L 0 7" stroke="#8a5a44" stroke-width="2" stroke-linecap="round" />
        </g>
        <${Heart} x="234" y="66" s="1.1" o="0.8" />
        <${Heart} x="86" y="150" s="0.9" o="0.7" fill="#c4a6ff" />
      </g>
    </svg>
  `;
}

function SceneLove() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1">
        <${Wash} cx="160" cy="206" rx="140" ry="24" fill="#cdeac0" o="0.6" />
        <path d="M 160 96 C 128 58 92 74 96 104 C 99 128 132 148 160 164 C 188 148 221 128 224 104 C 228 74 192 58 160 96 Z"
          fill="#ff8fa3" opacity="0.3" filter="url(#wash)" />
      </g>
      <g class="pop p2"><${Girl} x="112" y="204" s="0.82" hair="long" arms="reach" /></g>
      <g class="pop p3"><${Bear} x="208" y="204" s="0.82" /></g>
      <g class="pop p4">
        <${Heart} x="160" y="140" s="1.6" />
        <${Heart} x="136" y="112" s="0.9" o="0.8" fill="#c4a6ff" />
        <${Heart} x="186" y="108" s="1" o="0.8" />
        <${Star} x="90" y="80" s="0.9" />
        <${Star} x="238" y="70" s="1" fill="#ff8fa3" />
        <circle cx="70" cy="130" r="3" fill="#ffd166" />
        <circle cx="252" cy="140" r="3" fill="#cdeac0" />
      </g>
    </svg>
  `;
}

const STORY = [
  { Scene: SceneCover, cap: "Once upon a year, there was a girl called Peaches Shortcake…" },
  { Scene: SceneHome, cap: "First, she found a little home that was all her own." },
  { Scene: SceneCareer, cap: "Then she leapt into a brand-new career." },
  { Scene: SceneHair, cap: "Her curls grew long, and wild, and lovely." },
  { Scene: SceneLove, cap: "And then she met a boy… and he loves her so." },
];

function Storybook({ onDone }) {
  const [pg, setPg] = useState(0);
  const lastTap = useRef(0);
  const last = pg === STORY.length - 1;
  const { Scene, cap } = STORY[pg];
  const turn = () => {
    // debounce: a double-tap (or an eager toddler tap) shouldn't skip pages
    const now = Date.now();
    if (now - lastTap.current < 500) return;
    lastTap.current = now;
    if (!last) setPg(pg + 1);
  };
  return html`
    <div class="storybook" onClick=${turn}>
      <div class="story-card" key=${pg}>
        <div class="story-tape"></div>
        <${Scene} />
        <div class="story-cap">${cap}</div>
        ${last && html`
          <button class="story-done" onClick=${(e) => { e.stopPropagation(); onDone(); }}>
            open your birthday 🎂
          </button>
        `}
      </div>
      <div class="story-dots">
        ${STORY.map((_, i) => html`<span class="sdot ${i === pg ? "on" : ""}"></span>`)}
      </div>
      ${!last && html`<div class="story-hint">tap to turn the page</div>`}
    </div>
  `;
}

function Hero() {
  return html`
    <header class="hero">
      <div class="hero-kicker">July 11, 2026</div>
      <h1 class="hero-title">Happy<br />Birthday</h1>
      <div class="hero-sub">for the girl who plans everyone else's magic</div>
    </header>
  `;
}

function Letter() {
  return html`
    <section class="sec">
      <div class="sec-label"><span>I</span> a letter</div>
      <div class="letter">
        <p>${LETTER}</p>
        <div class="letter-sig">— your Pelucha 🧸</div>
      </div>
    </section>
  `;
}

function Page({ ph, i }) {
  // reveal + fallback mutate the node directly — a Preact re-render inside the
  // snap scroller makes Chrome re-snap and yank the carousel mid-swipe
  return html`
    <div class="page ${ph.finale ? "finale" : ""}" style="background-image:url('${renderUrl(ph.thumb, 480)}')">
      <img
        src=${renderUrl(ph.path, 1100)}
        loading=${i < 2 ? "eager" : "lazy"}
        onLoad=${(e) => { e.target.style.opacity = 1; }}
        onError=${(e) => {
          const el = e.target, fb = pubUrl(ph.path);
          if (el.src !== fb) el.src = fb;
        }}
        alt=""
      />
      <div class="page-scrim"></div>
      <div class="page-date">${ph.date}</div>
      <div class="poem">${ph.poem}</div>
    </div>
  `;
}

function Poems() {
  const ref = useRef(null);
  const [idx, setIdx] = useState(0);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // nearest page-center to the viewport center — immune to gaps/padding
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestD = Infinity;
    [...el.children].forEach((ch, i) => {
      const d = Math.abs(ch.offsetLeft + ch.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    setIdx(best);
  }, []);
  return html`
    <section class="sec">
      <div class="sec-label"><span>II</span> the season of us</div>
      <div class="carousel" ref=${ref} onScroll=${onScroll}>
        ${PHOTOS.map((ph, i) => html`<${Page} key=${ph.path} ph=${ph} i=${i} />`)}
      </div>
      <div class="dots">
        ${PHOTOS.map((_, i) => html`<span class="dot ${i === idx ? "on" : ""} ${i === PHOTOS.length - 1 ? "cake" : ""}">${i === PHOTOS.length - 1 ? "🎂" : ""}</span>`)}
      </div>
    </section>
  `;
}

// ——— dinner tonight: under the cloche until 5pm, then Clay, Harlem ———
const DINNER_REVEAL = new Date("2026-07-11T17:00:00").getTime();

function Dinner() {
  const [now, setNow] = useState(Date.now());
  const [rattle, setRattle] = useState(0);
  const wasLocked = useRef(Date.now() < DINNER_REVEAL);
  const revealed = SNEAK || now >= DINNER_REVEAL;
  useEffect(() => {
    if (revealed) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [revealed]);
  useEffect(() => {
    // the moment the cloche lifts live, celebrate
    if (revealed && wasLocked.current) { wasLocked.current = false; if (!SNEAK) confetti(110); }
  }, [revealed]);

  const s = Math.max(0, Math.floor((DINNER_REVEAL - now) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");

  return html`
    <section class="sec">
      <div class="sec-label"><span>III</span> tonight</div>
      <div class="dinner">
        ${revealed ? html`
          <div class="din-stars">★ ★ ★ ★ ★</div>
          <div class="din-name">Clay</div>
          <div class="din-place">harlem · new york</div>
          <div class="din-rows">
            <div class="din-row"><span>📅</span><b>Sat, Jul 11 · 7:30 pm</b></div>
            <div class="din-row"><span>👥</span><b>2 guests · dining room</b></div>
            <a class="din-row" href="https://maps.apple.com/?q=Clay,+553+Manhattan+Ave,+New+York" target="_blank" rel="noopener">
              <span>📍</span><b>553 Manhattan Ave</b>
            </a>
          </div>
          <div class="din-note">wear something beautiful 💃</div>
        ` : html`
          <div class="din-lock ${rattle ? "nope" : ""}" key=${rattle} onClick=${() => setRattle((n) => n + 1)}>
            <svg class="cloche" viewBox="0 0 120 96">
              <path class="steam s1" d="M 46 22 q 5 -7 0 -13 q -4 -5 0 -9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path class="steam s2" d="M 74 24 q 5 -7 0 -13 q -4 -5 0 -9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <circle cx="60" cy="26" r="4" fill="none" stroke="currentColor" stroke-width="2.4" />
              <path d="M 18 72 C 18 46 38 32 60 32 C 82 32 102 46 102 72 Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" />
              <text x="60" y="62" text-anchor="middle" class="cloche-q">?</text>
              <path d="M 10 80 H 110" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
            </svg>
            <div class="din-tease">dinner is booked 🤫</div>
            <div class="din-sub">a five-star secret in Harlem</div>
            <div class="din-count">${hh}<i>:</i>${mm}<i>:</i>${ss}</div>
            <div class="din-lift">the cloche lifts at 5:00 pm</div>
          </div>
        `}
      </div>
    </section>
  `;
}

// ——— the Phase 10 reckoning: live career numbers, computed from games+matches ———
function Record({ client }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    (async () => {
      const [{ data: games }, { data: matches }] = await Promise.all([
        client.from("games").select("winner_id,finished_at").eq("status", "finished").order("finished_at"),
        client.from("matches").select("status,state,created_at").order("created_at"),
      ]);
      if (!games?.length) return;
      const wins = { [PEACHES_ID]: 0, [PELUCHA_ID]: 0 };
      games.forEach((g) => { if (wins[g.winner_id] != null) wins[g.winner_id]++; });
      const lastN = games.slice(-5);
      const last5P = lastN.filter((g) => g.winner_id === PEACHES_ID).length;
      let ptsP = 0, ptsL = 0, bestP = Infinity, bestL = Infinity, live = null;
      (matches || []).forEach((m) => {
        const sc = m.state?.scores || {}, ph = m.state?.phaseOf || {};
        const p = sc[PEACHES_ID], l = sc[PELUCHA_ID];
        if (m.status === "finished" && p != null && l != null) {
          ptsP += p; ptsL += l;
          bestP = Math.min(bestP, p); bestL = Math.min(bestL, l);
        } else if (m.status === "playing" && p != null && l != null) {
          // leader: furthest phase, then fewest points
          const peachLeads = (ph[PEACHES_ID] || 0) !== (ph[PELUCHA_ID] || 0)
            ? (ph[PEACHES_ID] || 0) > (ph[PELUCHA_ID] || 0) : p < l;
          live = { peachLeads };
        }
      });
      setS({ winsP: wins[PEACHES_ID], winsL: wins[PELUCHA_ID], ptsP, ptsL,
             best: Math.min(bestP, bestL), bestIsHers: bestP <= bestL,
             last5P, lastN: lastN.length, live });
    })().catch(() => {});
  }, [client]);
  if (!s) return null;
  return html`
    <section class="sec">
      <div class="sec-label"><span>IV</span> for the record</div>
      <div class="record">
        <div class="rec-score">
          <div class="rec-side">
            <div class="rec-crown">👑</div>
            <div class="rec-name">Peaches</div>
            <div class="rec-num her">${s.winsP}</div>
          </div>
          <div class="rec-dash">–</div>
          <div class="rec-side">
            <div class="rec-crown dim">🧸</div>
            <div class="rec-name">Pelucha</div>
            <div class="rec-num him">${s.winsL}</div>
          </div>
        </div>
        <div class="rec-cap">Phase 10, lifetime matches won</div>
        <div class="rec-rows">
          <div class="rec-row"><span>points collected — fewer is better</span><b>${s.ptsP.toLocaleString()} – ${s.ptsL.toLocaleString()}</b></div>
          <div class="rec-row"><span>lowest match score, all time</span><b>${s.best} · ${s.bestIsHers ? "hers" : "his"}</b></div>
          <div class="rec-row"><span>last ${s.lastN} matches</span><b>${s.last5P} – ${s.lastN - s.last5P}</b></div>
        </div>
        ${s.live && html`
          <div class="rec-note">
            ${s.live.peachLeads
              ? "…and she leads the match still in progress. Of course she does."
              : "…he leads the one match still in progress. Let him have this, briefly."}
          </div>
        `}
        <div class="rec-sig">— faithfully recorded by the loser 🧸</div>
      </div>
    </section>
  `;
}

function Coupon({ c, row, onRedeem }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const redeemed = row?.status === "redeemed";

  const go = async () => {
    if (busy) return;
    const payload = c.kind === "date" ? { date } : c.kind === "range" ? { start: date, days } : {};
    setBusy(true);
    await onRedeem(c, payload);
    setBusy(false);
  };
  const needsDate = c.kind !== "instant";
  const ready = !needsDate || !!date;

  return html`
    <div class="ticket ${redeemed ? "done" : ""} ${open && !redeemed ? "open" : ""}"
         onClick=${() => { if (!redeemed && !open) setOpen(true); }}>
      <div class="ticket-stub">
        <div class="ticket-no">№ ${c.no}</div>
        <div class="ticket-emoji">${c.emoji}</div>
      </div>
      <div class="ticket-main">
        <div class="ticket-title">${c.title}</div>
        <div class="ticket-sub">${redeemed ? payloadLine(c, row) : c.sub}</div>
        ${!redeemed && open && html`
          <div class="ticket-form" onClick=${(e) => e.stopPropagation()}>
            ${c.kind === "date" && html`
              <input type="date" min=${todayISO()} value=${date} onInput=${(e) => setDate(e.target.value)} />
            `}
            ${c.kind === "range" && html`
              <input type="date" min=${todayISO()} value=${date} onInput=${(e) => setDate(e.target.value)} />
              <div class="seg">
                <button class=${days === 2 ? "on" : ""} onClick=${() => setDays(2)}>2 days</button>
                <button class=${days === 3 ? "on" : ""} onClick=${() => setDays(3)}>3 days</button>
              </div>
              ${date && html`<div class="range-echo">${fmtShort(date)} – ${fmtShort(addDays(date, days - 1))}</div>`}
            `}
            <button class="redeem" disabled=${!ready || busy} onClick=${go}>
              ${busy ? "…" : c.cta} 💗
            </button>
          </div>
        `}
      </div>
      ${redeemed && html`<div class="stamp">yours ✓</div>`}
    </div>
  `;
}

// № 05 stays under lock until the other four gifts are redeemed, then reveals
// itself: her party, her decks — planned face to face, no forms.
function Finale({ rows, onRedeem }) {
  const row = rows[FINALE.slug];
  const done = COUPONS.filter((c) => rows[c.slug]?.status === "redeemed").length;
  const unlocked = done === COUPONS.length;
  const redeemed = row?.status === "redeemed";
  const [busy, setBusy] = useState(false);
  const [wiggle, setWiggle] = useState(0);
  const wasLocked = useRef(null);
  useEffect(() => {
    if (!Object.keys(rows).length) return;
    if (wasLocked.current === null) { wasLocked.current = !unlocked; return; }
    // the moment the fourth gift lands, the last one bursts open
    if (unlocked && wasLocked.current) { wasLocked.current = false; confetti(160); }
  }, [unlocked, rows]);

  if (!unlocked) return html`
    <div class="ticket finale-locked ${wiggle ? "nope" : ""}" key=${"w" + wiggle} onClick=${() => setWiggle((n) => n + 1)}>
      <div class="ticket-stub"><div class="ticket-no">№ 05</div><div class="ticket-emoji">🔒</div></div>
      <div class="ticket-main">
        <div class="ticket-title">one more thing…</div>
        <div class="ticket-sub">unlocks when the other four are yours · ${done} of 4</div>
      </div>
    </div>
  `;

  return html`
    <div class="finale-card">
      <div class="finale-no">№ 05 · the headliner</div>
      <div class="finale-photo"><img src=${renderUrl(FINALE.photo, 900)} alt="" /></div>
      <div class="finale-title">Your party. Your set.</div>
      <div class="finale-text">
        A party on the date you choose — everyone you love in one room,
        the music in your hands, the whole night in your name.
        I'll handle everything else; you just step up to the decks.
      </div>
      ${redeemed
        ? html`<div class="finale-done">yours ✓ · come find your Pelucha 🧸</div>`
        : html`
          <button class="redeem" disabled=${busy}
            onClick=${async () => { setBusy(true); await onRedeem(FINALE, {}); setBusy(false); }}>
            ${busy ? "…" : FINALE.cta} 🎧
          </button>
          <div class="finale-sig">no forms for this one — just come find me</div>
        `}
    </div>
  `;
}

function Gifts({ client }) {
  // rows + realtime live HERE so coupon updates never re-render the rest of the page
  const [rows, setRows] = useState({});
  useEffect(() => {
    let ch;
    (async () => {
      const { data } = await client.from("bday_coupons").select("*");
      if (data) setRows(Object.fromEntries(data.map((r) => [r.slug, r])));
      ch = client.channel("bday")
        .on("postgres_changes", { event: "*", schema: "public", table: "bday_coupons" },
          (p) => { if (p.new?.slug) setRows((r) => ({ ...r, [p.new.slug]: p.new })); })
        .subscribe();
    })();
    return () => { try { ch?.unsubscribe(); } catch {} };
  }, [client]);

  // her answer also lands on the Love Bug Calendar, so Pelucha can plan around
  // it in the main app (no email, no forms — it's just there)
  const calendarize = async (c, payload) => {
    const ev = { kind: "fyi", created_by: PEACHES_ID, emoji: c.emoji, title: c.title };
    if (c.kind === "date") {
      ev.starts_on = payload.date;
      ev.notes = "🎁 birthday coupon — she booked this day";
    } else if (c.kind === "range") {
      ev.starts_on = payload.start;
      ev.notes = `🎁 birthday coupon — ${payload.days} days, through ${fmtLong(addDays(payload.start, payload.days - 1))}`;
    } else {
      ev.starts_on = todayISO();
      ev.notes = c.slug === "thrift"
        ? "🎁 birthday coupon redeemed — send her the $250 💸"
        : c.slug === "djparty"
        ? "🎁 the headliner is ON — she's ready to plan her party 🎧"
        : "🎁 birthday coupon redeemed — book her classes 🪡";
    }
    try { await client.from("events").insert(ev); } catch {}
  };

  const onRedeem = async (c, payload) => {
    const now = new Date().toISOString();
    const { data, error } = await client
      .from("bday_coupons")
      .update({ status: "redeemed", payload, redeemed_at: now })
      .eq("slug", c.slug)
      .select()
      .single();
    if (error || !data) return;
    setRows((r) => ({ ...r, [c.slug]: data }));
    confetti(120);
    calendarize(c, payload);
    const detail =
      c.kind === "date" ? `${c.emoji} ${c.title} — ${fmtLong(payload.date)}`
      : c.kind === "range" ? `${c.emoji} ${c.title} — ${fmtShort(payload.start)} to ${fmtShort(addDays(payload.start, payload.days - 1))}`
      : c.slug === "thrift" ? `${c.emoji} ${c.title} — time to send it 💸`
      : c.slug === "djparty" ? `🎧 ${c.title} — she's ready to plan the party!`
      : `${c.emoji} ${c.title}`;
    notifyPelucha(client, "🍑 Peaches redeemed a birthday gift!", detail);
  };
  return html`
    <section class="sec">
      <div class="sec-label"><span>V</span> your gifts</div>
      <div class="tickets">
        ${COUPONS.map((c) => html`<${Coupon} key=${c.slug} c=${c} row=${rows[c.slug]} onRedeem=${onRedeem} />`)}
        <${Finale} rows=${rows} onRedeem=${onRedeem} />
      </div>
    </section>
  `;
}

// Locked until her birthday actually starts (midnight, her phone's clock).
// ?pelucha is Pelucha's secret bypass so he can check the app early.
const BDAY_START = new Date("2026-07-11T00:00:00").getTime();
const PARAMS = new URLSearchParams(location.search);
const SNEAK = PARAMS.has("pelucha");
// ?fresh replays the whole intro (envelope + story) on a device that has
// already seen it — the plain link skips straight to the card after first read
if (PARAMS.has("fresh")) localStorage.removeItem("pb.opened");
if (PARAMS.has("fresh") || SNEAK) history.replaceState(null, "", location.pathname);

function Lock({ onUnlock }) {
  const [left, setLeft] = useState(() => BDAY_START - Date.now());
  const [nope, setNope] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const l = BDAY_START - Date.now();
      setLeft(l);
      if (l <= 0) { clearInterval(t); onUnlock(); }
    }, 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor(left / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return html`
    <div class="gate lock" onClick=${() => setNope((n) => n + 1)}>
      <div class="gate-inner">
        <div class="env ${nope ? "nope" : ""}" key=${nope}>
          <div class="env-flap"></div>
          <div class="env-letter"><span>🎂</span></div>
          <div class="env-body"></div>
          <div class="env-seal">🧸</div>
          <div class="env-lock">🔒</div>
        </div>
        <div class="gate-name">no peeking 😛</div>
        <div class="gate-sub">her birthday starts in</div>
        <div class="lock-count">
          ${[[hh, "hours"], [mm, "minutes"], [ss, "seconds"]].map(([v, l]) => html`
            <div class="lc"><div class="lc-num">${v}</div><div class="lc-label">${l}</div></div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function App() {
  const [client, setClient] = useState(null);
  const [locked, setLocked] = useState(() => !SNEAK && Date.now() < BDAY_START);
  // gate → story → main; pb.opened is only set once the story has been read,
  // so quitting mid-story replays the whole intro next time
  const [stage, setStage] = useState(() => (localStorage.getItem("pb.opened") === "1" ? "main" : "gate"));

  useEffect(() => {
    (async () => {
      const creds = await getCreds();
      SB_URL = creds.SUPABASE_URL;
      const c = createClient(creds.SUPABASE_URL, creds.SUPABASE_ANON_KEY);
      window.__pb = c;
      setClient(c);
    })();
  }, []);

  const storyDone = () => {
    localStorage.setItem("pb.opened", "1");
    setStage("main");
    confetti(90);
  };

  if (locked) return html`<${Lock} onUnlock=${() => { setLocked(false); confetti(180); }} />`;
  if (stage === "gate") return html`<${Envelope} onOpen=${() => setStage("story")} />`;
  // the storybook overlay must live OUTSIDE .bday: its entrance animation makes
  // it a containing block, which would trap our position:fixed inside the page
  return html`
    <div class="bday">
      <${Hero} />
      <${Letter} />
      <${Poems} />
      <${Dinner} />
      ${client && html`<${Record} client=${client} />`}
      ${client && html`<${Gifts} client=${client} />`}
      <footer class="foot">
        <div class="foot-heart">🧸 💗 🍑</div>
        <div>made by your Pelucha, with all of his heart</div>
        <button class="foot-replay" onClick=${() => setStage("story")}>read your story again 📖</button>
      </footer>
    </div>
    ${stage === "story" && html`<${Storybook} onDone=${storyDone} />`}
  `;
}

render(html`<${App} />`, document.getElementById("app"));
