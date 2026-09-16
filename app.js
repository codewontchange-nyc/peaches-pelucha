import { h, render, Fragment, Component } from "https://esm.sh/preact@10.23.2";
import {
  useState, useEffect, useMemo, useRef, useCallback,
} from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";
import { PlayTab } from "./game.js";
import { DateRoulette } from "./roulette.js";
import { ScriptureCard } from "./home.js";
import { GratitudeCard } from "./gratitude.js";
import { MemoryThread } from "./comments.js";
import { RewardHome, RewardStrip, useGiftsToDeliver } from "./rewards.js";
import { FightMode, FightToggle } from "./fight.js";
import { DailyShare, DailyHistory, useDailyNeedsMe } from "./daily.js";
import { useRsvpNeeded } from "./events.js";
import { pushStatus, enablePush, disablePush, ensurePush, notifyTurn } from "./push.js";
import { CastleHub, ROOMS } from "./castle.js";
import { GemQuestCard } from "./gemgame.js";
import { get as idbGet, set as idbSet } from "https://esm.sh/idb-keyval@6";

const html = htm.bind(h);

// Lazy-load the heavier per-tab modules so boot only parses the shell + the
// Score tab. Each loads (from the SW cache) the instant its tab is opened.
function lazyTab(loader, name) {
  return function LazyTab(props) {
    const [C, setC] = useState(null);
    useEffect(() => { let live = true; loader().then((m) => { if (live) setC(() => m[name]); }).catch(() => {}); return () => { live = false; }; }, []);
    return C ? h(C, props) : html`<div class="card center"><div class="muted">Loading…</div></div>`;
  };
}
const MemoriesTab = lazyTab(() => import("./memories.js"), "MemoriesTab");
const PlansTab = lazyTab(() => import("./events.js"), "PlansTab");
const MapTab = lazyTab(() => import("./map.js"), "MapCard");
const JoinMe = lazyTab(() => import("./joinme.js"), "JoinMe");

// Navigation is the castle (castle.js): every room is a door in the hub, and
// ROOMS is the registry — labels/emoji for the topbar come from there too.

// (The rotating photo-collage backdrop lived here — retired with the castle
// redesign: rooms now paint their own castle-interior walls via .room-bg.)

// One tab crashing shouldn't blank the whole app. Keyed by tab so it resets on
// navigation (a crashed section recovers when you leave and come back).
class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  componentDidCatch(err) { this.setState({ err }); }
  render() {
    if (this.state.err) return html`<div class="card center">
      <div style="font-size:40px">😵‍💫</div>
      <h2 style="margin:.2em 0">This bit hiccuped</h2>
      <p class="sub">The rest of the app is fine. Try again, or switch tabs.</p>
      <button class="btn" onClick=${() => this.setState({ err: null })}>Try again</button>
    </div>`;
    return this.props.children;
  }
}

/* ============================================================ helpers ===== */

const LS = {
  url: "pp.supabase.url",
  key: "pp.supabase.key",
  me: "pp.currentPlayer",
  couple: "pp.couple",          // a beta couple's own backend, set by their private ?join= link
};

// A private "join" link — ?join=<base64url of {url,key,label}> — pins THIS device
// to a specific couple's database. It's how we add a second beta couple (e.g.
// Mayo & Briuna) on the SAME app + repo, with their own isolated data, without
// any auth/multi-tenant productizing. Consumed once, persisted, then stripped.
(function consumeJoinLink() {
  try {
    const p = new URLSearchParams(location.search);
    const tok = p.get("join");
    if (!tok) return;
    const json = decodeURIComponent(escape(atob(tok.replace(/-/g, "+").replace(/_/g, "/"))));
    const data = JSON.parse(json);
    if (data && data.url && data.key) {
      localStorage.setItem(LS.couple, JSON.stringify({ url: data.url, key: data.key, label: data.label || null }));
      localStorage.removeItem(LS.me);   // new backend → pick your player fresh on this device
    }
    p.delete("join");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } catch {}
})();

function coupleOverride() { try { return JSON.parse(localStorage.getItem(LS.couple) || "null"); } catch { return null; } }

function getCreds() {
  // a joined beta couple's own backend wins over the baked-in default config
  const ov = coupleOverride();
  if (ov && ov.url && ov.key) return { url: ov.url, key: ov.key };
  const cfg = window.PP_CONFIG || {};
  const url = (cfg.SUPABASE_URL || localStorage.getItem(LS.url) || "").trim();
  const key = (cfg.SUPABASE_ANON_KEY || localStorage.getItem(LS.key) || "").trim();
  return { url, key };
}

const EMOJIS = ["🍑", "🧸", "💗", "🐰", "🦊", "🐻", "🐧", "🦄", "🌸", "⭐", "🍓", "🐼", "🐨", "🦁", "🌷", "🍦"];
const COLORS = ["#ff7a91", "#9b6bff", "#3fb27f", "#f2a900", "#ff9e6e", "#5aa9e6", "#e35aa9", "#7bc47f"];

// Standard Phase 10 phase requirements (for reference labels).
const PHASES = [
  "2 sets of 3", "1 set of 3 + 1 run of 4", "1 set of 4 + 1 run of 4",
  "1 run of 7", "1 run of 8", "1 run of 9", "2 sets of 4",
  "7 cards of one color", "1 set of 5 + 1 set of 2", "1 set of 5 + 1 set of 3",
];

const fmt = (n) => (n > 0 ? "+" : "") + n;
const coins = (n) => `${n} 💗`;

/* ============================================================ root ======== */

const DEMO = new URLSearchParams(location.search).has("demo");

function Root() {
  const [creds, setCreds] = useState(getCreds());
  const [client, setClient] = useState(null);
  const [credError, setCredError] = useState("");

  useEffect(() => {
    if (DEMO) {
      import("./demo-client.js").then((m) => setClient(m.createDemoClient()));
      return;
    }
    if (creds.url && creds.key) {
      try {
        setClient(createClient(creds.url, creds.key, { auth: { persistSession: false } }));
        // expose resolved creds for the resumable (TUS) video upload path in memories.js
        window.PP_CREDS = { url: creds.url, key: creds.key };
        setCredError("");
      } catch (e) {
        setCredError(String(e.message || e));
        setClient(null);
      }
    } else {
      setClient(null);
    }
  }, [creds.url, creds.key]);

  const saveCreds = (url, key) => {
    localStorage.setItem(LS.url, url.trim());
    localStorage.setItem(LS.key, key.trim());
    setCreds({ url: url.trim(), key: key.trim() });
  };

  if (DEMO) {
    if (!client) return html`<div class="boot"><div class="boot-heart">💗</div><div class="boot-text">Demo…</div></div>`;
    try { if (new URLSearchParams(location.search).has("demo")) window.__ppClient = client; } catch {}   // console access for demo walkthroughs
  return html`<${App} client=${client} onResetCreds=${() => { location.search = ""; }} />`;
  }
  if (!creds.url || !creds.key) {
    return html`<${SetupScreen} onSave=${saveCreds} error=${credError} />`;
  }
  if (!client) {
    return html`<${SetupScreen} onSave=${saveCreds} error=${credError || "Connecting…"} current=${creds} />`;
  }
  try { if (new URLSearchParams(location.search).has("demo")) window.__ppClient = client; } catch {}   // console access for demo walkthroughs
  return html`<${App} client=${client} onResetCreds=${() => { localStorage.removeItem(LS.url); localStorage.removeItem(LS.key); localStorage.removeItem(LS.couple); setCreds({ url: "", key: "" }); }} />`;
}

