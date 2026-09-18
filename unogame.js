import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as U from "./uno.js";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* 🃏 UNO — the Game Room's second card game, on the Phase 10 bones:
   one uno_matches row (whole state jsonb + version), optimistic
   version-guarded commits, realtime UPDATE sync, notifyTurn pushes,
   winner takes 25 💗. Tap a card to play it, tap the deck to draw. */

/* ---- the Phase 10 sync recipe on uno_matches ---- */
function useUnoMatch(client) {
  const [match, setMatch] = useState(undefined);
  const ref = useRef(undefined);
  useEffect(() => { ref.current = match; }, [match]);
  const load = useCallback(async () => {
    const { data } = await client.from("uno_matches").select("*").eq("status", "playing")
      .order("created_at", { ascending: false }).limit(1);
    const row = (data && data[0]) || null;
    const cur = ref.current;
    if (row && cur && row.id === cur.id && row.version === cur.version) return;
    setMatch(row);
  }, [client]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let alive = true, ch = null;
    const subscribe = () => {
      try {
        ch = client.channel("pp-uno-" + Math.random().toString(36).slice(2, 7))
          .on("postgres_changes", { event: "*", schema: "public", table: "uno_matches" }, (p) => {
            if (p.eventType === "DELETE") { load(); return; }
            const row = p.new;
            if (row.status === "playing") setMatch((cur) => (cur && cur.id === row.id && typeof cur.version === "number" && row.version < cur.version ? cur : row));
            else load();
          })
          .subscribe((status) => {
            if (alive && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
              setTimeout(() => { if (alive) { try { client.removeChannel(ch); } catch {} subscribe(); load(); } }, 1500);
            }
          });
      } catch {}
    };
    subscribe();
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    const beat = setInterval(wake, 20000);
    return () => {
      alive = false; clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      try { ch && client.removeChannel(ch); } catch {}
    };
  }, [client, load]);
  return [match, setMatch, load];
}

/* ---- one card face ---- */
const GLYPH = { S: "⊘", R: "⇄", D: "+2", W: "", W4: "+4" };
function UCard({ c, small, back, sel, onClick }) {
  if (back) return html`<div class=${`ucard back ${small ? "sm" : ""}`}><i>🃏</i></div>`;
  const f = U.faceOf(c);
  const cls = U.isWild(c) ? "w" : c[0];
  const g = GLYPH[f] ?? f;
  return html`<button class=${`ucard ${cls} ${small ? "sm" : ""} ${sel ? "sel" : ""}`} onClick=${onClick}>
    <span class="uc-oval"></span>
    ${U.isWild(c)
      ? html`<span class="uc-quad"></span>${f === "W4" && html`<span class="uc-center onquad">+4</span>`}`
      : html`<span class="uc-center">${g}</span>`}
    <span class="uc-corner">${g || "★"}</span>
    <span class="uc-corner b">${g || "★"}</span>
  </button>`;
}

const cardWords = (c) => {
  const NAMES = { r: "red", y: "yellow", g: "green", b: "blue" };
  const f = U.faceOf(c);
  if (c === "W") return "a Wild";
  if (c === "W4") return "a Wild +4";
  const F = { S: "Skip", R: "Reverse", D: "+2" }[f] || f;
  return `${NAMES[c[0]]} ${F}`;
};

