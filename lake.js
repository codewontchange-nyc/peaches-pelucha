import { h } from "https://esm.sh/preact@10.23.2";
import { useEffect, useRef, useState } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { dailyVerse } from "./home.js";

const html = htm.bind(h);

/* 🏞 The lakeside — the world to the LEFT of the castle. A serene watercolor
   lake with flowers, the day's verse written in the sky, and three little
   signs of the outside world: what we're doing today & tomorrow (calendar),
   New York weather, and the ⑶ train from 145 St heading downtown.

   All live data loads lazily — nothing is fetched until the panel is
   actually swiped into view, then trains refresh every 60s while visible. */

/* ---- data: weather (Open-Meteo, keyless) ---- */
const WMO = [
  [0, "☀️", "clear"], [1, "🌤", "mostly clear"], [2, "⛅️", "partly cloudy"], [3, "☁️", "overcast"],
  [45, "🌫", "foggy"], [48, "🌫", "foggy"], [51, "🌦", "drizzle"], [55, "🌦", "drizzle"], [57, "🌦", "drizzle"],
  [61, "🌧", "rain"], [65, "🌧", "rain"], [67, "🌧", "rain"], [71, "❄️", "snow"], [77, "❄️", "snow"],
  [80, "🌧", "showers"], [82, "🌧", "showers"], [85, "🌨", "snow showers"], [86, "🌨", "snow showers"],
  [95, "⛈", "thunderstorms"], [99, "⛈", "thunderstorms"],
];
const wmo = (code) => { let hit = WMO[0]; for (const w of WMO) if (code >= w[0]) hit = w; return { emoji: hit[1], label: hit[2] }; };

async function fetchWeather() {
  const u = "https://api.open-meteo.com/v1/forecast?latitude=40.824&longitude=-73.944" +
    "&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=America%2FNew_York&temperature_unit=fahrenheit&forecast_days=2";
  const w = await fetch(u).then((r) => r.json());
  const day = (i) => ({
    ...wmo(w.daily.weather_code[i]),
    hi: Math.round(w.daily.temperature_2m_max[i]), lo: Math.round(w.daily.temperature_2m_min[i]),
    rain: w.daily.precipitation_probability_max[i],
  });
  return { now: Math.round(w.current.temperature_2m), ...wmo(w.current.weather_code), today: day(0), tomorrow: day(1) };
}

/* ---- data: the ⑶ from 145 St, downtown (MTA GTFS-RT, keyless) ---- */
const FEED = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";
const ALERTS = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json";
const STOP_DOWNTOWN = "302S";                        // 145 St (Lenox) southbound platform

async function fetchTrains() {
  const [{ transit_realtime }, buf] = await Promise.all([
    import("https://esm.sh/gtfs-realtime-bindings@1.1.1").then((m) => m.default || m),
    fetch(FEED).then((r) => r.arrayBuffer()),
  ]);
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buf));
  const now = Date.now() / 1000;
  const mins = [];
  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    if (!tu || !tu.trip || tu.trip.routeId !== "3") continue;
    for (const stu of tu.stopTimeUpdate || []) {
      if (stu.stopId !== STOP_DOWNTOWN) continue;
      const t = (stu.arrival && stu.arrival.time) || (stu.departure && stu.departure.time);
      if (t == null) continue;
      const secs = (typeof t === "object" ? t.toNumber() : +t) - now;
      if (secs > -30) mins.push(Math.max(0, Math.round(secs / 60)));
    }
  }
  mins.sort((a, b) => a - b);
  return { mins: mins.slice(0, 4), at: new Date() };
}

async function fetchDelays() {
  const j = await fetch(ALERTS).then((r) => r.json());
  const now = Date.now() / 1000;
  const out = [];
  for (const e of j.entity || []) {
    const a = e.alert; if (!a) continue;
    if (!(a.informed_entity || []).some((ie) => ie.route_id === "3")) continue;
    const active = !a.active_period || a.active_period.some((p) => (!p.start || p.start <= now) && (!p.end || p.end >= now));
    if (!active) continue;
    const head = a.header_text && a.header_text.translation && a.header_text.translation[0] && a.header_text.translation[0].text;
    if (head) out.push(head);
  }
  return out.slice(0, 3);
}