/* ============================================================ setup ======= */

function SetupScreen({ onSave, error, current }) {
  const [url, setUrl] = useState(current?.url || "");
  const [key, setKey] = useState(current?.key || "");
  return html`
    <div class="login">
      <div style="font-size:52px">💗</div>
      <h1>Connect your app</h1>
      <p>One-time setup. Paste your Supabase project's <b>URL</b> and <b>anon key</b><br/>(Supabase → Project Settings → API). They stay on this phone.</p>
      <div class="card" style="text-align:left; max-width:420px; margin:0 auto;">
        <label class="field"><span>Project URL</span>
          <input value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
        <label class="field"><span>anon public key</span>
          <input value=${key} onInput=${(e) => setKey(e.target.value)} placeholder="eyJhbGciOi..." /></label>
        ${error && html`<div class="banner" style="background:#ffeef1;color:#b00020">${error}</div>`}
        <button class="btn block" disabled=${!url || !key} onClick=${() => onSave(url, key)}>Connect 💞</button>
      </div>
      <p class="tiny muted">Haven't set up the database yet? Run <b>schema.sql</b> in the Supabase SQL editor first.</p>
    </div>`;
}

/* ============================================================ app ========= */

function App({ client, onResetCreds }) {
  const [players, setPlayers] = useState([]);
  const [game, setGame] = useState(null);        // active game with rounds+entries
  const [earnRules, setEarnRules] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [txns, setTxns] = useState([]);
  const [bets, setBets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [everOk, setEverOk] = useState(false);   // a load has succeeded at least once
  const [err, setErr] = useState("");
  // Mobile radios can hang a request without erroring — after 8s of boot
  // spinner, offer a retry instead of spinning forever.
  const [slowBoot, setSlowBoot] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setSlowBoot(true), 8000);
    return () => clearTimeout(t);
  }, [loaded]);

  const [meId, setMeId] = useState(localStorage.getItem(LS.me) || "");
  const [tab, setTab] = useState("castle");
  const [memUnseen, setMemUnseen] = useState(false);   // 📸 dot when partner added photos you haven't seen
  const [modal, setModal] = useState(null);       // {type, ...props}
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const netDone = useRef(false);   // first network load won → don't let cached data overwrite

  // Warm every tab's module on idle so the first swipe to a tab renders instantly
  // (no "Loading…" card flash, no skipped pane animation).
  useEffect(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    const h = idle(() => {
      import("./events.js"); import("./map.js"); import("./memories.js");
      import("./joinme.js");
    });
    return () => { try { (window.cancelIdleCallback || clearTimeout)(h); } catch {} };
  }, []);

  // castle-hub navigation: no dock, no tab swiping — the hub is the menu.
  // Inside a room, a rightward fling from the left screen edge goes home
  // (iOS back-swipe muscle memory), with the same guards the old tab swipe had.
  const goTab = useCallback((to) => setTab(to), []);
  const edgeRef = useRef(null);
  const tabRef = useRef(tab); tabRef.current = tab;
  const onEdgeDown = useCallback((e) => {
    if (tabRef.current === "castle" || e.clientX > 28) return;
    if (document.querySelector(".gamefs, .modal-bg, .lightbox, .viewer, .mapfull, .dailyfull, .dh-full, .fightfull")) return;
    if (e.target.closest("input, textarea, [data-noswipe]")) return;
    edgeRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);
  const onEdgeUp = useCallback((e) => {
    const d = edgeRef.current; edgeRef.current = null;
    if (!d) return;
    const dx = e.clientX - d.x, dy = Math.abs(e.clientY - d.y);
    const v = dx / Math.max(1, Date.now() - d.t);
    if (dy < 80 && (dx > 70 || (dx > 30 && v > 0.5))) goTab("castle");
  }, [goTab]);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1900);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [pRes, gRes, erRes, rwRes, txRes, btRes] = await Promise.all([
        client.from("players").select("*").order("created_at"),
        client.from("games").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1),
        client.from("earn_rules").select("*").order("sort"),
        client.from("rewards").select("*").order("sort"),
        client.from("transactions").select("*").order("created_at", { ascending: false }).limit(400),
        client.from("bets").select("*").order("created_at", { ascending: false }),
      ]);
      for (const r of [pRes, gRes, erRes, rwRes, txRes, btRes]) if (r.error) throw r.error;

      setPlayers(pRes.data || []);
      setEarnRules(erRes.data || []);
      setRewards(rwRes.data || []);
      setTxns(txRes.data || []);
      setBets(btRes.data || []);

      let gameObj = null;
      const g = (gRes.data || [])[0];
      if (g) {
        const [gpRes, rdRes] = await Promise.all([
          client.from("game_players").select("*").eq("game_id", g.id).order("seat"),
          client.from("rounds").select("*, round_entries(*)").eq("game_id", g.id).order("round_number"),
        ]);
        if (gpRes.error) throw gpRes.error;
        if (rdRes.error) throw rdRes.error;
        gameObj = { ...g, gamePlayers: gpRes.data || [], rounds: rdRes.data || [] };
      }
      setGame(gameObj);
      setErr("");
      setEverOk(true);
      setLoaded(true);
      netDone.current = true;
      // cache the shell for instant reopen next time (live only)
      if (!DEMO) idbSet("pp.shell", { players: pRes.data || [], earnRules: erRes.data || [], rewards: rwRes.data || [], txns: txRes.data || [], bets: btRes.data || [], game: gameObj }).catch(() => {});
    } catch (e) {
      setErr(e.message || String(e));
      setLoaded(true);
    }
  }, [client]);

  // initial load + realtime sync + catch-up when the phone wakes/reconnects
  useEffect(() => { loadAll(); }, [loadAll]);
  // Instant reopen: paint the last-known shell from IndexedDB while loadAll
  // refreshes in the background (stale-while-revalidate). Skipped in demo, and
  // skipped if the network already won the race.
  useEffect(() => {
    if (DEMO) return;
    let live = true;
    idbGet("pp.shell").then((c) => {
      if (!live || !c || netDone.current) return;
      setPlayers(c.players || []); setEarnRules(c.earnRules || []); setRewards(c.rewards || []);
      setTxns(c.txns || []); setBets(c.bets || []); setGame(c.game || null);
      setLoaded(true);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  // Realtime for the shell's own data only. The old version reloaded EVERYTHING
  // on any change to any table (a hearts gift, a reaction, a memory backfill all
  // triggered 6+ queries). Now it (a) ignores tables the shell doesn't read,
  // (b) debounces bursts into one reload, and (c) resubscribes if the socket
  // drops — phones kill it on sleep.
  const SHELL_TABLES = useMemo(() => new Set([
    "players", "games", "game_players", "rounds", "round_entries",
    "transactions", "earn_rules", "rewards", "bets",
  ]), []);
  const reloadTimer = useRef(null);
  const scheduleLoad = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(loadAll, 250);
  }, [loadAll]);
  useEffect(() => {
    let alive = true, ch = null;
    const subscribe = () => {
      ch = client.channel("pp-sync-" + Math.random().toString(36).slice(2, 7))
        .on("postgres_changes", { event: "*", schema: "public" }, (p) => { if (SHELL_TABLES.has(p.table)) scheduleLoad(); })
        .subscribe((status) => {
          if (alive && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
            setTimeout(() => { if (alive) { try { client.removeChannel(ch); } catch {} subscribe(); loadAll(); } }, 1500);
          }
        });
    };
    subscribe();
    // visibilitychange + focus + online all fire together when the phone wakes;
    // route them through the debouncer so one open = ONE reload, not three.
    const wake = () => { if (document.visibilityState === "visible") scheduleLoad(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      alive = false; clearTimeout(reloadTimer.current);
      try { client.removeChannel(ch); } catch {}
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [client, loadAll, scheduleLoad, SHELL_TABLES]);

  const me = players.find((p) => p.id === meId) || null;

  // Keep push alive: iOS quietly expires web-push subscriptions, so re-verify
  // (and silently re-subscribe) on every app open once a player is chosen.
  useEffect(() => { if (me) ensurePush(client, me.id); }, [client, me?.id]);

  // 📸 Unseen-memories dot: light the Memories tab when the OTHER player has
  // added photos/videos since you last opened the gallery; clears when you do.
  const checkMem = useCallback(async () => {
    if (!meId) return;
    const { data } = await client.from("memories").select("created_at,uploaded_by")
      .order("created_at", { ascending: false }).limit(25);
    const seen = localStorage.getItem("pp.memSeen." + meId) || "";
    const newestOther = (data || []).find((m) => m.uploaded_by && m.uploaded_by !== meId);
    setMemUnseen(!!(newestOther && newestOther.created_at > seen));
  }, [client, meId]);
  useEffect(() => { checkMem(); }, [checkMem]);
  useEffect(() => {
    let ch = null;
    try {
      ch = client.channel("pp-mem-" + Math.random().toString(36).slice(2, 6))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "memories" }, checkMem).subscribe();
    } catch {}
    return () => { try { client.removeChannel(ch); } catch {} };
  }, [client, checkMem]);
  // opening the gallery = seeing what's new
  useEffect(() => {
    if (tab === "memories" && meId) { localStorage.setItem("pp.memSeen." + meId, new Date().toISOString()); setMemUnseen(false); }
  }, [tab, meId]);
  const pickMe = (id) => { localStorage.setItem(LS.me, id); setMeId(id); };

  // Self-updating app: the deployed sw.js carries the version beacon (pp-vN).
  // We remember the version we booted with, re-check it on every wake and every
  // 5 minutes, and when it changes: reload instantly at the wake moment (the
  // natural "opening the app" beat), or show a one-tap banner mid-session.
  // Nobody ever has to force-close the PWA to get updates again.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    let bootVer = null, applied = false, hiddenAt = null;
    const ver = async () => {
      try {
        const txt = await fetch("sw.js", { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
        return (txt.match(/pp-v(\d+)/) || [])[1] || null;
      } catch { return null; }
    };
    const check = async (wakeAt) => {
      const v = await ver();
      if (!v) return;
      if (bootVer === null) { bootVer = v; return; }
      if (v === bootVer || applied) return;
      applied = true;
      try { (await navigator.serviceWorker?.getRegistration())?.update(); } catch {}
      // Auto-reload only in the first beat after opening — before the person is
      // reading or mid-tap. If the version fetch came back late (slow network),
      // a surprise reload feels broken; fall back to the one-tap banner.
      // …and only after a real absence (≥ 2 min hidden). A quick app-switch
      // that came back to a sudden reload read as a glitch, not an update.
      const fresh = wakeAt && Date.now() - wakeAt < 1500;
      const longAway = hiddenAt && wakeAt && wakeAt - hiddenAt > 120000;
      if (fresh && longAway && !window.__ppDragging) location.reload();
      else setUpdateReady(true);
    };
    check();                                     // record the booted version
    window.__ppCheckUpdate = check;              // debug/test hook
    const wake = () => { if (document.visibilityState === "visible") check(Date.now()); else hiddenAt = Date.now(); };
    document.addEventListener("visibilitychange", wake);
    const iv = setInterval(() => { if (document.visibilityState === "visible") check(false); }, 5 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", wake); clearInterval(iv); };
  }, []);

  // balances from transactions
  const balances = useMemo(() => {
    const b = {};
    for (const p of players) b[p.id] = 0;
    for (const t of txns) b[t.player_id] = (b[t.player_id] || 0) + t.amount;
    return b;
  }, [players, txns]);

  // 🏰 living doors — what's waiting behind each one (badges on the hub)
  const dailyNeedsMe = useDailyNeedsMe(client, me);
  const rsvpNeeded = useRsvpNeeded(client, me);
  const giftsToDeliver = useGiftsToDeliver(client, me);

  /* ---- data actions (all log to state via loadAll on realtime) ---- */
  const api = useMemo(() => makeApi(client, loadAll, flash), [client, loadAll, flash]);

  // Full-screen error only when we have NOTHING to show. If the IndexedDB
  // shell already painted (players present), keep the app up — the wake/online
  // listeners re-sync the moment the connection returns.
  if (err && !everOk && !players.length) {
    const needsSchema = /could not find the table|does not exist|schema cache/i.test(err);
    return html`<div class="login"><div style="font-size:40px">😕</div><h1>Connection trouble</h1>
      ${needsSchema
        ? html`<p>Connected to Supabase, but the tables aren't there yet.<br/>Run <b>schema.sql</b> in your project's SQL Editor, then tap Try again.</p>
               <p class="tiny muted">(${err})</p>`
        : html`<p>${err}</p>`}
      <button class="btn" onClick=${loadAll}>Try again</button>
      <button class="linkbtn" onClick=${onResetCreds}>Change connection settings</button></div>`;
  }
  if (!loaded) return html`<div class="boot"><div class="boot-heart">💗</div><div class="boot-text">Loading…</div>
    ${slowBoot && html`<div style="margin-top:14px;text-align:center">
      <div class="tiny muted" style="margin-bottom:8px">Slow connection…</div>
      <button class="btn" onClick=${loadAll}>Try again</button>
    </div>`}</div>`;

  if (!me) {
    return html`<${Login} players=${players} onPick=${pickMe}
      onAdd=${() => setModal({ type: "editPlayer" })}
      modal=${modal} setModal=${setModal} api=${api} />`;
  }

  const ctx = { client, players, game, earnRules, rewards, txns, bets, balances, me, api, setModal, flash, setTab };

  const hub = tab === "castle";     // the castle hub paints its own sky — no photo backdrop
  const mem = tab === "memories";   // Memories is its own white, full-bleed space — no glass container, no photo backdrop (that container broke the photo carousel)
  const mapTab = tab === "map";     // Map is full-bleed too (edge-to-edge preview), but keeps the cool glass world
  const room = ROOMS[tab] || null;  // castle registry drives the room title chip

  // each couple's app is named after THEM (derived from their two players), so a
  // beta couple's app feels like theirs — not "Peaches & Pelucha".
  const coupleName = players.length ? players.map((p) => p.name).join(" & ").toLowerCase() : "love";
  useEffect(() => { if (players.length) document.title = players.map((p) => p.name).join(" & "); }, [players]);

  return html`
    <div class=${`app-shell cool ${mem ? "mem" : ""} ${mapTab ? "map" : ""} ${hub ? "hub" : `room-${tab}`}`}
      onPointerDown=${onEdgeDown} onPointerUp=${onEdgeUp} onPointerCancel=${() => { edgeRef.current = null; }}>
      ${!hub && html`<div class="room-bg"></div>`}
      <div class="topbar">
        ${hub
          ? html`<div class="brand script">${coupleName}</div>
                 <button class="hubcoin" onClick=${() => goTab("schmoney")}>💗 ${balances[me.id] ?? 0}</button>`
          : html`<button class="whoami backchip" onClick=${() => goTab("castle")}>‹ 🏰</button>
                 <div class="roomtitle">${room ? `${room.emoji} ${room.label}` : ""}</div>`}
        <button class="whoami" onClick=${() => goTab("more")}>
          <span class="av" style=${`background:${me.color}22`}>${me.emoji}</span>
          ${me.name}
        </button>
      </div>

      ${err && html`<div class="banner" style="background:#ffeef1;color:#b00020">⚠️ ${err}</div>`}

      ${hub
        ? html`<div class="hub-enter">
            <${BirthdayBanner} me=${me} players=${players} />
            <${CastleHub} client=${client} players=${players} me=${me} balances=${balances} onEnter=${goTab}
              badges=${{ memories: memUnseen ? "✨" : null, chapel: dailyNeedsMe,
                         plans: rsvpNeeded ? "💌" : null, schmoney: giftsToDeliver ? "🎁" : null }} />
          </div>`
        : html`<div class="swipe-wrap" key=${tab}>
            <div class="portal-ava" aria-hidden="true">${me.emoji}</div>
            <${Settle} dir=${1} key=${tab}>
            <${ErrorBoundary} key=${tab}>
              ${tab === "gameroom" && html`<${GameRoom} ...${ctx} />`}
              ${tab === "chapel" && html`<${ChapelRoom} ...${ctx} />`}
              ${tab === "plans" && html`<${Fragment}>
                <${PlansTab} client=${client} me=${me} players=${players} flash=${flash} />
                <${DateRoulette} client=${client} me=${me} players=${players} flash=${flash}
                  onPlan=${(pick) => { window.__ppPlanPrefill = pick; window.dispatchEvent(new Event("pp-plan-prefill")); }} />
              <//>`}
              ${tab === "map" && html`<${MapTab} client=${client} me=${me} players=${players} flash=${flash} />`}
              ${tab === "memories" && html`<${Fragment}>
                <${MemoryThread} client=${client} me=${me} players=${players}
                  onOpenMemory=${(id) => { window.__ppFocusMemory = id; window.dispatchEvent(new Event("pp-focus-memory")); }} />
                <${MemoriesTab} client=${client} me=${me} players=${players} flash=${flash} />
              <//>`}
              ${tab === "schmoney" && html`<${Fragment}>
                <${RewardHome} client=${client} me=${me} players=${players} flash=${flash} />
                <${WalletTab} ...${ctx} />
                <${BetsTab} ...${ctx} />
                <${ShopTab} ...${ctx} />
              <//>`}
              ${tab === "joinme" && html`<${JoinMe} client=${client} me=${me} players=${players} flash=${flash} />`}
              ${tab === "more" && html`<${MoreTab} ...${ctx} onResetCreds=${onResetCreds} />`}
            <//>
            <//>
          </div>`}

      <${FightMode} client=${client} me=${me} players=${players} />
      <${DailyShare} client=${client} me=${me} players=${players} />
      ${modal && html`<${Modal} modal=${modal} close=${() => setModal(null)} ...${ctx} pickMe=${pickMe} onResetCreds=${onResetCreds} />`}
      ${toast && html`<div class="toast">${toast}</div>`}
      ${updateReady && html`<button class="updbar" onClick=${() => location.reload()}>✨ Update ready — tap to refresh</button>`}
    </div>`;
}

/* ============================================================ API ========= */

function makeApi(client, reload, flash) {
  const guard = async (fn, okMsg) => {
    const { error } = await fn();
    if (error) { flash("⚠️ " + error.message); return false; }
    if (okMsg) flash(okMsg);
    await reload();
    return true;
  };
  return {
    reload,
    addPlayer: (name, emoji, color) =>
      guard(() => client.from("players").insert({ name, emoji, color }), `Added ${name} ${emoji}`),
    updatePlayer: (id, patch) =>
      guard(() => client.from("players").update(patch).eq("id", id), "Saved"),
    deletePlayer: (id) => guard(() => client.from("players").delete().eq("id", id), "Removed"),

    newGame: async (name, playerIds) => {
      const { data, error } = await client.from("games").insert({ name: name || null }).select().single();
      if (error) { flash("⚠️ " + error.message); return; }
      await client.from("game_players").insert(playerIds.map((id, i) => ({ game_id: data.id, player_id: id, seat: i })));
      flash("New game! 🎴");
      reload();
    },
    addRound: async (gameId, roundNumber, entries) => {
      const { data, error } = await client.from("rounds").insert({ game_id: gameId, round_number: roundNumber }).select().single();
      if (error) { flash("⚠️ " + error.message); return; }
      const rows = entries.map((e) => ({ round_id: data.id, player_id: e.player_id, points: e.points, completed_phase: e.completed_phase }));
      const { error: e2 } = await client.from("round_entries").insert(rows);
      if (e2) { flash("⚠️ " + e2.message); return; }
      flash("Round saved ✅");
      reload();
    },
    deleteRound: (roundId) => guard(() => client.from("rounds").delete().eq("id", roundId), "Round removed"),
    finishGame: (gameId, winnerId) =>
      guard(() => client.from("games").update({ status: "finished", winner_id: winnerId, finished_at: new Date().toISOString() }).eq("id", gameId), "Game finished 🏁"),

    earn: (playerId, amount, description, type = "earn") =>
      guard(() => client.from("transactions").insert({ player_id: playerId, amount, description, type }),
        `${fmt(amount)} 💗 ${description}`),
    gift: async (fromId, toId, amount, note) => {
      const desc = note || "Gift";
      const { error } = await client.from("transactions").insert([
        { player_id: fromId, amount: -amount, type: "gift", description: `Gift → ${desc}` },
        { player_id: toId, amount: amount, type: "gift", description: `Gift ← ${desc}` },
      ]);
      if (error) { flash("⚠️ " + error.message); return; }
      flash(`Gifted ${amount} 💗`);
      reload();
    },
    cashout: async (playerId, reward, partnerId) => {
      const { error } = await client.from("transactions").insert({ player_id: playerId, amount: -reward.cost, type: "cashout", description: `Redeemed: ${reward.label}` });
      if (error) { flash("⚠️ " + error.message); return false; }
      // a redemption the partner must deliver → their sweet home card + a reward memory
      try {
        await client.from("redemptions").insert({ reward_label: reward.label, reward_emoji: reward.emoji || "🎁", cost: reward.cost, redeemer_id: playerId, fulfiller_id: partnerId || null, status: "pending" });
        if (partnerId) notifyTurn(client, partnerId, "🎁 A reward was redeemed", `Open the app — they're ready for "${reward.label}" 💗`);
      } catch {}
      flash(`Redeemed ${reward.label} 🎁`);
      await reload();
      return true;
    },
    deleteTxn: (id) => guard(() => client.from("transactions").delete().eq("id", id), "Entry removed"),

    addEarnRule: (label, amount, emoji) => guard(() => client.from("earn_rules").insert({ label, amount, emoji }), "Added"),
    updateEarnRule: (id, patch) => guard(() => client.from("earn_rules").update(patch).eq("id", id), "Saved"),
    deleteEarnRule: (id) => guard(() => client.from("earn_rules").delete().eq("id", id), "Removed"),

    addReward: (label, cost, emoji) => guard(() => client.from("rewards").insert({ label, cost, emoji }), "Added"),
    updateReward: (id, patch) => guard(() => client.from("rewards").update(patch).eq("id", id), "Saved"),
    deleteReward: (id) => guard(() => client.from("rewards").delete().eq("id", id), "Removed"),

    newBet: (description, stake, challengerId, opponentId) =>
      guard(() => client.from("bets").insert({ description, stake, challenger_id: challengerId, opponent_id: opponentId }), "Bet placed 🎲"),
    settleBet: async (bet, winnerId) => {
      const loserId = winnerId === bet.challenger_id ? bet.opponent_id : bet.challenger_id;
      const { error } = await client.from("transactions").insert([
        { player_id: winnerId, amount: bet.stake, type: "bet", description: `Won bet: ${bet.description}` },
        { player_id: loserId, amount: -bet.stake, type: "bet", description: `Lost bet: ${bet.description}` },
      ]);
      if (error) { flash("⚠️ " + error.message); return; }
      await client.from("bets").update({ status: "settled", winner_id: winnerId, settled_at: new Date().toISOString() }).eq("id", bet.id);
      flash("Bet settled 🏁");
      reload();
    },
    voidBet: (id) => guard(() => client.from("bets").update({ status: "void" }).eq("id", id), "Bet voided"),
    deleteBet: (id) => guard(() => client.from("bets").delete().eq("id", id), "Bet deleted"),
  };
}

/* ============================================================ login ======= */

function Login({ players, onPick, onAdd, modal, setModal, api }) {
  // tap a player → personalize your emoji (keyboard emoji welcome) → jump in
  const [sel, setSel] = useState(null);   // { id, name, emoji }
  const hero = players.length >= 2 ? `${players[0].emoji}💗${players[1].emoji}` : "💗";

  if (sel) {
    const orig = (players.find((p) => p.id === sel.id) || {}).emoji;
    const jumpIn = async () => {
      const e = (sel.emoji || "").trim();
      if (e && e !== orig) { try { await api.updatePlayer(sel.id, { emoji: e }); } catch {} }
      onPick(sel.id);
    };
    return html`<div class="login">
      <div class="login-bigemoji">${sel.emoji || "💗"}</div>
      <h1>Hi ${sel.name} 💗</h1>
      <p>Make it yours — pick an emoji, or type your own.</p>
      <div style="max-width:360px;margin:0 auto">
        <${EmojiPicker} value=${sel.emoji} onChange=${(e) => setSel((s) => ({ ...s, emoji: e }))} />
      </div>
      <button class="btn block mt" style="max-width:360px;margin:16px auto 0" onClick=${jumpIn}>That's me ✓</button>
      <button class="linkbtn mt" onClick=${() => setSel(null)}>‹ not me</button>
    </div>`;
  }

  return html`
    <div class="login">
      <div style="font-size:52px">${hero}</div>
      <h1>Who's playing?</h1>
      <p>Tap yourself to jump in.</p>
      <div class="player-grid" style="max-width:420px;margin:0 auto">
        ${players.map((p) => html`
          <button class="player-pick" key=${p.id} onClick=${() => setSel({ id: p.id, name: p.name, emoji: p.emoji })}>
            <span class="av" style=${`background:${p.color}22`}>${p.emoji}</span>
            <span class="nm">${p.name}</span>
          </button>`)}
        <button class="player-pick" onClick=${onAdd}>
          <span class="av" style="background:#fff0f3">➕</span>
          <span class="nm">Add player</span>
        </button>
      </div>
      ${modal && html`<${Modal} modal=${modal} close=${() => setModal(null)} players=${players} api=${api} />`}
    </div>`;
}

/* ------------------------------------------------------ birthday banner 🎂
   On a player's birthday (players.birthday = 'MM-DD') the home page opens with
   a banner — one voice for the birthday person, another for their partner —
   and every tap rains confetti over the whole screen. */
function BirthdayBanner({ me, players }) {
  const [bursts, setBursts] = useState([]);
  const d = new Date();
  const today = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const bday = players.find((p) => p.birthday === today);
  if (!bday) return null;
  const mine = bday.id === me.id;
  const rain = () => {
    const id = Math.random().toString(36).slice(2);
    setBursts((b) => [...b, id]);
    try { navigator.vibrate && navigator.vibrate([40, 30, 90]); } catch {}
    setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 4400);
  };
  const EMO = ["🎂", "🎉", "🎈", "✨", "💗", bday.emoji];
  return html`<div class=${`card bdaycard ${mine ? "isyou" : ""}`} onClick=${rain} role="button">
    <div class="bday-band" aria-hidden="true">🎈 🎂 🎈</div>
    ${mine
      ? html`<div class="bday-title">Happy birthday, ${bday.name} ${bday.emoji}</div>
             <div class="bday-sub">today is all yours, baby — tap me 🎂</div>`
      : html`<div class="bday-title">It's ${bday.emoji} ${bday.name}'s birthday</div>
             <div class="bday-sub">spoil them rotten today — tap to celebrate</div>`}
    ${bursts.map((id) => createPortal(html`<div class="bdayrain" key=${id} aria-hidden="true">
      ${[...Array(48)].map((_, i) => html`<span key=${i}
        style=${`left:${(i * 41 + 13) % 100}%; animation-delay:${(i % 11) * 150}ms; animation-duration:${2300 + (i % 5) * 400}ms; font-size:${16 + (i % 4) * 8}px`}>${EMO[i % EMO.length]}</span>`)}
    </div>`, document.body))}
  </div>`;
}

/* ============================================================ Score ======= */
// The Score tab is now the live, playable Phase 10 game (see game.js), with the
// The home screen: current game (prominent) → lifetime line → his & hers
// Cancer horoscopes → daily scripture → Date Night Roulette.

/* Settle: a pane's cards each fetch on their own, so without this they'd pop in
   one by one in random spots. Hold the pane invisible until its DOM goes quiet
   (≈160ms with no mutations, 800ms max), THEN play the slide-in — so the
   animation always shows a complete page instead of an assembling one. */
function Settle({ children, dir }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let quiet = null, done = false, mo = null;
    const fire = () => { if (done) return; done = true; setReady(true); try { mo && mo.disconnect(); } catch {} clearTimeout(quiet); clearTimeout(max); };
    const kick = () => { clearTimeout(quiet); quiet = setTimeout(fire, 160); };
    try { mo = new MutationObserver(kick); mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true }); } catch {}
    const max = setTimeout(fire, 800);
    kick();
    return () => { try { mo && mo.disconnect(); } catch {} clearTimeout(quiet); clearTimeout(max); };
  }, []);
  return html`<div ref=${ref} class=${ready ? (dir > 0 ? "pane-from-r" : "pane-from-l") : "settling"}>${children}</div>`;
}

