import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";
import { ShoppingCard } from "./shopping.js";

const html = htm.bind(h);

/* Love Bug Calendar 📅 — a minimal shared agenda. Either of you adds a plan as
   an Invite (partner answers "I'm in 💗 / Can't 🙁") or an FYI (just informs).
   Everything syncs live; creates and RSVPs push to the partner's phone, and a
   pg_cron job sends both phones a "📅 Today" digest each morning. */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((date - now) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const timeLabel = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`;
};

const parseISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const SEASONS = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];

// Editorial horizon for a date: This week · Next week · Later this month ·
// This summer/fall/… · then plain month names for the far future.
function horizonOf(iso) {
  const date = parseISO(iso);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dayIdx = (now.getDay() + 6) % 7;                       // 0=Mon … 6=Sun
  const endOfWeek = new Date(now); endOfWeek.setDate(now.getDate() + (6 - dayIdx));
  const endOfNextWeek = new Date(endOfWeek); endOfNextWeek.setDate(endOfWeek.getDate() + 7);
  if (date <= endOfWeek) return "This week";
  if (date <= endOfNextWeek) return "Next week";
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return "Later this month";
  const days = Math.round((date - now) / 86400000);
  if (days <= 150) {
    const season = SEASONS[date.getMonth()];
    if (season !== SEASONS[now.getMonth()] || date.getFullYear() === now.getFullYear() || date.getMonth() < 2) return `This ${season}`;
  }
  const month = date.toLocaleDateString(undefined, { month: "long" });
  return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

const endOfThisWeek = () => {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dayIdx = (now.getDay() + 6) % 7;                 // 0=Mon … 6=Sun
  const e = new Date(now); e.setDate(now.getDate() + (6 - dayIdx));
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
};

// The magazine deck: a generated prose summary of their upcoming life.
// Deterministic templates — reads like an editor wrote it, no AI calls.
function summarize(upcoming) {
  if (!upcoming.length) return {
    title: "A blank page",
    body: "Nothing on the books yet. Add a plan and give yourselves something to look forward to — the best chapters start with a date.",
  };
  const today = todayISO(), eow = endOfThisWeek();
  const first = upcoming[0];
  const week = upcoming.filter((e) => e.starts_on <= eow && e !== first);
  const beyond = upcoming.filter((e) => e.starts_on > eow && e !== first);

  const s = [];
  const when = first.starts_on === today ? "today" : dayLabel(first.starts_on).toLowerCase().replace(/^([a-z])/, "$1");
  s.push(`First up: ${first.title}, ${when}${first.starts_at ? ` at ${timeLabel(first.starts_at)}` : ""}${first.location ? ` — ${first.location}` : ""}.`);
  if (week.length === 1) s.push(`Then ${week[0].title.toLowerCase().startsWith("the") ? week[0].title : week[0].title} rounds out the week.`);
  else if (week.length > 1) s.push(`${week[0].title} and ${week[1].title.toLowerCase()}${week.length > 2 ? `, among others,` : ""} round out the week.`);
  if (beyond.length) {
    const far = beyond[beyond.length - 1];
    const month = parseISO(far.starts_on).toLocaleDateString(undefined, { month: "long" });
    s.push(beyond.length === 1
      ? `And on the horizon — ${far.title.toLowerCase().startsWith("the") ? far.title : far.title}, in ${month}.`
      : `And on the horizon: ${beyond.length} more plans, stretching all the way to ${far.title} in ${month}.`);
  }

  return { body: s.join(" ") };
}

/* ✅ couple to-dos & reminders — a row with a date is a reminder (due chip,
   overdue accent, joins the 9am digest); without one it's a plain checklist
   item. Both check off with a satisfying strike. */
function TodoCard({ client, me, players, flash }) {
  const partner = players.find((p) => p.id !== me.id);
  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔" };
  const [todos, setTodos] = useState(null);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [withDate, setWithDate] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await client.from("todos").select("*").order("created_at");
    if (!error) setTodos(data || []);
  }, [client]);
  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-todos-" + Math.random().toString(36).slice(2, 7))
        .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const add = async () => {
    const t = text.trim().slice(0, 120);
    if (!t) return;
    setText(""); setDue(""); setWithDate(false);
    const { error } = await client.from("todos").insert({ text: t, due_on: (withDate && due) || null, created_by: me.id });
    if (error) { flash("⚠️ " + error.message); setText(t); return; }
    if (withDate && due && partner) notifyTurn(client, partner.id, `🔔 Reminder from ${me.name}`, `${t} — ${dayLabel(due)}`);
    load();
  };
  const toggle = async (t) => {
    await client.from("todos").update({ done: !t.done, done_at: t.done ? null : new Date().toISOString() }).eq("id", t.id);
    if (!t.done) { try { navigator.vibrate && navigator.vibrate(25); } catch {} }
    load();
  };
  const remove = async (t) => { await client.from("todos").delete().eq("id", t.id); load(); };
  const clearDone = async () => { await client.from("todos").delete().eq("done", true); load(); };

  const today = todayISO();
  const open = (todos || []).filter((t) => !t.done);
  const reminders = open.filter((t) => t.due_on).sort((a, b) => a.due_on < b.due_on ? -1 : 1);
  const plain = open.filter((t) => !t.due_on);
  const doneList = (todos || []).filter((t) => t.done).sort((a, b) => (a.done_at < b.done_at ? 1 : -1));

  const Row = (t) => html`<div class="todorow" key=${t.id}>
    <button class=${`tdcheck ${t.done ? "on" : ""}`} onClick=${() => toggle(t)}>${t.done ? "✓" : ""}</button>
    <span class=${`tdtext ${t.done ? "done" : ""}`}>${t.text}</span>
    ${t.due_on && !t.done && html`<span class=${`pill ${t.due_on < today ? "loss" : ""}`}>${t.due_on < today ? "late · " : ""}${dayLabel(t.due_on)}</span>`}
    <span class="tiny" style="opacity:.55">${pinfo(t.created_by).emoji}</span>
    <button class="linkbtn danger" onClick=${() => remove(t)}>✕</button>
  </div>`;

  return html`<div class="card">
    <div class="shead"><h2>To-dos</h2></div>
    <div class="row" style="margin-bottom:12px">
      <input placeholder=${withDate ? "Remind us to…" : "Add a to-do…"} maxlength="120" value=${text}
        onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === "Enter") add(); }} />
      <button class=${`iconbtn ${withDate ? "on" : ""}`} title="Add a date" onClick=${() => setWithDate(!withDate)}>🔔</button>
      <button class="btn sm" disabled=${!text.trim() || (withDate && !due)} onClick=${add}>＋</button>
    </div>
    ${withDate && html`<div class="row" style="margin:-4px 0 12px">
      <input type="date" min=${today} value=${due} onInput=${(e) => setDue(e.target.value)} />
    </div>`}
    ${todos === null && html`<div class="empty tiny">…</div>`}
    ${todos !== null && open.length === 0 && doneList.length === 0 && html`<div class="empty tiny">nothing on the list — suspiciously relaxing</div>`}
    <div class="todolist">
      ${reminders.map(Row)}
      ${plain.map(Row)}
    </div>
    ${doneList.length > 0 && html`<div class="row between" style="margin-top:10px">
      <button class="linkbtn" onClick=${() => setShowDone(!showDone)}>${showDone ? "Hide done" : `Done (${doneList.length})`}</button>
      <button class="linkbtn danger" onClick=${clearDone}>clear done</button>
    </div>`}
    ${showDone && html`<div class="todolist" style="opacity:.55">${doneList.map(Row)}</div>`}
  </div>`;
}

export function PlansTab({ client, me, players, flash }) {
  const partner = players.find((p) => p.id !== me.id);
  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };

  const [events, setEvents] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [compose, setCompose] = useState(null); // {emoji,title,date,time,kind,notes}

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await client.from("events").select("*")
      .gte("starts_on", since).order("starts_on").order("starts_at", { nullsFirst: false });
    if (!error) setEvents(data || []);
  }, [client]);

  useEffect(() => {
    load();
    const ch = client.channel("pp-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { try { client.removeChannel(ch); } catch {} document.removeEventListener("visibilitychange", wake); };
  }, [client, load]);

  // prefill from the Roulette's "Add to calendar" — on mount, and via the
  // pp-plan-prefill event (the Roulette now lives in this same room, so the
  // component is already mounted when a pick lands)
  useEffect(() => {
    const go = () => {
      const p = window.__ppPlanPrefill;
      if (p) { window.__ppPlanPrefill = null; setCompose({ emoji: p.emoji || "💗", title: p.title || "", date: todayISO(), time: "", kind: "invite", notes: "", location: "" }); }
    };
    go();
    window.addEventListener("pp-plan-prefill", go);
    return () => window.removeEventListener("pp-plan-prefill", go);
  }, []);

  const upcoming = (events || []).filter((e) => e.starts_on >= todayISO());
  const past = (events || []).filter((e) => e.starts_on < todayISO()).reverse();

  // ---- magazine home state ----
  const [view, setView] = useState("home");        // 'home' | 'list'
  const [filter, setFilter] = useState(null);      // 'rsvp'|'today'|'week'|'beyond'
  const [selectedId, setSelectedId] = useState(null);
  const needsMe = upcoming.filter((e) => e.kind === "invite" && e.created_by !== me.id && e.rsvp === "pending");
  const activeFilter = filter || (needsMe.length ? "rsvp" : "week");
  const eow = endOfThisWeek();
  const filtered =
    activeFilter === "rsvp" ? needsMe :
    activeFilter === "today" ? upcoming.filter((e) => e.starts_on === todayISO()) :
    activeFilter === "week" ? upcoming.filter((e) => e.starts_on <= eow) :
    upcoming.filter((e) => e.starts_on > eow);
  const featured = upcoming.slice(0, 5);
  const deck = summarize(upcoming);

  // Editorial layout: the nearest plan is the "Next up" hero; the rest group
  // into look-ahead horizons (This week · Next week · This summer …), each
  // holding day-rows with a serif date column.
  const hero = upcoming[0] || null;
  const sections = [];
  for (const e of upcoming.slice(1)) {
    const label = horizonOf(e.starts_on);
    let sec = sections[sections.length - 1];
    if (!sec || sec.label !== label) { sec = { label, days: [] }; sections.push(sec); }
    let day = sec.days[sec.days.length - 1];
    if (!day || day.date !== e.starts_on) { day = { date: e.starts_on, items: [] }; sec.days.push(day); }
    day.items.push(e);
  }

  const save = async () => {
    const c = compose;
    if (!c.title.trim() || !c.date) return;
    const row = { title: c.title.trim(), emoji: (c.emoji || "💗").trim() || "💗", starts_on: c.date,
      starts_at: c.time || null, notes: c.notes.trim() || null, location: c.location.trim() || null, kind: c.kind };
    const when = `${dayLabel(c.date)}${c.time ? " · " + timeLabel(c.time) : ""}`;
    const where = row.location ? ` · 📍 ${row.location}` : "";

    if (c.id) {
      // creator edit — if an answered invite's date/time moved, re-ask
      const rescheduled = c.kind === "invite" && (c.date !== c.orig.starts_on || (c.time || null) !== c.orig.starts_at);
      if (rescheduled) row.rsvp = "pending";
      const { error } = await client.from("events").update(row).eq("id", c.id);
      if (error) { flash("⚠️ " + error.message); return; }
      if (partner) notifyTurn(client, partner.id, `✏️ ${me.name} updated a plan`,
        `${row.emoji} ${row.title} — ${when}${where}${rescheduled ? " · please re-RSVP" : ""}`);
      flash("Updated ✏️");
    } else {
      const { error } = await client.from("events").insert({ ...row, created_by: me.id });
      if (error) { flash("⚠️ " + error.message); return; }
      if (partner) notifyTurn(client, partner.id,
        c.kind === "invite" ? `💌 Invite from ${me.name}` : `📌 FYI from ${me.name}`,
        `${row.emoji} ${row.title} — ${when}${where}`);
      flash(c.kind === "invite" ? "Invite sent 💌" : "Added 📌");
    }
    setCompose(null);
    load();
  };

  const editEvent = (e) => setCompose({
    id: e.id, orig: e, emoji: e.emoji, title: e.title, date: e.starts_on,
    time: e.starts_at ? e.starts_at.slice(0, 5) : "", kind: e.kind,
    notes: e.notes || "", location: e.location || "",
  });

  const rsvp = async (e, answer) => {
    const { error } = await client.from("events").update({ rsvp: answer }).eq("id", e.id);
    if (error) { flash("⚠️ " + error.message); return; }
    load();
    notifyTurn(client, e.created_by,
      answer === "in" ? `💗 ${me.name} is in!` : `🙁 ${me.name} can't make it`,
      `${e.emoji} ${e.title} — ${dayLabel(e.starts_on)}`);
  };

  const remove = async (e) => { await client.from("events").delete().eq("id", e.id); load(); };

  const Row = (e) => {
    const mine = e.created_by === me.id;
    const needsAnswer = e.kind === "invite" && !mine && e.rsvp === "pending";
    return html`<div class=${`line evrow ${needsAnswer ? "ask" : ""}`} key=${e.id}>
      <div class="l">
        <span class="em">${e.emoji}</span>
        <div class="txt"><b>${e.title}</b>
          <span class="tiny muted">
            ${e.starts_at ? timeLabel(e.starts_at) + " · " : ""}${mine ? "you" : pinfo(e.created_by).name}
            ${e.location ? " · 📍 " + e.location : ""}${e.notes ? " · " + e.notes : ""}</span>
        </div>
      </div>
      <div class="row">
        ${needsAnswer
          ? html`<button class="btn sm" onClick=${() => rsvp(e, "in")}>I’m in 💗</button>
                 <button class="btn ghost sm" onClick=${() => rsvp(e, "cant")}>Can’t</button>`
          : html`
            ${e.kind === "fyi" && html`<span class="pill">📌</span>`}
            ${e.kind === "invite" && e.rsvp === "in" && html`<span class="pill win">in 💗</span>`}
            ${e.kind === "invite" && e.rsvp === "cant" && html`<span class="pill loss">can’t 🙁</span>`}
            ${e.kind === "invite" && e.rsvp === "pending" && mine && html`<span class="pill">⏳ asked</span>`}
            ${mine && html`<button class="linkbtn" onClick=${() => editEvent(e)}>✎</button>`}
            ${mine && html`<button class="linkbtn danger" onClick=${() => remove(e)}>✕</button>`}
          `}
      </div>
    </div>`;
  };

  // ---- magazine pieces ----
  const FCard = (e, i) => {
    const mine = e.created_by === me.id;
    const needsAnswer = e.kind === "invite" && !mine && e.rsvp === "pending";
    const d = parseISO(e.starts_on);
    const eyebrow = i === 0 ? "Next event"
      : `${d.toLocaleDateString(undefined, { weekday: "short" })} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    return html`<div class=${`fcard ${i === 0 ? "first" : ""}`} key=${e.id}>
      <div class="eyebrow">${eyebrow}</div>
      <div class="fcard-title">${e.emoji} ${e.title}</div>
      <div class="fcard-meta">${dayLabel(e.starts_on)}${e.starts_at ? " · " + timeLabel(e.starts_at) : ""}${e.location ? " · 📍 " + e.location : ""}</div>
      <div class="row" style="gap:8px; margin-top:auto; padding-top:12px">
        ${needsAnswer
          ? html`<button class="btn sm" onClick=${() => rsvp(e, "in")}>I’m in 💗</button>
                 <button class="btn ghost sm" onClick=${() => rsvp(e, "cant")}>Can’t</button>`
          : html`
            ${e.kind === "fyi" && html`<span class="pill">📌 fyi</span>`}
            ${e.kind === "invite" && e.rsvp === "in" && html`<span class="pill win">both in 💗</span>`}
            ${e.kind === "invite" && e.rsvp === "cant" && html`<span class="pill loss">can’t 🙁</span>`}
            ${e.kind === "invite" && e.rsvp === "pending" && mine && html`<span class="pill">⏳ waiting on ${partner?.emoji}</span>`}
          `}
      </div>
    </div>`;
  };

  const ERow = (e) => {
    const mine = e.created_by === me.id;
    const needsAnswer = e.kind === "invite" && !mine && e.rsvp === "pending";
    const open = selectedId === e.id;
    return html`<div class=${`erow ${open ? "sel" : ""} ${needsAnswer ? "ask" : ""}`} key=${e.id}
      onClick=${() => setSelectedId(open ? null : e.id)}>
      <div class="row between">
        <div class="l" style="display:flex;align-items:center;gap:10px;min-width:0">
          <span class="em">${e.emoji}</span>
          <div class="txt" style="min-width:0"><b>${e.title}</b>
            ${e.starts_at && html`<span class="tiny muted etime">${timeLabel(e.starts_at)}</span>`}</div>
        </div>
        ${needsAnswer ? html`<span class="pill open">RSVP</span>`
          : e.kind === "invite" && e.rsvp === "in" ? html`<span class="pill win">in 💗</span>`
          : e.kind === "invite" && e.rsvp === "cant" ? html`<span class="pill loss">🙁</span>`
          : e.kind === "fyi" ? html`<span class="pill">📌</span>` : null}
      </div>
      ${open && html`<div class="erow-detail" onClick=${(ev) => ev.stopPropagation()}>
        ${e.location && html`<div class="tiny muted">📍 ${e.location}</div>`}
        ${e.notes && html`<div class="tiny muted">“${e.notes}”</div>`}
        <div class="tiny muted">${e.kind === "invite" ? "invite" : "fyi"} from ${mine ? "you" : pinfo(e.created_by).name}</div>
        <div class="row" style="gap:8px;margin-top:10px">
          ${needsAnswer && html`<button class="btn sm" onClick=${() => rsvp(e, "in")}>I’m in 💗</button>
            <button class="btn ghost sm" onClick=${() => rsvp(e, "cant")}>Can’t</button>`}
          ${mine && html`<button class="btn ghost sm" onClick=${() => editEvent(e)}>✎ Edit</button>`}
          ${mine && html`<button class="linkbtn danger" onClick=${() => remove(e)}>delete</button>`}
        </div>
      </div>`}
    </div>`;
  };

  return html`<div>
    <div class="card">
      <div class="shead">
        <h2>Love bug calendar</h2>
        <div class="shead-actions">
          <button class="iconbtn" title=${view === "home" ? "All events" : "Back"} onClick=${() => setView(view === "home" ? "list" : "home")}>${view === "home" ? "☰" : "✕"}</button>
          <button class="btn sm" onClick=${() => setCompose({ emoji: "💗", title: "", date: todayISO(), time: "", kind: "invite", notes: "", location: "" })}>＋ Plan</button>
        </div>
      </div>
      ${events === null && html`<div class="empty">…</div>`}

      ${view === "home" && events !== null && html`
        <div class="deck">
          <p class="deck-body">${deck.body}</p>
        </div>
        ${featured.length > 0 && html`<div class="fcar">${featured.map(FCard)}</div>`}
        ${upcoming.length > 0 && html`<div class="fchips">
          ${needsMe.length > 0 && html`<button class=${`fchip rsvp ${activeFilter === "rsvp" ? "on" : ""}`} onClick=${() => setFilter("rsvp")}>● RSVP!</button>`}
          <button class=${`fchip ${activeFilter === "today" ? "on" : ""}`} onClick=${() => setFilter("today")}>today</button>
          <button class=${`fchip ${activeFilter === "week" ? "on" : ""}`} onClick=${() => setFilter("week")}>this week</button>
          <button class=${`fchip ${activeFilter === "beyond" ? "on" : ""}`} onClick=${() => setFilter("beyond")}>& beyond!</button>
        </div>`}
        <div class="elist">
          ${(() => {
            // group the filtered list into days so a serif divider sits between them
            const days = [];
            for (const e of filtered) {
              let d = days[days.length - 1];
              if (!d || d.date !== e.starts_on) { d = { date: e.starts_on, items: [] }; days.push(d); }
              d.items.push(e);
            }
            return days.map((day) => html`<div class="eday" key=${day.date}>
              <div class="eday-head"><span class="eday-label">${dayLabel(day.date)}</span><span class="eday-rule"></span></div>
              ${day.items.map(ERow)}
            </div>`);
          })()}
          ${upcoming.length > 0 && filtered.length === 0 && html`<div class="empty tiny">nothing here — lucky you, go add something</div>`}
        </div>
      `}

      ${view === "list" && html`
      ${events !== null && upcoming.length === 0 && html`<div class="empty"><span class="big">🗓️</span>Nothing planned — add something to look forward to.</div>`}

      ${hero && (() => {
        const mine = hero.created_by === me.id;
        const needsAnswer = hero.kind === "invite" && !mine && hero.rsvp === "pending";
        return html`<div class="evhero">
          <div class="eyebrow">Next up</div>
          <div class="evhero-title">${hero.emoji} ${hero.title}</div>
          <div class="evhero-meta">${dayLabel(hero.starts_on)}${hero.starts_at ? " · " + timeLabel(hero.starts_at) : ""}${hero.location ? " · 📍 " + hero.location : ""}</div>
          ${hero.notes && html`<div class="evhero-note">“${hero.notes}”</div>`}
          <div class="row" style="justify-content:center; gap:8px; margin-top:12px">
            ${needsAnswer
              ? html`<button class="btn sm" onClick=${() => rsvp(hero, "in")}>I’m in 💗</button>
                     <button class="btn ghost sm" onClick=${() => rsvp(hero, "cant")}>Can’t</button>`
              : html`
                ${hero.kind === "fyi" && html`<span class="pill">📌 fyi</span>`}
                ${hero.kind === "invite" && hero.rsvp === "in" && html`<span class="pill win">you’re both in 💗</span>`}
                ${hero.kind === "invite" && hero.rsvp === "cant" && html`<span class="pill loss">can’t 🙁</span>`}
                ${hero.kind === "invite" && hero.rsvp === "pending" && mine && html`<span class="pill">⏳ waiting on ${partner?.emoji}</span>`}
                ${mine && html`<button class="linkbtn" onClick=${() => editEvent(hero)}>✎</button>`}
                ${mine && html`<button class="linkbtn danger" onClick=${() => remove(hero)}>✕</button>`}
              `}
          </div>
        </div>`;
      })()}

      ${sections.map((sec) => html`<div class="hsec" key=${sec.label}>
        <div class="hsec-head"><span class="hsec-title">${sec.label}</span><span class="hsec-rule"></span></div>
        ${sec.days.map((day) => {
          const d = parseISO(day.date);
          return html`<div class="drow" key=${day.date}>
            <div class="dcol">
              <span class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <span class="dnum">${d.getDate()}</span>
            </div>
            <div class="devs">${day.items.map(Row)}</div>
          </div>`;
        })}
      </div>`)}

      ${past.length > 0 && html`<div class="center mt">
        <button class="linkbtn" onClick=${() => setShowPast(!showPast)}>${showPast ? "Hide past" : `Past (${past.length})`}</button>
      </div>`}
      ${showPast && html`<div class="list" style="opacity:.6">${past.map(Row)}</div>`}
      `}
    </div>

    <${ShoppingCard} client=${client} me=${me} players=${players} flash=${flash} />

    <${TodoCard} client=${client} me=${me} players=${players} flash=${flash} />

    ${compose && html`<div class="modal-bg" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setCompose(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <h3>${compose.id ? "Edit plan ✏️" : compose.kind === "invite" ? "Invite 💌" : "FYI 📌"}</h3>
        <div class="seg" style="margin-bottom:14px">
          <button class=${compose.kind === "invite" ? "on" : ""} onClick=${() => setCompose({ ...compose, kind: "invite" })}>💌 Invite</button>
          <button class=${compose.kind === "fyi" ? "on" : ""} onClick=${() => setCompose({ ...compose, kind: "fyi" })}>📌 FYI</button>
        </div>
        <div class="row" style="margin-bottom:14px">
          <input style="width:56px;text-align:center" maxlength="4" value=${compose.emoji} onInput=${(e) => setCompose({ ...compose, emoji: e.target.value })} />
          <input placeholder="What’s the plan?" value=${compose.title} onInput=${(e) => setCompose({ ...compose, title: e.target.value })} />
        </div>
        <div class="row" style="margin-bottom:14px">
          <input type="date" value=${compose.date} min=${todayISO()} onInput=${(e) => setCompose({ ...compose, date: e.target.value })} />
          <input type="time" value=${compose.time} onInput=${(e) => setCompose({ ...compose, time: e.target.value })} />
        </div>
        <label class="field"><span>Where (optional)</span>
          <input placeholder="📍 Nonna’s, the park…" value=${compose.location} onInput=${(e) => setCompose({ ...compose, location: e.target.value })} /></label>
        <label class="field"><span>Note (optional)</span>
          <input placeholder="dress nice 😘" value=${compose.notes} onInput=${(e) => setCompose({ ...compose, notes: e.target.value })} /></label>
        <button class="btn block" disabled=${!compose.title.trim() || !compose.date} onClick=${save}>
          ${compose.id ? "Save changes" : compose.kind === "invite" ? `Send invite to ${partner ? partner.emoji + " " + partner.name : "…"}` : "Add to calendar"}
        </button>
      </div>
    </div>`}
  </div>`;
}
