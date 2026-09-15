import { h, Fragment } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* ☀️ The morning ritual — now non-blocking. Once a day the question appears as
   a dismissible overlay ("answer later" always available); the app is NEVER
   gated. When the second answer lands, the other person gets a push and BOTH
   phones get a one-time reveal popup with the two answers. One row per day in
   `daily_shares`; the first to open seeds the question (deterministic by date,
   so both phones seed the same one). */

/* The bank. Mixed on purpose — little-you, grown-you, us, and the fun stuff —
   so mornings don't settle into one groove. The picker below never repeats a
   question until every one has been asked (then it cycles, avoiding recents). */
const QUESTIONS = [
  // ☀️ little you
  "What cartoon did you race home from school to watch?",
  "What did you want to be when you grew up — at age seven?",
  "What's a smell that drops you straight back into childhood?",
  "What was your most regrettable childhood haircut?",
  "What snack or candy was your whole personality as a kid?",
  "What song did you know every single word to growing up?",
  "What toy did you BEG your parents for?",
  "What's a weird thing you fully believed as a kid?",
  "What was your nickname growing up?",
  "What game did everyone play at recess?",
  "What's the bravest thing little-you ever did?",
  "Who was your first ever celebrity crush?",
  "What family meal did your house make that nobody else's did?",
  "What were you weirdly good at as a kid?",
  "What's a phrase a grandparent always used to say?",
  "What's the first concert or movie you remember going to?",
  "What trouble did you get into the most as a kid?",
  "What's a tradition your family did that you still love?",
  "What's the dorkiest hobby you had as a kid?",
  "What did you think being a grown-up would be like?",
  "What's a vacation from childhood you still daydream about?",
  "What did your childhood bedroom look like?",

  // 🎒 teenage you
  "What was your first screen name or email address?",
  "What was your go-to outfit at sixteen?",
  "What song was playing in your head all through high school?",
  "What's the most teenage thing you ever did for a crush?",
  "Which teacher actually changed something for you?",
  "What's a trend you fully committed to that you'd never admit to now?",
  "What was your first real job and what did it teach you?",
  "What did you and your friends do when there was nothing to do?",
  "What did you think you'd be doing at this age?",
  "What movie did you quote constantly with your friends?",

  // 🏠 grown-up you
  "What was your first apartment like — and what did it smell like?",
  "What's the best money you've ever spent on yourself?",
  "What's a life lesson that cost you something to learn?",
  "What's a skill you picked up as an adult that you're quietly proud of?",
  "What's the most grown-up purchase that made you feel like a real adult?",
  "What's a job you had that taught you the most about people?",
  "What's the best piece of advice you've actually followed?",
  "What's something you believed in your twenties that you've completely reversed on?",
  "What's a habit you wish you'd started ten years earlier?",
  "Who's an adult friendship that surprised you by lasting?",
  "What's the worst boss you ever had — and what did they teach you anyway?",
  "What's a hard season of life you came out of better?",
  "What's your favorite thing about being the age you are now?",
  "What's something you're better at now than you were five years ago?",
  "What's a risk you're glad you took?",
  "What's a risk you didn't take that still crosses your mind?",
  "What does a perfect ordinary Tuesday look like for you?",
  "What's a small daily ritual you'd be genuinely sad to lose?",
  "What's a thing you've gotten surprisingly picky about with age?",
  "What did you used to care about that just doesn't register anymore?",

  // 🔍 getting to know you
  "What's a food you'd defend in an argument?",
  "What's your real, honest morning routine?",
  "What's a compliment you received years ago that you still think about?",
  "What's something you find beautiful that most people walk right past?",
  "What's a hill you will absolutely die on?",
  "What's a fear you've mostly beaten?",
  "What's the best meal you've ever eaten, anywhere?",
  "What's a place that made you feel instantly at home?",
  "Which three things make a day good, no matter what else happens?",
  "What do you do to recharge that people don't expect?",
  "What's your love language — actually, not the quiz answer?",
  "What's a strong opinion you hold about something tiny?",
  "What's a book, show, or album that rewired something in you?",
  "What's the nicest thing a stranger has ever done for you?",
  "What's a skill you'd love to be secretly amazing at?",
  "What's something people get wrong about you on first impression?",
  "What are you most particular about in your space?",
  "What would your closest friend say is your best quality?",
  "What's a rule you live by that you never say out loud?",
  "When do you feel most like yourself?",
  "What's a sound you love?",
  "What's something you miss that nobody else seems to?",
  "What's your favorite way to spend money on other people?",
  "What's a small luxury you'll never give up?",
  "What's a conversation you're still proud of how you handled?",

  // 💗 us
  "What was your honest first impression of me?",
  "What's a tiny thing I do that you secretly love?",
  "What's a moment with me you replay in your head?",
  "What's something you've learned about yourself from being with me?",
  "What's a date we should do again exactly the same way?",
  "What's a date we haven't done yet that you'd want to?",
  "What's something I do that makes you feel safe?",
  "What's a song that's ours, even if we never said so?",
  "What's one thing you want us to get better at together?",
  "What's your favorite ordinary moment we share?",
  "What did you notice about me that I don't know you noticed?",
  "What's a way I surprised you?",
  "If we had a whole free weekend and zero obligations, what would you want it to hold?",
  "What's something you hope we still do when we're old?",
  "What's a small thing I could do more of?",
  "What's a food we should learn to cook together?",
  "When did you first feel like we were a team?",
  "What's a nickname you've wanted to call me but haven't?",

  // 🎲 the fun stuff
  "If you had a talk show, who's your first guest?",
  "What's a completely useless talent you have?",
  "What would your walk-up song be?",
  "If you could eat only one cuisine for a year, which one?",
  "What's a movie you can quote start to finish?",
  "What would you do with a totally free, totally secret day?",
  "What's the pettiest thing you've ever done?",
  "If you could instantly master one instrument, which one?",
  "What's your signature move at a karaoke bar?",
  "What's the best costume you've ever worn?",
  "If you could live inside one TV show for a week, which one?",
  "What's a conspiracy theory you'd almost believe?",
  "What's a superpower that's useless but you'd still want?",
  "What would your autobiography be titled?",
  "What's a food combination you love that sounds wrong?",
  "If you could send one text to your twenty-five-year-old self, what's it say?",
  "What's the most 'you' thing you've ever bought?",
  "What would you be famous for in a parallel universe?",
  "What's the best prank you've pulled or had pulled on you?",
  "If you had to teach a class on anything tomorrow, what's the subject?",

  // 🌅 ahead of us
  "What's a place you still really want to see?",
  "What does 'a good life' look like to you in ten years?",
  "What's a skill you want to learn before you're fifty?",
  "What's something you want to be known for?",
  "What's a tradition you want to start?",
  "What would you do with a year off and no money worries?",
  "What kind of old person do you want to be?",
  "What's one thing you want to stop worrying about?",
  "What's a dream you've never said out loud?",
  "What's a small adventure we could do this month?",
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayIndex = (s) => Math.floor(new Date(s + "T00:00:00").getTime() / 864e5);
/* Never repeat: pick from questions not yet asked (checked against history).
   Once every question has been used, cycle — but avoid the most recent 90.
   Deterministic per day + history, so both phones seed the same question;
   the unique(day) constraint settles any race anyway. */
const pickQuestion = (day, used = []) => {
  const asked = new Set(used.map((r) => r.question));
  let pool = QUESTIONS.filter((q) => !asked.has(q));
  if (!pool.length) {
    const recent = new Set(used.slice(0, 90).map((r) => r.question));
    pool = QUESTIONS.filter((q) => !recent.has(q));
    if (!pool.length) pool = QUESTIONS;
  }
  const mix = ((dayIndex(day) * 2654435761) >>> 0) % pool.length;   // spreads categories across days
  return pool[mix];
};
const niceDate = (s) => { try { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); } catch { return ""; } };