// 🃏 Game Room — Phase 10 and Gem Quest side by side.
function GameRoom(ctx) {
  return html`<div data-noswipe>
    <${PlayTab} ...${ctx} />
    <${GemQuestCard} client=${ctx.client} me=${ctx.me} players=${ctx.players} flash=${ctx.flash} />
  </div>`;
}

// ☀️ Sunroom — the quiet corner: scripture, gratitude, the daily question.
function ChapelRoom(ctx) {
  return html`<${Fragment}>
    <${DailyHistory} client=${ctx.client} me=${ctx.me} players=${ctx.players} />
    <${GratitudeCard} client=${ctx.client} me=${ctx.me} players=${ctx.players} flash=${ctx.flash} />
    <${ScriptureCard} />
  <//>`;
}


/* ============================================================ Wallet ====== */

function WalletTab(ctx) {
  const { players, balances, txns, me, setModal, api } = ctx;
  return html`
    <div class="card">
      <div class="shead"><h2>Hearts</h2></div>
      <div class="score-head">
        ${players.map((p) => html`
          <div class="score-tile">
            <div class="nm"><i class="dot" style=${`background:${p.color}`}></i>${p.emoji} ${p.name}</div>
            <div class="pts tnum">${balances[p.id] || 0}</div>
            <div class="ph">hearts</div>
          </div>`)}
      </div>
      <div class="spread mt">
        <button class="btn block" onClick=${() => setModal({ type: "earn" })}>Grant hearts</button>
        <button class="btn ghost block" onClick=${() => setModal({ type: "gift" })}>Gift</button>
      </div>
    </div>

    <div class="card">
      <div class="shead"><h2>Recent activity</h2></div>
      <${TxnList} txns=${txns.slice(0, 40)} players=${players} api=${api} canDelete=${true} />
    </div>`;
}