/* ---- the full-screen table ---- */
function UnoBoard({ me, partner, match, commitUno, onExit, onNewGame, local }) {
  const s = match.state;
  const [pickColor, setPickColor] = useState(null);  // pending wild: hand index or "drawn"
  // demo (one device) plays whoever's turn it is; live phones play only ME
  const seatId = local ? (s.players.includes(s.turn) ? s.turn : me.id) : me.id;
  const seat = seatId === me.id ? me : partner;
  const opp = seatId === me.id ? partner : me;
  const myTurn = s.status === "playing" && s.turn === seatId;
  const hand = s.hands[seatId] || [];
  const oppN = (s.hands[U.oppOf(s, seatId)] || []).length;

  const tapCard = (idx) => {
    if (!myTurn || s.drawn) return;
    const c = hand[idx];
    if (U.isWild(c)) {
      if (U.canPlay(c, U.topOf(s), s.color)) setPickColor(idx);
      return;
    }
    const next = U.play(s, seatId, idx);
    if (!next) { nope(idx); return; }
    commitUno(next, seatId);
  };
  const tapDeck = () => {
    if (!myTurn || s.drawn) return;
    const next = U.draw(s, seatId);
    if (next) commitUno(next, seatId);
  };
  const choose = (col) => {
    const idx = pickColor;
    setPickColor(null);
    const next = idx === "drawn" ? U.playDrawn(s, seatId, col) : U.play(s, seatId, idx, col);
    if (next) commitUno(next, seatId);
  };
  const [shakeIdx, setShakeIdx] = useState(-1);
  const nope = (idx) => { setShakeIdx(idx); setTimeout(() => setShakeIdx(-1), 450); };

  const lastLine = (() => {
    const l = s.last; if (!l) return "your table awaits";
    const who = l.by === me.id ? me : partner;
    if (l.kind === "draw") return `${who.emoji} drew a card`;
    if (l.kind === "keep") return `${who.emoji} kept it`;
    if (l.kind === "pass") return `${who.emoji} passed`;
    const base = `${who.emoji} played ${cardWords(l.card)}`;
    return l.drew ? `${base} — +${l.drew} 😈` : l.again ? `${base} — goes again` : base;
  })();

  const winner = s.winner && (s.winner === me.id ? me : partner);
  const COLOR_HEX = { r: "#e8434a", y: "#f4c542", g: "#4da34d", b: "#4a90e2" };

  return html`<div class="gamefs unofs">
    <div class="gamefs-bar">
      <button class="iconbtn" onClick=${onExit}>✕</button>
      <div class="gemfs-title">🃏 UNO</div>
      <div class="gemfs-score tnum">25 💗</div>
    </div>

    <div class="uno-opp">
      <span class="uno-opp-name">${opp.emoji} ${opp.name}${s.uno === opp.id ? html` <b class="uno-flag">UNO!</b>` : ""}</span>
      <div class="uno-backs">
        ${Array.from({ length: Math.min(oppN, 10) }, (_, i) => html`<${UCard} key=${i} back small />`)}
        ${oppN > 10 && html`<span class="uno-backs-n tnum">${oppN}</span>`}
      </div>
    </div>

    <div class="uno-table">
      <button class="uno-deck" onClick=${tapDeck} disabled=${!myTurn || !!s.drawn}>
        <${UCard} back />
        <span class="uno-deck-hint">${myTurn && !s.drawn ? "draw" : ""}</span>
      </button>
      <div class="uno-pile">
        <${UCard} c=${U.topOf(s)} />
        <span class="uno-colordot" style=${`background:${COLOR_HEX[s.color]}`}></span>
      </div>
    </div>

    <div class="uno-ticker">${lastLine}</div>
    <div class=${`uno-turnbar ${myTurn ? "mine" : ""}`}>
      ${s.status === "won" ? "game over" :
        myTurn ? `${seat.emoji} your turn` : `${(s.turn === me.id ? me : partner).emoji} ${(s.turn === me.id ? me : partner).name}'s turn${local ? "" : " · on their phone 📱"}`}
    </div>

    <div class="uno-hand" data-noswipe>
      ${hand.map((c, i) => html`<${UCard} key=${i + c} c=${c}
        sel=${s.drawn && c === s.drawn && i === hand.lastIndexOf(s.drawn)}
        small=${hand.length > 8}
        onClick=${() => tapCard(i)} />`)}
    </div>
    ${s.uno === seatId && html`<div class="uno-flag big">UNO!</div>`}

    ${myTurn && s.drawn && html`<div class="uno-drawnbar">
      you drew ${cardWords(s.drawn)} —
      <button class="btn" onClick=${() => { U.isWild(s.drawn) ? setPickColor("drawn") : commitUno(U.playDrawn(s, seatId), seatId); }}>Play it ▸</button>
      <button class="btn ghost" onClick=${() => commitUno(U.keep(s, seatId), seatId)}>Keep</button>
    </div>`}

    ${pickColor != null && html`<div class="modal-bg asheet" onClick=${() => setPickColor(null)}>
      <div class="modal uno-colors" onClick=${(e) => e.stopPropagation()}>
        <div class="eyebrow">pick a color</div>
        <div class="row" style="gap:14px; justify-content:center">
          ${U.COLORS.map((col) => html`<button key=${col} class="uno-colorbtn" style=${`background:${COLOR_HEX[col]}`} onClick=${() => choose(col)}></button>`)}
        </div>
      </div>
    </div>`}

    ${s.status === "won" && html`<div class="gemfs-over">
      <div class="gemfs-big">${winner.emoji} ${winner.name} wins!</div>
      <div class="gemfs-duelprize">+25 💗 to ${winner.name}</div>
      <button class="btn" onClick=${onNewGame}>New game 🃏</button>
      <button class="linkbtn" onClick=${onExit}>Back to the castle</button>
    </div>`}
  </div>`;
}

/* ---- the Game Room entry card ---- */
export function UnoCard({ client, me, players, flash }) {
  const partner = players.find((p) => p.id !== me.id);
  const [match, setMatch, reload] = useUnoMatch(client);
  const [open, setOpen] = useState(false);
  const mRef = useRef(null); mRef.current = match;
  const busy = useRef(false);
  const local = !!client._db;
  const byId = (id) => players.find((p) => p.id === id) || me;

  const dealGame = useCallback(async () => {
    if (!partner) return;
    const old = mRef.current;
    if (old) { try { await client.from("uno_matches").update({ status: "finished", updated_at: new Date().toISOString() }).eq("id", old.id); } catch {} }
    const state = U.deal(me.id, partner.id);
    const { data, error } = await client.from("uno_matches").insert({ state }).select().single();
    if (error || !data) { flash("⚠️ couldn't deal"); return; }
    setMatch(data);
    notifyTurn(client, partner.id, "UNO! 🃏", `${me.emoji} ${me.name} dealt you a hand — you're up first.`);
    setOpen(true);
  }, [client, me, partner, flash, setMatch]);

  /* commit the whole new state (Phase 10 style). The committer of the
     winning play is the single writer for the 25💗, the games row, and
     the pushes. */
  const commitUno = useCallback(async (newState, actorId) => {
    const m = mRef.current;
    if (!m || busy.current || !newState || !partner) return;
    busy.current = true;
    const version = m.version;
    setMatch({ ...m, state: newState, version: version + 1 });
    const { data, error } = await client.from("uno_matches")
      .update({ state: newState, version: version + 1, updated_at: new Date().toISOString() })
      .eq("id", m.id).eq("version", version).select();
    busy.current = false;
    if (error || !data || !data.length) { flash("Out of sync — refreshing"); reload(); return; }
    const other = byId(newState.players.find((p) => p !== actorId));
    const actor = byId(actorId);
    const skipPush = local && other.id === me.id;    // demo self-play: no pushes to yourself
    if (newState.status === "won") {
      const w = byId(newState.winner);
      try {
        await client.from("transactions").insert({ player_id: w.id, amount: 25, type: "earn", description: "UNO won 🃏" });
        await client.from("games").insert({ name: "UNO", status: "finished", winner_id: w.id, finished_at: new Date().toISOString() });
      } catch {}
      flash(`${w.emoji} ${w.name} +25 💗 — UNO!`);
      if (!skipPush) notifyTurn(client, other.id, "UNO — game over 🃏", w.id === other.id ? "You won! +25 💗" : `${w.emoji} ${w.name} emptied their hand.`);
      return;
    }
    if (skipPush) return;
    const l = newState.last;
    if (l && l.drew) notifyTurn(client, other.id, `${l.card === "W4" ? "+4!!" : "+2!"} 😈`, `${actor.emoji} ${actor.name} played ${cardWords(l.card)} — you drew ${l.drew} and they go again.`);
    else if (newState.turn === other.id) notifyTurn(client, other.id, "Your turn! 🃏", `${actor.emoji} ${actor.name} ${l && l.kind === "keep" ? "drew and kept a card" : l && l.card ? "played " + cardWords(l.card) : "played"}.`);
  }, [client, me, partner, flash, reload, setMatch, local]);   // eslint-disable-line

  const dismiss = useCallback(async () => {
    const m = mRef.current; if (!m) return;
    try { await client.from("uno_matches").update({ status: "finished", updated_at: new Date().toISOString() }).eq("id", m.id); } catch {}
    setMatch(null); setOpen(false);
  }, [client, setMatch]);

  if (open && match && partner) {
    return html`<${UnoBoard} me=${me} partner=${partner} match=${match} local=${local}
      commitUno=${commitUno} onExit=${() => setOpen(false)} onNewGame=${dealGame} />`;
  }

  const s = match && match.state;
  const myTurn = s && s.status === "playing" && s.turn === me.id;
  return html`<div class="card gamehero unohero">
    <div class="eyebrow">UNO 🃏</div>
    ${!s ? html`
      <div class="gamehero-title">Deal a hand</div>
      <div class="gamehero-meta">winner takes 25 💗</div>
      <div class="row" style="gap:10px; justify-content:center">
        ${partner && html`<button class="btn gamehero-btn" onClick=${dealGame}>Deal ▸</button>`}
      </div>`
    : s.status === "won" ? html`
      <div class="gamehero-title">${byId(s.winner).emoji} ${byId(s.winner).name} won</div>
      <div class="gamehero-meta">+25 💗 · rack up another?</div>
      <div class="row" style="gap:10px; justify-content:center">
        <button class="btn gamehero-btn" onClick=${dealGame}>Deal again ▸</button>
        <button class="linkbtn" onClick=${dismiss}>dismiss</button>
      </div>`
    : html`
      <div class="gamehero-title">${myTurn ? "Your turn!" : `${byId(s.turn).emoji} ${byId(s.turn).name} is thinking…`}</div>
      <div class="gamehero-meta tnum">you ${s.hands[me.id]?.length ?? "?"} · ${partner ? `${partner.emoji} ${s.hands[partner.id]?.length ?? "?"}` : ""} cards${s.uno ? " · UNO called!" : ""}</div>
      <div class="row" style="gap:10px; justify-content:center">
        <button class="btn gamehero-btn" onClick=${() => setOpen(true)}>${myTurn ? "Play ▸" : "Peek ▸"}</button>
      </div>`}
  </div>`;
}
