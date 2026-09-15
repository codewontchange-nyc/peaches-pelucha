import { h, Fragment } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* 🎁 Reward redemptions — the sweet part of the hearts loop.
   One partner cashes out a reward; the OTHER gets a giant, tender home card and
   delivers it by snapping a photo, which becomes a special "reward" card in
   Memories (stored on the redemption, never mixed into a memory day). */

const dayLabel = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};

function usePending(client) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    const { data } = await client.from("redemptions").select("*").eq("status", "pending").order("created_at", { ascending: true });
    setRows(data || []);
  }, [client]);
  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-redeem").on("postgres_changes", { event: "*", schema: "public", table: "redemptions" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);
  return [rows, load];
}

/* The home card: giant + sentimental for the partner who must deliver; a soft
   "on its way" note for the one who redeemed. */
export function RewardHome({ client, me, players, flash }) {
  const [rows, load] = usePending(client);
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);
  const target = useRef(null);
  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "someone" };

  const toFulfill = rows.filter((r) => r.fulfiller_id === me.id);
  const waiting = rows.filter((r) => r.redeemer_id === me.id);
  if (!toFulfill.length && !waiting.length) return null;

  const pick = (r) => { target.current = r; try { fileRef.current && fileRef.current.click(); } catch {} };
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    const r = target.current; target.current = null;
    if (!f || !r) return;
    setBusy(r.id);
    try {
      const { uploadRewardPhoto } = await import("./memories.js");
      const up = await uploadRewardPhoto(client, f);
      await client.from("redemptions").update({
        status: "fulfilled", photo_path: up.path, thumb_path: up.thumb_path, blur: up.blur,
        taken_on: up.taken_on, fulfilled_at: new Date().toISOString(),
      }).eq("id", r.id);
      try { notifyTurn(client, r.redeemer_id, "💝 Your reward is here", `${me.emoji} ${me.name} gave you "${r.reward_label}" — see it in Memories`); } catch {}
      flash(`Delivered "${r.reward_label}" 💝`);
      load();
    } catch (err) { flash("⚠️ " + (err.message || "couldn't save the photo")); }
    setBusy(null);
  };

  return html`<${Fragment}>
    <input ref=${fileRef} type="file" accept="image/*,video/*" capture="environment" style="display:none" onChange=${onFile} />
    ${toFulfill.map((r) => {
      const who = pinfo(r.redeemer_id);
      return html`<div class="card rewardcard" key=${r.id}>
        <div class="rw-shimmer"></div>
        <div class="rw-emoji">${r.reward_emoji || "🎁"}</div>
        <div class="rw-eyebrow">a reward to give 💗</div>
        <div class="rw-title">${who.emoji} ${who.name} is ready for you to reward them with</div>
        <div class="rw-reward">${r.reward_label}</div>
        <button class="btn block rw-btn" disabled=${busy === r.id} onClick=${() => pick(r)}>
          ${busy === r.id ? "Saving the moment…" : "📸 Give it & capture the moment"}
        </button>
        <div class="rw-foot">they spent ${r.cost} 💗 on this — make it special</div>
      </div>`;
    })}
    ${waiting.map((r) => {
      const who = pinfo(r.fulfiller_id);
      return html`<div class="card rewardcard waiting" key=${r.id}>
        <div class="rw-eyebrow">on its way 💗</div>
        <div class="rw-title small">Your <b>${r.reward_label}</b> is coming — waiting for ${who.emoji} ${who.name} to deliver it.</div>
      </div>`;
    })}
  <//>`;
}

/* The special reward cards in Memories — delivered rewards, kept apart from the
   day feed. Tap to see the photo full-screen with its little story. */
export function RewardStrip({ client, me, players }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "someone" };
  const pubUrl = useCallback((p) => { if (!p) return null; try { return client.storage.from("memories").getPublicUrl(p).data.publicUrl; } catch { return null; } }, [client]);

  const load = useCallback(async () => {
    const { data } = await client.from("redemptions").select("*").eq("status", "fulfilled").order("fulfilled_at", { ascending: false });
    setRows((data || []).filter((r) => r.photo_path));
  }, [client]);
  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-redeem-mem").on("postgres_changes", { event: "*", schema: "public", table: "redemptions" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  if (!rows || !rows.length) return null;

  return html`<div class="card rewardstrip">
    <div class="shead"><h2>Delivered <span class="muted-glyph">🎁</span></h2></div>
    <div class="rs-row">
      ${rows.map((r) => html`<button class="rs-card" key=${r.id}
        style=${r.blur ? `background-image:url(${r.blur})` : ""} onClick=${() => setOpen(r)}>
        <img class="rs-img" src=${pubUrl(r.thumb_path || r.photo_path)} alt="" loading="lazy"
          onLoad=${(e) => e.target.classList.add("ld")} />
        <span class="rs-scrim"></span>
        <span class="rs-badge">${r.reward_emoji || "🎁"} ${r.reward_label}</span>
      </button>`)}
    </div>

    ${open && createPortal(html`<div class="rs-viewer" onClick=${(e) => { if (e.target.classList.contains("rs-viewer")) setOpen(null); }}>
      <button class="rs-x" onClick=${() => setOpen(null)}>✕</button>
      <div class="rs-stage">
        <img src=${pubUrl(open.photo_path)} alt="" />
      </div>
      <div class="rs-meta">
        <div class="rs-meta-title">${open.reward_emoji || "🎁"} ${open.reward_label}</div>
        <div class="rs-meta-sub">${pinfo(open.fulfiller_id).emoji} gave ${pinfo(open.redeemer_id).emoji}${open.taken_on ? " · " + dayLabel(open.taken_on) : ""}</div>
      </div>
    </div>`, document.body)}
  </div>`;
}

/* Castle-door badge: redeemed rewards I still owe my partner (pending, mine to
   deliver). Rides usePending's realtime + wake refresh. */
export function useGiftsToDeliver(client, me) {
  const [rows] = usePending(client);
  return rows.filter((r) => r.fulfiller_id === (me && me.id)).length;
}