function TxnList({ txns, players, api, canDelete }) {
  if (!txns.length) return html`<div class="empty"><span class="big">🌱</span>Nothing yet.</div>`;
  const nameOf = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "?" };
  return html`<div class="list">
    ${txns.map((t) => {
      const p = nameOf(t.player_id);
      return html`<div class="line" key=${t.id}>
        <div class="l"><span class="em">${p.emoji}</span>
          <div class="txt"><b>${t.description || t.type}</b>
            <span class="tiny muted">${p.name} · ${when(t.created_at)}</span></div></div>
        <div class="row">
          <span class=${`amt ${t.amount >= 0 ? "pos" : "neg"}`}>${fmt(t.amount)}</span>
          ${canDelete && html`<button class="linkbtn danger" title="delete" onClick=${() => api.deleteTxn(t.id)}>✕</button>`}
        </div>
      </div>`;
    })}
  </div>`;
}

/* ============================================================ Bets ======== */

function BetsTab(ctx) {
  const { bets, players, me, api, setModal } = ctx;
  const nameOf = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "?" };
  const open = bets.filter((b) => b.status === "open");
  const done = bets.filter((b) => b.status !== "open");
  return html`
    <div class="card">
      <div class="shead"><h2>Open bets</h2>
        <div class="shead-actions"><button class="btn sm" onClick=${() => setModal({ type: "newBet" })}>＋ New</button></div></div>
      ${!open.length && html`<div class="empty"><span class="big">🤝</span>No live wagers. Make one!</div>`}
      <div class="list">
        ${open.map((b) => {
          const c = nameOf(b.challenger_id), o = nameOf(b.opponent_id);
          return html`<div class="line" key=${b.id} style="flex-direction:column;align-items:stretch;gap:8px">
            <div class="row between">
              <div class="l"><div class="txt"><b>${b.description}</b>
                <span class="tiny muted">${c.emoji}${c.name} vs ${o.emoji}${o.name} · stake ${b.stake} 💗</span></div></div>
              <span class="pill open">open</span>
            </div>
            <div class="spread">
              <button class="btn good sm" onClick=${() => api.settleBet(b, b.challenger_id)}>${c.emoji} ${c.name} won</button>
              <button class="btn good sm" onClick=${() => api.settleBet(b, b.opponent_id)}>${o.emoji} ${o.name} won</button>
            </div>
            <button class="linkbtn" onClick=${() => api.voidBet(b.id)}>void bet</button>
          </div>`;
        })}
      </div>
    </div>

    ${done.length > 0 && html`<div class="card"><div class="shead"><h2>History</h2></div><div class="list">
      ${done.map((b) => {
        const w = b.winner_id ? nameOf(b.winner_id) : null;
        return html`<div class="line" key=${b.id}>
          <div class="l"><span class="em">${b.status === "void" ? "🚫" : "🏁"}</span>
            <div class="txt"><b>${b.description}</b>
              <span class="tiny muted">${b.status === "void" ? "voided" : `${w?.emoji}${w?.name} won ${b.stake} 💗`}</span></div></div>
          ${b.status === "settled" ? html`<span class="pill win">+${b.stake}</span>` : html`<span class="pill">—</span>`}
        </div>`;
      })}
    </div></div>`}`;
}

