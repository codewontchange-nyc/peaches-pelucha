import { h } from "https://esm.sh/preact@10.23.2";
import { useEffect, useRef, useState } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { dailyVerse } from "./home.js";

const html = htm.bind(h);

/* ☁️ The sky above the castle — swipe UP from home and the hand-drawn
   clouds rise with you. At the summit: the day's scripture. On the way:
   what we're doing today & tomorrow (calendar), New York weather, and
   the ⑶ from 145 St heading downtown.

   Live data loads lazily — nothing fetches until the sky is actually
   in view; train arrivals refresh every 60s while it stays visible. */

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
  return out.slice(0, 2);
}

/* ---- data: today & tomorrow from the Love Bug calendar ---- */
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

/* ---- the hand-drawn sky ---- */
const CLOUD = "M24 62 C11 62 5 52 12 43 C6 33 18 26 28 32 C30 17 50 13 58 25 C65 11 89 13 90 31 C107 29 115 45 103 55 C109 64 96 67 88 63 C80 67 32 67 24 62 Z";
const Cloud = ({ style, soft }) => html`<svg class=${`skyc ${soft ? "soft" : ""}`} style=${style} viewBox="0 0 120 74" fill="none" aria-hidden="true">
  <path d=${CLOUD} fill="#fff" stroke=${soft ? "#dfe9f2" : "#111"} stroke-width=${soft ? 2 : 3} stroke-linejoin="round" vector-effect="non-scaling-stroke" />
</svg>`;

export function SkyRealm({ client, players }) {
  const rootRef = useRef(null);
  const [plans, setPlans] = useState(null);
  const [wx, setWx] = useState(null);
  const [trains, setTrains] = useState(null);
  const [delays, setDelays] = useState(null);
  const [err, setErr] = useState({});
  const verse = dailyVerse();

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
    }, { threshold: 0.15 });
    io.observe(el);
    return () => { io.disconnect(); clearInterval(iv); };
  }, [client]);

  // one narrative sentence per day: "Today, 🍝 Dinner at Nonna's at 7pm."
  const daySentence = (list, label) => html`<span key=${label}>
    <b class="sky-day">${label}</b>${!list ? "…"
      : list.length === 0 ? html`, the calendar is open — a free day together 🕊`
      : list.slice(0, 3).map((ev, i) => html`<span key=${ev.id}>${i > 0 ? ", then" : ","} ${ev.emoji} <b>${ev.title}</b>${ev.starts_at ? ` at ${prettyTime(ev.starts_at)}` : ""}${ev.location ? ` · ${ev.location}` : ""}</span>`)}. </span>`;

  const rainNote = (d) => (d.rain >= 30 ? ` (☔️ ${d.rain}%)` : "");
  const minsProse = (mins) => mins.map((m, i) => html`<b key=${i} class="tnum">${m === 0 ? "now" : m}</b>${i < mins.length - 2 ? ", " : i === mins.length - 2 ? " & " : ""}`);

  return html`<div class="skyrealm" ref=${rootRef}>
    <!-- living sky: the cloud field opens with the ascent; the sun holds
         its place above you (both driven by --fly, set by the scroller) -->
    <div class="sky-air" aria-hidden="true">
      <${Cloud} soft style="--y:8%; --d:86s; --s:1.5; --o:.85; --neg:-40s" />
      <${Cloud} style="--y:19%; --d:58s; --s:1; --o:.95; --neg:-12s" />
      <${Cloud} soft style="--y:34%; --d:95s; --s:1.9; --o:.75; --neg:-66s" />
      <${Cloud} style="--y:49%; --d:64s; --s:.85; --o:.9; --neg:-30s" />
      <${Cloud} soft style="--y:64%; --d:78s; --s:1.4; --o:.8; --neg:-52s" />
      <${Cloud} style="--y:80%; --d:70s; --s:1.1; --o:.9; --neg:-8s" />
      <svg class="sky-bird" style="--y:28%; --d:34s; --neg:-6s" viewBox="0 0 40 20" fill="none">
        <path d="M2 12 Q10 2 20 11 Q30 2 38 12" stroke="#111" stroke-width="2.5" stroke-linecap="round" />
      </svg>
      <svg class="sky-bird" style="--y:56%; --d:41s; --neg:-22s" viewBox="0 0 40 20" fill="none">
        <path d="M2 12 Q10 2 20 11 Q30 2 38 12" stroke="#111" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </div>
    <svg class="sky-sun" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <circle cx="60" cy="60" r="26" fill="#ffd166" stroke="#e8a53a" stroke-width="2.5" />
      <g stroke="#f4c542" stroke-width="3" stroke-linecap="round" class="sun-rays">
        <path d="M60 18 v-10" /><path d="M60 102 v10" /><path d="M18 60 h-10" /><path d="M102 60 h10" />
        <path d="M31 31 l-7 -7" /><path d="M89 31 l7 -7" /><path d="M31 89 l-7 7" /><path d="M89 89 l7 7" />
      </g>
    </svg>

    <!-- one elegant screen: unbounded editorial lines over the moving sky -->
    <div class="sky-content">
      <p class=${`sky-verse ${verse.text.length > 150 ? "xlong" : verse.text.length > 90 ? "long" : ""}`}>“${verse.text}”</p>
      <div class="sky-verse-ref">${verse.ref}</div>

      <div class="sky-orn">✦</div>
      <p class="sky-par">
        <span class="sky-cap">our days</span><br/>
        ${daySentence(plans && plans.today, "Today")}${daySentence(plans && plans.tomorrow, "Tomorrow")}
        ${err.plans ? html`<span class="sky-soft">calendar unavailable</span>` : null}
      </p>

      <div class="sky-orn">✦</div>
      <p class="sky-par">
        <span class="sky-cap">new york</span><br/>
        ${wx ? html`${wx.emoji} <b class="tnum">${wx.now}°</b> and ${wx.label} right now —
          today <span class="tnum">${wx.today.hi}°/${wx.today.lo}°</span>${rainNote(wx.today)},
          tomorrow ${wx.tomorrow.emoji} <span class="tnum">${wx.tomorrow.hi}°/${wx.tomorrow.lo}°</span>${rainNote(wx.tomorrow)}.`
        : html`<span class="sky-soft">${err.wx ? "weather unavailable" : "…"}</span>`}
      </p>

      <div class="sky-orn">✦</div>
      <p class="sky-par">
        <span class="sky-cap"><span class="bullet3">3</span> 145 st → downtown</span><br/>
        ${trains ? html`${trains.mins.length
            ? html`next trains in ${minsProse(trains.mins)} min <span class="sky-soft">(as of ${trains.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})</span>`
            : "no trains posted right now"}`
          : html`<span class="sky-soft">${err.trains ? "arrivals unavailable" : "…"}</span>`}
        ${delays == null
          ? (err.delays ? html`<br/><span class="sky-soft">status unavailable</span>` : null)
          : delays.length === 0
            ? html`<br/><span class="sky-good">✓ good service on the 3</span>`
            : delays.map((d, i) => html`<br key=${"b" + i}/><span key=${i} class="sky-delay">⚠️ ${d}</span>`)}
      </p>

      <div class="sky-descent">the castle awaits below ⌄</div>
    </div>
  </div>`;
}
