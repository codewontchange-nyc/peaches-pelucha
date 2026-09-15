import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🧺 Shopping list — the farmers-market list. Market days are Sat / Mon / Wed,
   so every item can carry a pickup day (or "anytime") and the card always
   knows which market is next. */

const MARKETS = [
  { key: "sat", label: "Sat", dow: 6 },
  { key: "mon", label: "Mon", dow: 1 },
  { key: "wed", label: "Wed", dow: 3 },
];

const nextMarket = () => {
  const today = new Date().getDay();
  let best = null;
  for (const m of MARKETS) {
    const delta = (m.dow - today + 7) % 7;
    if (!best || delta < best.delta) best = { ...m, delta };
  }
  return best;
};

export function ShoppingCard({ client, me, players, flash }) {
  const [items, setItems] = useState(null);
  const [buyMarket, setBuyMarket] = useState(nextMarket().key);

  const load = useCallback(async () => {
    const { data } = await client.from("shopping_items").select("*").order("created_at");
    setItems(data || []);
  }, [client]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-shopping")
        .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const addItem = async (label, market) => {
    const t = (label || "").trim();
    if (!t) return;
    const row = { label: t, market: market || null, created_by: me.id };
    const { data } = await client.from("shopping_items").insert(row).select().single();
    if (data) setItems((cur) => [...(cur || []), data]);
  };
  const toggleItem = async (it) => {
    setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, done: !it.done } : x)));
    await client.from("shopping_items").update({ done: !it.done }).eq("id", it.id);
  };
  const delItem = async (it) => {
    setItems((cur) => cur.filter((x) => x.id !== it.id));
    await client.from("shopping_items").delete().eq("id", it.id);
  };
  const clearBought = async () => {
    setItems((cur) => cur.filter((x) => !x.done));
    await client.from("shopping_items").delete().eq("done", true);
  };

  const nm = nextMarket();
  const openCount = (mk) => (items || []).filter((i) => i.market === mk && !i.done).length;
  const doneCount = (items || []).filter((i) => i.done).length;

  const line = (it) => html`<div class=${`buyline ${it.done ? "got" : ""}`} key=${it.id}>
    <button class="buychk" onClick=${() => toggleItem(it)}>${it.done ? "✓" : ""}</button>
    <span class="buylabel" onClick=${() => toggleItem(it)}>${it.label}</span>
    <button class="buyx" onClick=${() => delItem(it)}>✕</button>
  </div>`;

  return html`<div class="card cookcard">
    <div class="shead"><h2>Shopping list <span class="muted-glyph">🧺</span></h2>
      <div class="shead-actions"><span class="mkpill">${nm.delta === 0 ? "market today" : `next: ${nm.label}`}${openCount(nm.key) ? ` · ${openCount(nm.key)}` : ""}</span></div>
    </div>

    ${items === null ? html`<div class="empty"><span class="big">🧺</span>Loading…</div>` : html`
      <div class="buybar">
        <input placeholder="add to the list…" maxlength="60"
          onKeyDown=${async (e) => { if (e.key === "Enter" && e.target.value.trim()) { const v = e.target.value; e.target.value = ""; await addItem(v, buyMarket); } }} />
        <div class="mkseg">
          ${MARKETS.map((mk) => html`<button key=${mk.key} class=${buyMarket === mk.key ? "on" : ""} title=${mk.label} onClick=${() => setBuyMarket(mk.key)}>${mk.label[0]}</button>`)}
          <button class=${buyMarket === null ? "on" : ""} title="anytime" onClick=${() => setBuyMarket(null)}>∙</button>
        </div>
      </div>

      ${MARKETS.map((mk) => {
        const list = (items || []).filter((i) => i.market === mk.key);
        if (!list.length) return null;
        const open = list.filter((i) => !i.done).length;
        return html`<div class="mkgroup" key=${mk.key}>
          <div class="mkhead"><span>${mk.label === "Sat" ? "Saturday" : mk.label === "Mon" ? "Monday" : "Wednesday"} market ${nm.key === mk.key ? html`<span class="mknext">next 🧺</span>` : ""}</span><span class="mkcount">${open || ""}</span></div>
          ${list.map(line)}
        </div>`;
      })}
      ${(() => { const list = (items || []).filter((i) => !i.market); return list.length ? html`<div class="mkgroup">
        <div class="mkhead"><span>anytime</span><span class="mkcount">${list.filter((i) => !i.done).length || ""}</span></div>
        ${list.map(line)}
      </div>` : null; })()}

      ${doneCount > 0 && html`<button class="linkbtn block mt" style="width:100%" onClick=${clearBought}>Clear bought · ${doneCount}</button>`}
    `}
  </div>`;
}