/* ============================================================ Shop ======== */

function ShopTab(ctx) {
  const { rewards, me, players, client, balances, api, setModal } = ctx;
  const bal = balances[me.id] || 0;
  const active = rewards.filter((r) => r.active);
  return html`
    <div class="card center">
      <div class="muted tiny">${me.emoji} ${me.name}, you have</div>
      <div class="balance-big">${bal} 💗</div>
    </div>
    <div class="card">
      <div class="shead"><h2>Reward shop</h2>
        <div class="shead-actions"><button class="btn sm ghost" onClick=${() => setModal({ type: "manageRewards" })}>Edit</button></div></div>
      ${!active.length && html`<div class="empty"><span class="big">🎁</span>No rewards yet — add some!</div>`}
      <div class="list">
        ${active.map((r) => {
          const can = bal >= r.cost;
          return html`<div class="line" key=${r.id}>
            <div class="l"><span class="em">${r.emoji}</span><div class="txt"><b>${r.label}</b>
              <span class="tiny muted">${r.cost} 💗</span></div></div>
            <button class="btn sm ${can ? "" : ""}" disabled=${!can}
              onClick=${() => setModal({ type: "confirmCashout", reward: r })}>${can ? "Redeem" : "Need more"}</button>
          </div>`;
        })}
      </div>
    </div>
    <${RewardStrip} client=${client} me=${me} players=${players} />`;
}