export function DailyShare({ client, me, players }) {
  const day = todayStr();
  const [row, setRow] = useState(undefined);      // undefined = loading, null = unavailable (fail open)
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // revealSeen: the both-answers popup was acknowledged (old pp.daily.DAY key counts, for migration)
  const [revealSeen, setRevealSeen] = useState(() => { try { return localStorage.getItem("pp.daily.seen." + day) === "1" || localStorage.getItem("pp.daily." + day) === "1"; } catch { return false; } });
  // askOpen: the question overlay — auto-opens once per day, reopenable from the home card
  const [askDismissed, setAskDismissed] = useState(() => { try { return localStorage.getItem("pp.daily.ask." + day) === "1"; } catch { return false; } });
  const [askOpen, setAskOpen] = useState(false);
  const partner = players.find((p) => p.id !== me.id) || null;

  const load = useCallback(async () => {
    try {
      const { data } = await client.from("daily_shares").select("*").eq("day", day).limit(1);
      let r = data && data[0];
      if (!r) {
        const hist = await client.from("daily_shares").select("question,day").order("day", { ascending: false }).limit(1000);
        const ins = await client.from("daily_shares").insert({ day, question: pickQuestion(day, hist.data || []), answers: {} }).select().single();
        if (ins.data) r = ins.data;
        else { const re = await client.from("daily_shares").select("*").eq("day", day).limit(1); r = re.data && re.data[0]; }   // someone else just seeded it
      }
      setRow(r || null);
      try { window.dispatchEvent(new Event("pp-daily-changed")); } catch {}
    } catch { setRow(null); }     // fail open — never lock people out on an error
  }, [client, day]);

  useEffect(() => {
    const reopen = () => { setAskOpen(true); };
    window.addEventListener("pp-open-daily", reopen);
    const refresh = () => load();
    window.addEventListener("pp-daily-refresh", refresh);
    load();
    let ch = null;
    try { ch = client.channel("pp-daily").on("postgres_changes", { event: "*", schema: "public", table: "daily_shares" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => { window.removeEventListener("pp-open-daily", reopen); window.removeEventListener("pp-daily-refresh", refresh); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);


  const submit = async () => {
    const t = draft.trim();
    if (!t || !row) return;
    setBusy(true);
    for (let i = 0; i < 4; i++) {       // version-guarded merge (both phones may write at once)
      const { data: cur } = await client.from("daily_shares").select("*").eq("id", row.id).single();
      if (!cur) break;
      const next = { ...(cur.answers || {}), [me.id]: t };
      const { data: upd } = await client.from("daily_shares").update({ answers: next, version: cur.version + 1 }).eq("id", cur.id).eq("version", cur.version).select();
      if (upd && upd.length) { setRow(upd[0]); setAskOpen(false); try { window.dispatchEvent(new Event("pp-daily-changed")); } catch {} break; }
      await new Promise((r) => setTimeout(r, 160));
    }
    setBusy(false);
    if (partner && !answers[partner.id]) {
      try { notifyTurn(client, partner.id, "☀️ Today's little question", `${me.emoji} ${me.name} answered — add yours when you have a sec`); } catch {}
    } else if (partner) {
      // you just completed the pair → their popup is waiting; tell them
      try { notifyTurn(client, partner.id, "☀️ Both answers are in", `${me.emoji} ${me.name} answered too — open to see what you both said`); } catch {}
    }
  };

  const dismissAsk = () => { try { localStorage.setItem("pp.daily.ask." + day, "1"); } catch {} setAskDismissed(true); setAskOpen(false); };
  const closeReveal = () => { try { localStorage.setItem("pp.daily.seen." + day, "1"); } catch {} setRevealSeen(true); setAskOpen(false); };

  const answers = (row && row.answers) || {};
  const mine = answers[me.id];
  const both = players.length >= 2 && players.every((p) => answers[p.id]);

  if (row === undefined || row === null) return null;     // loading or unavailable — the app is never held up

  const showAsk = !mine && (askOpen || !askDismissed);    // dismissible question overlay
  const showReveal = both && !revealSeen;                 // one-time both-answers popup
  if (!showAsk && !showReveal) return null;

  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "?" };

  let body;
  if (showReveal) {
    body = html`<div class="daily-reveal">
      <div class="daily-q small">${row.question}</div>
      <div class="daily-cards">
        ${players.map((p) => html`<div class=${`daily-card ${p.id === me.id ? "mine" : ""}`} key=${p.id}>
          <div class="daily-who">${p.emoji} ${p.name}</div>
          <div class="daily-ans">${answers[p.id]}</div>
        </div>`)}
      </div>
      <button class="btn block daily-btn" onClick=${closeReveal}>💗 Love it</button>
    </div>`;
  } else {
    body = html`<div class="daily-step">
      <div class="daily-q">${row.question}</div>
      <textarea class="daily-input" rows="3" autofocus value=${draft} maxlength="280"
        onInput=${(e) => setDraft(e.target.value)} placeholder="say the first thing that comes to mind…"></textarea>
      <button class="btn block daily-btn" disabled=${busy || !draft.trim()} onClick=${submit}>${busy ? "Sharing…" : "Share ☀️"}</button>
      <button class="daily-later" onClick=${dismissAsk}>answer later</button>
    </div>`;
  }

  return createPortal(html`<div class="dailyfull lock" onClick=${(e) => { if (e.target.classList.contains("dailyfull") && !showReveal) dismissAsk(); }}>
    <div class="daily-inner">
      <div class="daily-eyebrow">${showReveal ? "what you both shared" : "today's little question"} · ${niceDate(day)}</div>
      <div class="daily-sun">☀️</div>
      ${body}
    </div>
  </div>`, document.body);
}

/* A small home card with the latest answered question → tap for the full log. */
export function DailyHistory({ client, me, players }) {
  const [rows, setRows] = useState(null);
  const [allRows, setAllRows] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await client.from("daily_shares").select("day,question,answers").order("day", { ascending: false }).limit(180);
      setAllRows(data || []);
      setRows((data || []).filter((r) => players.length >= 2 && players.every((p) => r.answers && r.answers[p.id])));   // log shows only days you BOTH answered
    } catch { setRows([]); setAllRows([]); }
  }, [client, players]);
  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-dailyhist").on("postgres_changes", { event: "*", schema: "public", table: "daily_shares" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pp-daily-changed", load);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("pp-daily-changed", load); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const today = todayStr();
  const todayRow = (allRows || []).find((r) => r.day === today);
  const needsMe = todayRow && !(todayRow.answers && todayRow.answers[me.id]);

  if ((!rows || !rows.length) && !needsMe) return null;    // nothing to show → no clutter
  const latest = rows && rows[0];

  return html`<${Fragment}>
    ${needsMe && html`<div class="card dailynudge" onClick=${() => window.dispatchEvent(new Event("pp-open-daily"))}>
      <div class="shead"><h2>Today's question <span class="muted-glyph">☀️</span></h2><span class="linkbtn micro">answer →</span></div>
      <div class="dh-q">${todayRow.question}</div>
    </div>`}
    ${latest && html`<div class="card dailyhist" onClick=${() => setOpen(true)}>
    <div class="shead"><h2>Daily questions <span class="muted-glyph">☀️</span></h2><span class="linkbtn micro">${rows.length} →</span></div>
    <div class="dh-q">${latest.question}</div>
    <div class="dh-peek">${players.map((p) => html`<span class="dh-peek-a" key=${p.id}>${p.emoji} ${latest.answers[p.id]}</span>`)}</div>

    ${open && createPortal(html`<div class="dh-full" onClick=${(e) => { if (e.target.classList.contains("dh-full")) setOpen(false); }}>
      <div class="dh-bar">
        <span class="dh-title">Daily questions ☀️</span>
        <button class="dh-x" onClick=${() => setOpen(false)}>✕</button>
      </div>
      <div class="dh-list">
        ${rows.map((r) => html`<div class="dh-entry" key=${r.day}>
          <div class="dh-date">${niceDate(r.day)}</div>
          <div class="dh-eq">${r.question}</div>
          ${players.map((p) => html`<div class="dh-ans" key=${p.id}>
            <span class="dh-ans-who">${p.emoji} ${p.name}</span>
            <span class="dh-ans-txt">${r.answers[p.id]}</span>
          </div>`)}
        </div>`)}
      </div>
    </div>`, document.body)}
  </div>`}
  <//>`;
}

/* Castle-door badge: does today's question still need MY answer? True only
   once today's row exists (DailyShare seeds it on app open). Refreshes on the
   pp-daily-changed bridge, realtime, and wake. */
export function useDailyNeedsMe(client, me) {
  const [needs, setNeeds] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await client.from("daily_shares").select("answers").eq("day", todayStr()).limit(1);
      const row = data && data[0];
      setNeeds(!!(row && !(row.answers && row.answers[me.id])));
    } catch {}
  }, [client, me && me.id]);
  useEffect(() => {
    load();
    window.addEventListener("pp-daily-changed", load);
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    let ch = null;
    try { ch = client.channel("pp-daily-badge").on("postgres_changes", { event: "*", schema: "public", table: "daily_shares" }, () => load()).subscribe(); } catch {}
    return () => { window.removeEventListener("pp-daily-changed", load); document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);
  return needs;
}