/* ---- data: today & tomorrow from the Love Bug calendar ---- */
const iso = (d) => d.toISOString().slice(0, 10);
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyTime = (t) => {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const am = hh < 12;
  return `${((hh + 11) % 12) + 1}${mm ? ":" + String(mm).padStart(2, "0") : ""}${am ? "am" : "pm"}`;
};

async function fetchPlans(client) {
  const t0 = new Date();
  const t1 = new Date(t0.getTime() + 86400000);
  const t2 = new Date(t0.getTime() + 2 * 86400000);
  const { data } = await client.from("events").select("*")
    .gte("starts_on", localISO(t0)).lt("starts_on", localISO(t2))
    .order("starts_on").order("starts_at");
  const rows = data || [];
  return {
    today: rows.filter((r) => r.starts_on === localISO(t0)),
    tomorrow: rows.filter((r) => r.starts_on === localISO(t1)),
  };
}

/* ---- the scene ---- */
export function Lakeside({ client, players }) {
  const rootRef = useRef(null);
  const [plans, setPlans] = useState(null);
  const [wx, setWx] = useState(null);
  const [trains, setTrains] = useState(null);
  const [delays, setDelays] = useState(null);
  const [err, setErr] = useState({});
  const verse = dailyVerse();

  // fetch only once the lake is actually LOOKED AT; trains re-fetch every 60s
  // while it stays in view (the GTFS feed is ~180KB — never poll it unseen)
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    let iv = 0;
    const loadSlow = () => {
      fetchPlans(client).then(setPlans).catch(() => setErr((e) => ({ ...e, plans: 1 })));
      fetchWeather().then(setWx).catch(() => setErr((e) => ({ ...e, wx: 1 })));
      fetchDelays().then(setDelays).catch(() => setErr((e) => ({ ...e, delays: 1 })));
    };
    const loadTrains = () => fetchTrains().then(setTrains).catch(() => setErr((e) => ({ ...e, trains: 1 })));
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) {
        loadSlow(); loadTrains();
        clearInterval(iv);
        iv = setInterval(loadTrains, 60000);
      } else { clearInterval(iv); iv = 0; }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => { io.disconnect(); clearInterval(iv); };
  }, [client]);

  const planRows = (list) => !list ? html`<span class="lake-dim">…</span>`
    : list.length === 0 ? html`<span class="lake-dim">nothing planned 🕊</span>`
    : list.slice(0, 3).map((ev) => html`<div key=${ev.id} class="lake-plan">
        <span>${ev.emoji}</span>
        <span class="lake-plan-t">${ev.title}</span>
        <span class="lake-dim tnum">${prettyTime(ev.starts_at)}${ev.location ? ` · ${ev.location}` : ""}</span>
      </div>`);

  return html`<div class="lakeside" ref=${rootRef}>
    <svg class="lake-svg" viewBox="0 0 390 720" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <filter id="l-wc" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" />
        </filter>
        <linearGradient id="l-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#bfe0f2" /><stop offset=".55" stop-color="#8ec3e6" /><stop offset="1" stop-color="#6ba7d4" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="390" height="720" fill="#faf5ef" />
      <!-- sky washes -->
      <ellipse cx="195" cy="90" rx="240" ry="100" fill="#cfe7f5" opacity=".45" filter="url(#l-wc)" />
      <ellipse cx="120" cy="190" rx="200" ry="90" fill="#ffd9cf" opacity=".22" filter="url(#l-wc)" />
      <circle cx="60" cy="64" r="18" fill="#ffd166" filter="url(#l-wc)" />
      <g stroke="#f4c542" stroke-width="2" stroke-linecap="round" opacity=".8">
        <path d="M60 38 v-8" /><path d="M84 46 l6 -6" /><path d="M36 46 l-6 -6" /><path d="M87 64 h8" />
      </g>
      <!-- calm clouds -->
      <g fill="#fff" stroke="#d9cfc2" stroke-width="2" stroke-linejoin="round" filter="url(#l-wc)">
        <path d="M258 76 c-10 0 -14 -8 -8 -14 c-4 -8 6 -14 13 -9 c2 -11 18 -12 23 -3 c9 -4 18 4 13 12 c6 7 -2 14 -9 12 c-6 3 -26 4 -32 2 Z" />
        <path d="M96 130 c-8 0 -11 -6 -6 -11 c-3 -6 5 -11 10 -7 c2 -8 14 -9 18 -2 c7 -3 14 3 10 9 c5 5 -2 11 -7 9 c-5 2 -20 3 -25 2 Z" opacity=".85" />
      </g>
      <!-- far meadow + hills -->
      <ellipse cx="80" cy="352" rx="220" ry="60" fill="#cdeac0" opacity=".55" filter="url(#l-wc)" />
      <ellipse cx="330" cy="368" rx="180" ry="52" fill="#b9dcab" opacity=".5" filter="url(#l-wc)" />
      <!-- the lake -->
      <ellipse cx="195" cy="470" rx="178" ry="102" fill="url(#l-water)" stroke="#7fb0d6" stroke-width="2.5" filter="url(#l-wc)" />
      <g stroke="#eaf6fd" stroke-width="2.4" stroke-linecap="round" opacity=".75" filter="url(#l-wc)">
        <path d="M96 452 h44 M168 438 h30 M236 460 h52 M128 496 h38 M216 502 h46 M170 528 h34" />
      </g>
      <!-- lily pads + blooms -->
      <g filter="url(#l-wc)">
        <ellipse cx="132" cy="512" rx="17" ry="8" fill="#7fb069" />
        <path d="M132 512 l16 -4 l-3 7 Z" fill="#8ec3e6" />
        <ellipse cx="268" cy="486" rx="14" ry="7" fill="#93bd78" />
        <path transform="translate(263 480) scale(.8)" fill="#ff8fa3" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />
        <ellipse cx="212" cy="548" rx="15" ry="7" fill="#7fb069" />
      </g>
      <!-- two swans, necks bowed into half a heart -->
      <g filter="url(#l-wc)">
        <path d="M168 470 c-12 0 -18 -8 -14 -15 c3 -6 10 -6 12 -2 c-1 -8 -8 -10 -8 -17 c0 -8 8 -12 13 -8"
          fill="none" stroke="#fdfaf4" stroke-width="6" stroke-linecap="round" />
        <path d="M222 470 c12 0 18 -8 14 -15 c-3 -6 -10 -6 -12 -2 c1 -8 8 -10 8 -17 c0 -8 -8 -12 -13 -8"
          fill="none" stroke="#fdfaf4" stroke-width="6" stroke-linecap="round" />
        <ellipse cx="166" cy="472" rx="13" ry="8" fill="#fdfaf4" />
        <ellipse cx="224" cy="472" rx="13" ry="8" fill="#fdfaf4" />
        <path d="M158 448 l-5 2 l5 2 Z" fill="#f4a53a" /><path d="M232 448 l5 2 l-5 2 Z" fill="#f4a53a" />
      </g>
      <!-- shoreline flowers & reeds -->
      <g filter="url(#l-wc)">
        <g stroke="#5c8a4e" stroke-width="2.4" stroke-linecap="round" fill="none">
          <path d="M46 560 c2 -16 -2 -26 -6 -34 M58 566 c0 -14 4 -26 10 -34 M338 552 c-2 -16 2 -28 8 -36 M350 560 c0 -12 -4 -24 -10 -32" />
        </g>
        <ellipse cx="40" cy="522" rx="4" ry="9" fill="#8a5a44" /><ellipse cx="358" cy="512" rx="4" ry="9" fill="#8a5a44" />
        <g>
          <path transform="translate(84 588) scale(1.1)" fill="#ff8fa3" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />
          <circle cx="120" cy="600" r="7" fill="#ffd166" /><circle cx="120" cy="600" r="3" fill="#e8934a" />
          <path transform="translate(296 592) scale(.9)" fill="#c4a6ff" d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />
          <circle cx="268" cy="604" r="6" fill="#ff9e7d" /><circle cx="268" cy="604" r="2.6" fill="#fff4e6" />
          <path transform="translate(330 610) scale(1.05)" fill="#ff8fa3" d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />
          <circle cx="52" cy="612" r="6" fill="#ffd166" /><circle cx="52" cy="612" r="2.6" fill="#e8934a" />
        </g>
        <g stroke="#7fb069" stroke-width="2" stroke-linecap="round" fill="none" opacity=".9">
          <path d="M84 596 v14 M120 607 v12 M296 600 v14 M268 610 v10 M330 618 v10 M52 618 v10" />
        </g>
      </g>
      <!-- meadow foreground -->
      <rect x="0" y="628" width="390" height="92" fill="#cdeac0" filter="url(#l-wc)" />
      <ellipse cx="90" cy="646" rx="30" ry="8" fill="#7fb069" opacity=".45" />
      <ellipse cx="300" cy="652" rx="34" ry="9" fill="#7fb069" opacity=".4" />
      <!-- the path back to the castle → -->
      <path d="M300 720 C330 690 352 676 390 668 L390 720 Z" fill="#e8c39e" opacity=".8" filter="url(#l-wc)" />
    </svg>

    <!-- the message in the sky -->
    <div class="lake-versebox">
      <p class=${`lake-verse ${verse.text.length > 120 ? "long" : ""}`}>“${verse.text}”</p>
      <div class="lake-verse-ref">${verse.ref}</div>
    </div>

    <!-- the world's little dispatches -->
    <div class="lake-cards">
      <div class="lake-card">
        <div class="eyebrow">today & tomorrow</div>
        <div class="lake-day"><b>Today</b>${planRows(plans && plans.today)}</div>
        <div class="lake-day"><b>Tomorrow</b>${planRows(plans && plans.tomorrow)}</div>
      </div>
      <div class="lake-card lake-row2">
        <div class="lake-wx">
          <div class="eyebrow">new york</div>
          ${wx ? html`
            <div class="lake-wx-now">${wx.emoji} <b class="tnum">${wx.now}°</b> <span class="lake-dim">${wx.label}</span></div>
            <div class="lake-dim tnum">today ${wx.today.hi}°/${wx.today.lo}°${wx.today.rain >= 30 ? ` · ☔️ ${wx.today.rain}%` : ""}</div>
            <div class="lake-dim tnum">tmrw ${wx.tomorrow.emoji} ${wx.tomorrow.hi}°/${wx.tomorrow.lo}°${wx.tomorrow.rain >= 30 ? ` · ☔️ ${wx.tomorrow.rain}%` : ""}</div>`
          : html`<div class="lake-dim">${err.wx ? "weather unavailable" : "…"}</div>`}
        </div>
        <div class="lake-train">
          <div class="eyebrow"><span class="bullet3">3</span> 145 St → downtown</div>
          ${trains ? html`
            <div class="lake-train-times tnum">${trains.mins.length
              ? trains.mins.map((m, i) => html`<b key=${i}>${m === 0 ? "now" : m + "m"}</b>`)
              : "no trains posted"}</div>
            <div class="lake-dim">picked up ${trains.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>`
          : html`<div class="lake-dim">${err.trains ? "arrivals unavailable" : "…"}</div>`}
          ${delays == null
            ? (err.delays ? html`<div class="lake-dim">status unavailable</div>` : null)
            : delays.length === 0
              ? html`<div class="lake-good">✓ good service</div>`
              : delays.map((d, i) => html`<div key=${i} class="lake-delay">⚠️ ${d}</div>`)}
        </div>
      </div>
    </div>
  </div>`;
}