/* ============================================================ More ======== */

function MoreTab(ctx) {
  const { players, setModal, txns, api, onResetCreds, client, me, flash } = ctx;
  const [alerts, setAlerts] = useState("…");
  useEffect(() => { pushStatus().then(setAlerts); }, []);
  const toggleAlerts = async () => {
    try {
      if (alerts === "enabled") { await disablePush(client); flash("Turn alerts off"); }
      else { await enablePush(client, me.id); flash("Turn alerts on 🔔"); }
      setAlerts(await pushStatus());
    } catch (e) { flash("⚠️ " + (e.message || e)); }
  };
  const alertsLabel =
    alerts === "enabled" ? "🔔 Turn alerts: on — tap to turn off"
    : alerts === "denied" ? "🔕 Notifications blocked in system settings"
    : alerts === "unsupported" ? "🔕 Turn alerts (open the installed app)"
    : "🔔 Get notified when it's your turn";
  return html`
    <div class="card">
      <div class="shead"><h2>Players</h2></div>
      <div class="list">
        ${players.map((p) => html`<div class="line" key=${p.id}>
          <div class="l"><span class="av" style=${`background:${p.color}22;width:34px;height:34px;border-radius:50%;display:grid;place-content:center`}>${p.emoji}</span>
            <div class="txt"><b>${p.name}</b></div></div>
          <button class="btn ghost sm" onClick=${() => setModal({ type: "editPlayer", player: p })}>Edit</button>
        </div>`)}
        <button class="btn ghost block" onClick=${() => setModal({ type: "editPlayer" })}>＋ Add player</button>
      </div>
    </div>

    <${FightToggle} client=${client} me=${me} players=${players} />

    <div class="card">
      <div class="shead"><h2>Customise</h2></div>
      <div class="list">
        <button class="btn ghost block" onClick=${() => setModal({ type: "manageEarn" })}>✨ Earn buttons</button>
        <button class="btn ghost block" onClick=${() => setModal({ type: "manageRewards" })}>🎁 Reward shop</button>
        <button class="btn ghost block" onClick=${() => setModal({ type: "history" })}>📜 Full history</button>
      </div>
    </div>

    <div class="card">
      <div class="shead"><h2>This phone</h2></div>
      <div class="list">
        <button class="btn ghost block" disabled=${alerts === "denied" || alerts === "…"} onClick=${toggleAlerts}>${alertsLabel}</button>
        <button class="btn ghost block" onClick=${() => setModal({ type: "switch" })}>🔁 Switch player</button>
        <button class="btn ghost block" onClick=${() => setModal({ type: "install" })}>📲 Install to home screen</button>
        <button class="btn ghost block" onClick=${onResetCreds}>🔌 Change Supabase connection</button>
      </div>
      <p class="tiny muted center mt">Made with 💗 for ${players.length ? players.map((p) => p.name).join(" & ") : "the two of you"}</p>
    </div>`;
}

/* ============================================================ Modal ======= */

function Modal(props) {
  const { modal, close } = props;
  return html`<div class="modal-bg" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) close(); }}>
    <div class="modal">
      <div class="handle"></div>
      <${ModalBody} ...${props} />
    </div>
  </div>`;
}

function ModalBody(props) {
  const { modal } = props;
  switch (modal.type) {
    case "editPlayer": return html`<${EditPlayerModal} ...${props} />`;
    case "switch": return html`<${SwitchModal} ...${props} />`;
    case "earn": return html`<${EarnModal} ...${props} />`;
    case "gift": return html`<${GiftModal} ...${props} />`;
    case "newBet": return html`<${NewBetModal} ...${props} />`;
    case "confirmCashout": return html`<${CashoutModal} ...${props} />`;
    case "manageEarn": return html`<${ManageEarnModal} ...${props} />`;
    case "manageRewards": return html`<${ManageRewardsModal} ...${props} />`;
    case "history": return html`<${HistoryModal} ...${props} />`;
    case "install": return html`<${InstallModal} ...${props} />`;
    default: return null;
  }
}

function EmojiPicker({ value, onChange, allowCustom = true }) {
  return html`<div class="emoji-pick">
    <div class="emoji-row">
      ${EMOJIS.map((e) => html`<button class=${value === e ? "on" : ""} onClick=${() => onChange(e)}>${e}</button>`)}
    </div>
    ${allowCustom && html`<input class="emoji-custom" value=${value} maxlength="8" inputmode="text"
      onInput=${(e) => onChange(e.target.value)} placeholder="…or type your own 😀" />`}
  </div>`;
}
function ColorPicker({ value, onChange }) {
  return html`<div class="emoji-row">
    ${COLORS.map((c) => html`<button class=${value === c ? "on" : ""} style=${`background:${c};width:30px;height:30px`} onClick=${() => onChange(c)}></button>`)}
  </div>`;
}

function EditPlayerModal({ modal, close, api }) {
  const p = modal.player;
  const [name, setName] = useState(p?.name || "");
  const [emoji, setEmoji] = useState(p?.emoji || "🍑");
  const [color, setColor] = useState(p?.color || COLORS[0]);
  const save = async () => {
    if (!name.trim()) return;
    if (p) await api.updatePlayer(p.id, { name: name.trim(), emoji, color });
    else await api.addPlayer(name.trim(), emoji, color);
    close();
  };
  return html`<div>
    <h3>${p ? "Edit player" : "New player"}</h3>
    <label class="field"><span>Name</span><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Name or nickname" /></label>
    <label class="field"><span>Emoji</span></label><${EmojiPicker} value=${emoji} onChange=${setEmoji} />
    <label class="field mt"><span>Colour</span></label><${ColorPicker} value=${color} onChange=${setColor} />
    <button class="btn block mt" onClick=${save}>${p ? "Save" : "Add"}</button>
    ${p && html`<button class="linkbtn danger mt" onClick=${async () => { if (confirm(`Remove ${p.name}?`)) { await api.deletePlayer(p.id); close(); } }}>Delete player</button>`}
  </div>`;
}

function SwitchModal({ players, close, pickMe, me }) {
  return html`<div>
    <h3>Switch player</h3>
    <div class="player-grid">
      ${players.map((p) => html`<button class="player-pick" key=${p.id} onClick=${() => { pickMe(p.id); close(); }}>
        <span class="av" style=${`background:${p.color}22`}>${p.emoji}</span>
        <span class="nm">${p.name}${me?.id === p.id ? " ✓" : ""}</span>
      </button>`)}
    </div>
  </div>`;
}

function Stepper({ value, set, step = 5, min = 0 }) {
  return html`<div class="stepper">
    <button onClick=${() => set(Math.max(min, value - step))}>−</button>
    <input style="text-align:center" inputmode="numeric" value=${value}
      onInput=${(e) => { const v = parseInt(e.target.value.replace(/[^0-9-]/g, ""), 10); set(isNaN(v) ? 0 : v); }} />
    <button onClick=${() => set(value + step)}>＋</button>
  </div>`;
}

function EarnModal({ players, earnRules, me, close, api, setModal }) {
  const [who, setWho] = useState(me.id);
  const [custom, setCustom] = useState(20);
  const [note, setNote] = useState("");
  const active = earnRules.filter((r) => r.active);
  return html`<div>
    <h3>Grant hearts ✨</h3>
    <label class="field"><span>To</span>
      <div class="seg">${players.map((p) => html`<button class=${who === p.id ? "on" : ""} onClick=${() => setWho(p.id)}>${p.emoji} ${p.name}</button>`)}</div>
    </label>
    <div class="list">
      ${active.map((r) => html`<div class="line" key=${r.id}>
        <div class="l"><span class="em">${r.emoji}</span><b>${r.label}</b></div>
        <button class="btn good sm" onClick=${async () => { await api.earn(who, r.amount, r.label); close(); }}>+${r.amount}</button>
      </div>`)}
    </div>
    <hr class="soft" />
    <label class="field"><span>Custom</span></label>
    <div class="row between">
      <input value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="Reason (optional)" style="flex:1" />
      <${Stepper} value=${custom} set=${setCustom} />
    </div>
    <button class="btn good block mt" onClick=${async () => { await api.earn(who, custom, note || "Hearts"); close(); }}>Grant ${custom} 💗</button>
    <button class="linkbtn mt" onClick=${() => setModal({ type: "manageEarn" })}>Edit earn buttons →</button>
  </div>`;
}

function GiftModal({ players, me, balances, close, api }) {
  const other = players.find((p) => p.id !== me.id);
  const [to, setTo] = useState(other?.id || me.id);
  const [amt, setAmt] = useState(10);
  const [note, setNote] = useState("");
  const bal = balances[me.id] || 0;
  return html`<div>
    <h3>Gift hearts 💝</h3>
    <p class="sub">From ${me.emoji} ${me.name} (balance ${bal} 💗)</p>
    <label class="field"><span>To</span>
      <div class="seg">${players.filter((p) => p.id !== me.id).map((p) => html`<button class=${to === p.id ? "on" : ""} onClick=${() => setTo(p.id)}>${p.emoji} ${p.name}</button>`)}</div>
    </label>
    <label class="field"><span>Note (optional)</span><input value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="just because 💕" /></label>
    <div class="center"><${Stepper} value=${amt} set=${setAmt} /></div>
    <button class="btn plum block mt" disabled=${amt <= 0 || amt > bal || to === me.id}
      onClick=${async () => { await api.gift(me.id, to, amt, note); close(); }}>${amt > bal ? "Not enough 💗" : `Send ${amt} 💗`}</button>
  </div>`;
}

function NewBetModal({ players, me, close, api }) {
  const other = players.find((p) => p.id !== me.id);
  const [desc, setDesc] = useState("");
  const [stake, setStake] = useState(10);
  const [opp, setOpp] = useState(other?.id || "");
  return html`<div>
    <h3>New bet 🎲</h3>
    <label class="field"><span>What's the wager?</span><input value=${desc} onInput=${(e) => setDesc(e.target.value)} placeholder="e.g. Loser cooks tonight" /></label>
    <label class="field"><span>Against</span>
      <div class="seg">${players.filter((p) => p.id !== me.id).map((p) => html`<button class=${opp === p.id ? "on" : ""} onClick=${() => setOpp(p.id)}>${p.emoji} ${p.name}</button>`)}</div>
    </label>
    <label class="field"><span>Stake (each puts up this many 💗)</span></label>
    <div class="center"><${Stepper} value=${stake} set=${setStake} /></div>
    <button class="btn block mt" disabled=${!desc.trim() || !opp || stake <= 0}
      onClick=${async () => { await api.newBet(desc.trim(), stake, me.id, opp); close(); }}>Place bet</button>
    <p class="tiny muted center mt">Hearts move when you settle the bet, not now.</p>
  </div>`;
}

function CashoutModal({ modal, me, players, balances, close, api }) {
  const r = modal.reward;
  const bal = balances[me.id] || 0;
  const partner = (players || []).find((p) => p.id !== me.id);
  return html`<div class="center">
    <div style="font-size:46px">${r.emoji}</div>
    <h3>Redeem "${r.label}"?</h3>
    <p class="sub">This spends <b>${r.cost} 💗</b>. You'll have ${bal - r.cost} 💗 left.${partner ? html`<br/>${partner.emoji} ${partner.name} will get a card to deliver it 💗` : ""}</p>
    <button class="btn gold block mt" disabled=${bal < r.cost} onClick=${async () => { await api.cashout(me.id, r, partner ? partner.id : null); close(); }}>Redeem 🎁</button>
    <button class="linkbtn mt" onClick=${close}>Cancel</button>
  </div>`;
}

function EmojiAmountForm({ initial, onSubmit, amountLabel, submitLabel }) {
  const [label, setLabel] = useState(initial?.label || "");
  const [amt, setAmt] = useState(initial?.amount ?? initial?.cost ?? 10);
  const [emoji, setEmoji] = useState(initial?.emoji || "✨");
  return html`<div class="card" style="background:#fff7f9;box-shadow:none">
    <label class="field"><span>Label</span><input value=${label} onInput=${(e) => setLabel(e.target.value)} placeholder="What is it?" /></label>
    <div class="row between">
      <div><div class="tiny muted" style="font-weight:800;margin-bottom:5px">${amountLabel}</div><${Stepper} value=${amt} set=${setAmt} /></div>
    </div>
    <div class="tiny muted" style="font-weight:800;margin:10px 0 5px">Emoji</div>
    <${EmojiPicker} value=${emoji} onChange=${setEmoji} />
    <button class="btn block mt" disabled=${!label.trim()} onClick=${() => { onSubmit(label.trim(), amt, emoji); setLabel(""); }}>${submitLabel}</button>
  </div>`;
}

function ManageEarnModal({ earnRules, close, api }) {
  return html`<div>
    <h3>Earn buttons ✨</h3>
    <div class="list">
      ${earnRules.map((r) => html`<div class="line" key=${r.id}>
        <div class="l"><span class="em">${r.emoji}</span><div class="txt"><b>${r.label}</b><span class="tiny muted">+${r.amount} 💗</span></div></div>
        <button class="linkbtn danger" onClick=${() => api.deleteEarnRule(r.id)}>✕</button>
      </div>`)}
    </div>
    <hr class="soft" />
    <${EmojiAmountForm} amountLabel="Hearts" submitLabel="Add earn button"
      onSubmit=${(l, a, e) => api.addEarnRule(l, a, e)} />
  </div>`;
}

function ManageRewardsModal({ rewards, close, api }) {
  return html`<div>
    <h3>Reward shop 🎁</h3>
    <div class="list">
      ${rewards.map((r) => html`<div class="line" key=${r.id}>
        <div class="l"><span class="em">${r.emoji}</span><div class="txt"><b>${r.label}</b><span class="tiny muted">${r.cost} 💗</span></div></div>
        <button class="linkbtn danger" onClick=${() => api.deleteReward(r.id)}>✕</button>
      </div>`)}
    </div>
    <hr class="soft" />
    <${EmojiAmountForm} initial=${{ emoji: "🎁" }} amountLabel="Cost" submitLabel="Add reward"
      onSubmit=${(l, a, e) => api.addReward(l, a, e)} />
  </div>`;
}

function HistoryModal({ txns, players, api }) {
  return html`<div>
    <h3>Full history 📜</h3>
    <${TxnList} txns=${txns} players=${players} api=${api} canDelete=${true} />
  </div>`;
}

function InstallModal() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return html`<div>
    <h3>Install to home screen 📲</h3>
    ${ios ? html`<p>In <b>Safari</b>: tap the <b>Share</b> button (square with ↑), then <b>“Add to Home Screen”</b>. It'll open full-screen like an app.</p>`
      : html`<p>In <b>Chrome</b>: tap the <b>⋮ menu</b>, then <b>“Add to Home screen” / “Install app.”</b></p>`}
    <p class="tiny muted">Both phones can install it. Everything stays in sync through Supabase.</p>
  </div>`;
}

/* ============================================================ utils ======= */

function when(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

/* ============================================================ mount ======= */

render(html`<${Root} />`, document.getElementById("app"));
