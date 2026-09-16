import { h, Fragment } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🗺️ Memory map — every geotagged photo-day plots itself as a little photo pin
   (that day's cover shot in a white polaroid frame). Read-only by design: the
   map is a scrapbook of where you've BEEN together, not a planner.
   The card shows a NON-INTERACTIVE preview (can't pan → never fights the app's
   swipe-to-navigate); tap to open the full-screen map, where tapping a photo
   pin pops that day's picture + chapter title.
   Leaflet loads lazily from a CDN (no build, no API key). Clean CARTO tiles. */

const TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = "© OpenStreetMap";

let _leaflet = null;
function loadLeaflet() {
  if (_leaflet) return _leaflet;
  _leaflet = (async () => {
    if (!document.getElementById("leaflet-css")) {
      const l = document.createElement("link");
      l.id = "leaflet-css"; l.rel = "stylesheet";
      l.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(l);
    }
    const mod = await import("https://esm.sh/leaflet@1.9.4");
    return mod.default || mod;
  })();
  return _leaflet;
}

// Free, key-less place search (Photon by komoot — CORS-friendly autocomplete).
async function geocode(q) {
  try {
    const r = await fetch(`https://photon.komoot.io/api/?limit=6&lang=en&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    return (j.features || []).map((f) => {
      const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
      const label = [p.name, p.city || p.county, p.state, p.country].filter(Boolean).join(", ");
      return { name: p.name || label.split(",")[0] || q, label: label || q, lat: c[1], lng: c[0] };
    }).filter((x) => isFinite(x.lat) && isFinite(x.lng));
  } catch { return []; }
}

// deterministic little tilt per day so the polaroids scatter like a corkboard
const tiltOf = (iso) => { let h = 0; for (let i = 0; i < iso.length; i++) h = (h * 31 + iso.charCodeAt(i)) >>> 0; return ((h % 100) / 100 - 0.5) * 10; };

const memIcon = (L, d) => L.divIcon({
  className: "mkr",
  html: `<div class="mkr-photo ${d.approx ? "approx" : ""}" style="transform:rotate(${tiltOf(d.date).toFixed(1)}deg)">
    ${d.photo ? `<img src="${d.photo}" alt="" loading="lazy" onerror="this.remove()" />` : `<span class="mkr-fallback">📸</span>`}
    ${d.count > 1 ? `<span class="mkr-count">${d.count}</span>` : ""}
  </div>`,
  iconSize: [48, 48], iconAnchor: [24, 24],
});
const wantIcon = (L, p) => L.divIcon({
  className: "mkr",
  html: `<div class="mkr-want ${p.visited ? "done" : ""}">${p.emoji || "📍"}${p.visited ? "<i>✓</i>" : ""}</div>`,
  iconSize: [44, 44], iconAnchor: [22, 38],
});
const pendIcon = (L, emoji) => L.divIcon({
  className: "mkr",
  html: `<div class="mkr-want pend">${emoji || "📍"}</div>`,
  iconSize: [44, 44], iconAnchor: [22, 38],
});

// A self-contained Leaflet map. interactive=false → a frozen preview (can't pan,
// so it never steals the swipe-nav gesture). fitMode "always" refits on every
// data change (preview); "once" fits a single time on open (full-screen).
// view "been" plots memory-photo polaroids; "want" plots wishlist emoji pins.
function LeafletMap({ interactive, fitMode, initialCenter, focus, view, memDays, pins, pending, onDayClick, onPinClick, onMapClick }) {
  const elRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), LRef = useRef(null);
  const clickRef = useRef(() => {});
  const [ready, setReady] = useState(false);
  const fitSig = useRef("");

  useEffect(() => {
    let killed = false;
    loadLeaflet().then((L) => {
      if (killed || !elRef.current || mapRef.current) return;
      LRef.current = L;
      const opts = interactive
        ? { zoomControl: true, attributionControl: true }
        : { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false };
      const map = L.map(elRef.current, opts);
      if (initialCenter) map.setView([initialCenter.lat, initialCenter.lng], 12);
      else map.setView([30, -20], 2);
      L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", (e) => clickRef.current(e.latlng));
      mapRef.current = map; setReady(true);
      [60, 250, 500, 900].forEach((t) => setTimeout(() => { try { map.invalidateSize(); } catch {} }, t));
    });
    return () => { killed = true; if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; } };
  }, [interactive]);

  useEffect(() => { clickRef.current = (latlng) => { if (onMapClick) onMapClick(latlng); }; }, [onMapClick]);

  // runtime fly-to (a list row tapped) — after mount, so it won't fight the fit
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    try { map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 13), { duration: .6 }); } catch {}
  }, [focus, ready]);

  useEffect(() => {
    const L = LRef.current, map = mapRef.current, lg = layerRef.current;
    if (!ready || !L || !map || !lg) return;
    try { map.invalidateSize(); } catch {}
    lg.clearLayers();
    const pts = [];
    if (view === "want") {
      (pins || []).forEach((p) => {
        const m = L.marker([p.lat, p.lng], { icon: wantIcon(L, p) }).addTo(lg);
        if (onPinClick) m.on("click", () => onPinClick(p));
        pts.push([p.lat, p.lng]);
      });
      if (pending) L.marker([pending.lat, pending.lng], { icon: pendIcon(L, pending.emoji), interactive: false, zIndexOffset: 900 }).addTo(lg);
    } else {
      (memDays || []).forEach((d) => {
        const m = L.marker([d.lat, d.lng], { icon: memIcon(L, d) }).addTo(lg);
        if (onDayClick) m.on("click", () => onDayClick(d));
        pts.push([d.lat, d.lng]);
      });
    }
    if (pts.length) {
      if (fitMode === "always") {
        const sig = view + ":" + pts.length;
        if (sig !== fitSig.current) { fitSig.current = sig; try { map.fitBounds(pts, { padding: [34, 34], maxZoom: 13 }); } catch {} }
      } else if (!fitSig.current && !initialCenter) {
        fitSig.current = "done";
        try { map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 }); } catch {}
      }
    }
    setTimeout(() => { try { map.invalidateSize(); } catch {} }, 30);
  }, [ready, view, memDays, pins, pending]);

  return html`<div ref=${elRef} class="leaflet-host"></div>`;
}

export function MapCard({ client, me, players, flash }) {
  const [memDays, setMemDays] = useState([]);
  const [view, setView] = useState("been");           // 'been' 📸 | 'want' 💫
  const [pins, setPins] = useState([]);               // map_pins — places we WANT to go (either of us adds)
  const [full, setFull] = useState(false);            // full-screen map open
  const [fullCenter, setFullCenter] = useState(null); // where full-screen opens centered (null = fit all)
  const [focus, setFocus] = useState(null);           // {lat,lng,nonce} → full map flies here
  const [daySheet, setDaySheet] = useState(null);     // a photo pin tapped → that day's card
  const [pinSheet, setPinSheet] = useState(null);     // a wishlist pin being added/edited
  const [adding, setAdding] = useState(false);        // tap-the-map mode (full screen)
  const [query, setQuery] = useState("");             // place search (full screen, want view)
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // resolve a memory's small color image: stored thumb → public URL; a legacy
  // photo without one is served resized through the storage image renderer
  const thumbUrl = useCallback((m) => {
    const pub = (p) => { try { return /^https?:/.test(p) ? p : client.storage.from("memories").getPublicUrl(p).data.publicUrl; } catch { return ""; } };
    if (m.thumb_path) return pub(m.thumb_path) || null;
    if (m.kind === "photo" && m.path) {
      const u = pub(m.path);
      return u.includes("/object/public/") ? u.replace("/object/public/", "/render/image/public/") + "?width=200&quality=70" : (u || null);
    }
    return null;
  }, [client]);

  const loadMemDays = useCallback(async () => {
    const { data } = await client.from("memories").select("id,taken_on,lat,lng,place,kind,path,thumb_path").order("taken_on", { ascending: false }).limit(2000);
    // group every day; a day's location is the CENTROID of its geotagged photos
    const byDay = new Map();
    for (const m of data || []) {
      let g = byDay.get(m.taken_on);
      if (!g) { g = { date: m.taken_on, count: 0, sumLat: 0, sumLng: 0, geo: 0, place: null, cover: null, coverGeo: false }; byDay.set(m.taken_on, g); }
      g.count++;
      const geod = m.lat != null && m.lng != null;
      if (geod) { g.sumLat += m.lat; g.sumLng += m.lng; g.geo++; }
      if (!g.place && m.place) g.place = m.place;
      // the day's pin wears a cover photo — prefer a geotagged shot's image
      const canCover = m.thumb_path || m.kind === "photo";
      if (canCover && (!g.cover || (geod && !g.coverGeo))) { g.cover = m; g.coverGeo = geod; }
    }
    const all = [...byDay.values()];
    const geoDays = all.filter((g) => g.geo > 0).map((g) => ({ date: g.date, lat: g.sumLat / g.geo, lng: g.sumLng / g.geo, place: g.place }));
    const t = (iso) => new Date(iso + "T12:00:00").getTime();
    // small deterministic spread so many approximated days don't stack on one pin
    const jit = (iso, k) => { let h = 0; for (let i = 0; i < iso.length; i++) h = (h * 31 + iso.charCodeAt(i) + k) >>> 0; return ((h % 1000) / 1000 - 0.5) * 0.012; };
    const out = [];
    for (const g of all) {
      const photo = g.cover ? thumbUrl(g.cover) : null;
      if (g.geo > 0) {
        out.push({ date: g.date, lat: g.sumLat / g.geo, lng: g.sumLng / g.geo, place: g.place, count: g.count, photo, approx: false });
      } else if (geoDays.length) {
        // no location that day → borrow the nearest geotagged day's center (approx)
        let best = geoDays[0], bd = Infinity;
        for (const gd of geoDays) { const d = Math.abs(t(gd.date) - t(g.date)); if (d < bd) { bd = d; best = gd; } }
        out.push({ date: g.date, lat: best.lat + jit(g.date, 1), lng: best.lng + jit(g.date, 7), place: g.place, count: g.count, photo, approx: true });
      }
    }
    // pull each day's AI chapter title so the list reads as a journey
    const days = out.map((d) => d.date);
    if (days.length) {
      const { data: st } = await client.from("day_stories").select("day,title").in("day", days);
      const titles = {}; (st || []).forEach((s) => { if (s.title) titles[s.day] = s.title; });
      out.forEach((d) => { if (titles[d.date]) d.title = titles[d.date]; });
    }
    setMemDays(out);
  }, [client, thumbUrl]);

  const loadPins = useCallback(async () => {
    const { data } = await client.from("map_pins").select("*").order("created_at", { ascending: false });
    setPins(data || []);
  }, [client]);

  useEffect(() => {
    loadMemDays(); loadPins();
    let ch = null;
    // new/changed memories + pins should appear without leaving the tab
    const wake = () => { if (document.visibilityState === "visible") { loadMemDays(); loadPins(); } };
    document.addEventListener("visibilitychange", wake);
    try {
      ch = client.channel("pp-map")
        .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, () => loadMemDays())
        .on("postgres_changes", { event: "*", schema: "public", table: "map_pins" }, () => loadPins())
        .subscribe();
    } catch {}
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, loadMemDays, loadPins]);

  /* ---- wishlist actions (both of you add, edit, check off) ---- */
  const savePin = async () => {
    const f = pinSheet;
    if (!f.title.trim()) { flash("Name this place"); return; }
    const row = { lat: f.lat, lng: f.lng, title: f.title.trim(), note: (f.note || "").trim() || null, emoji: f.emoji || "📍", visited: !!f.visited };
    const { error } = f.id
      ? await client.from("map_pins").update(row).eq("id", f.id)
      : await client.from("map_pins").insert({ ...row, list: "Places We Want to Go", created_by: me.id });
    if (error) { flash("⚠️ " + error.message); return; }
    setPinSheet(null); loadPins();
    if (!f.id) flash(`Added ${row.emoji} ${row.title}`);
  };
  const deletePin = async () => { if (pinSheet.id) await client.from("map_pins").delete().eq("id", pinSheet.id); setPinSheet(null); loadPins(); };
  const toggleVisited = async (p) => { await client.from("map_pins").update({ visited: !p.visited }).eq("id", p.id); loadPins(); };

  // tapping the full map in add mode drops a provisional pin to name
  const onMapTap = (latlng) => {
    if (!adding || view !== "want") return;
    setPinSheet({ lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6), title: "", emoji: "📍", note: "", visited: false });
    setAdding(false);
  };
  // debounced place search while the full map is open in want view
  useEffect(() => {
    if (!full || view !== "want") return;
    const q = query.trim();
    if (q.length < 3) { setResults([]); setSearching(false); return; }
    let live = true; setSearching(true);
    const t = setTimeout(async () => { const res = await geocode(q); if (live) { setResults(res); setSearching(false); } }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [query, full, view]);
  const onSearchPick = (r) => {
    setQuery(""); setResults([]); setAdding(false);
    setPinSheet({ lat: r.lat, lng: r.lng, title: r.name, emoji: "📍", note: "", visited: false });
    setFocus({ lat: r.lat, lng: r.lng, nonce: Date.now() });
  };

  const openFull = (center, startAdding) => { setFullCenter(center || null); setFocus(null); setDaySheet(null); setAdding(!!startAdding); setQuery(""); setResults([]); setFull(true); };
  const closeFull = () => { setFull(false); setDaySheet(null); setAdding(false); setQuery(""); setResults([]); };

  // tapping a row: in full-screen → fly there; on the card → open full-screen there
  const rowGo = (inFull, d) => inFull ? (setFocus({ lat: d.lat, lng: d.lng, nonce: Date.now() }), setDaySheet(d)) : openFull({ lat: d.lat, lng: d.lng });
  // tapping a photo pin on the full map → fly + show the day's card
  const onDayClick = (d) => { setFocus({ lat: d.lat, lng: d.lng, nonce: Date.now() }); setDaySheet(d); };

  const dayRow = (inFull) => (d) => {
    const sub = [d.title && d.place ? d.place : null, fmtDay(d.date), `${d.count} ${d.count === 1 ? "photo" : "photos"}`, d.approx ? "approx." : null].filter(Boolean).join(" · ");
    return html`<div class="map-row" role="button" key=${d.date} onClick=${() => rowGo(inFull, d)}>
      ${d.photo ? html`<img class="mr-photo" src=${d.photo} alt="" loading="lazy" />` : html`<span class="mr-emoji">📸</span>`}
      <span class="mr-main"><span class="mr-title">${d.title || d.place || "A day together"}</span><span class="mr-sub">${sub}</span></span>
    </div>`;
  };

  const pinRow = (inFull) => (p) => html`<div class=${`map-row ${p.visited ? "went" : ""}`} role="button" key=${p.id}
      onClick=${() => (inFull ? setFocus({ lat: p.lat, lng: p.lng, nonce: Date.now() }) : openFull({ lat: p.lat, lng: p.lng }))}>
    <span class="mr-emoji">${p.emoji || "📍"}</span>
    <span class="mr-main"><span class=${`mr-title ${p.visited ? "done" : ""}`}>${p.title}</span>${p.note && html`<span class="mr-sub">${p.note}</span>`}</span>
    <span class=${`mr-been ${p.visited ? "on" : ""}`} role="button" onClick=${(e) => { e.stopPropagation(); toggleVisited(p); }}>${p.visited ? "been! ✓" : "been?"}</span>
    <span class="mr-more" role="button" onClick=${(e) => { e.stopPropagation(); setPinSheet({ ...p }); }}>⋯</span>
  </div>`;

  const panel = (inFull) => html`<div class="map-panel">
    ${view === "been"
      ? (memDays.length === 0
        ? html`<div class="map-empty">Geotagged photo days show up here automatically.</div>`
        : html`<div class="map-list">${memDays.map(dayRow(inFull))}</div>`)
      : html`<${Fragment}>
        <button class="btn ghost block" style="margin:2px 0 8px" onClick=${() => (inFull ? setAdding(true) : openFull(null, true))}>＋ Add a place we want to go</button>
        ${pins.length === 0
          ? html`<div class="map-empty">Nowhere yet — dream one up 💫</div>`
          : html`<div class="map-list">${pins.map(pinRow(inFull))}</div>`}
      <//>`}
  </div>`;

  const seg = html`<div class="seg mapseg">
    <button class=${view === "been" ? "on" : ""} onClick=${() => setView("been")}>📸 been</button>
    <button class=${view === "want" ? "on" : ""} onClick=${() => setView("want")}>💫 want to go</button>
  </div>`;

  return html`<div class="card mapcard">
    <!-- sticky header: title + been/want toggle stay put; the list scrolls behind -->
    <div class="map-head">
      <div class="shead"><h2>Oh, the places we go <span class="muted-glyph">✈️</span></h2></div>
      ${seg}
    </div>

    <!-- preview: frozen (can't pan → never fights swipe-nav); tap to explore -->
    <div class="map-wrap preview">
      <${LeafletMap} interactive=${false} fitMode="always" view=${view} memDays=${memDays} pins=${pins} />
      <button class="map-open" onClick=${() => openFull(null)}>${(view === "been" ? memDays : pins).length ? "" : html`<span class="map-open-empty">Tap to open the map</span>`}<span class="map-open-cta">⤢ Explore</span></button>
    </div>

    ${panel(false)}

    ${full && createPortal(html`<div class="mapfull">
      <div class="mapfull-bar">
        <button class="vw-x" onClick=${closeFull}>✕</button>
        <div class="mapfull-title">${view === "been" ? "Everywhere we've been 💗" : "Oh, the places we'll go 💫"}</div>
        ${seg}
      </div>
      ${view === "want" && html`<div class="mapsearch2">
        <span class="ms2-ico">🔍</span>
        <input value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder=${adding ? "Search — or tap the map to drop a pin" : "Search a place or address…"} autocomplete="off" />
        ${query && html`<button class="ms2-clear" onClick=${() => { setQuery(""); setResults([]); }}>✕</button>`}
        ${(results.length > 0 || searching) && html`<div class="mapsearch2-results">
          ${searching && results.length === 0 ? html`<div class="ms2-row muted">Searching…</div>`
            : results.map((r, i) => html`<button class="ms2-row" key=${i} onClick=${() => onSearchPick(r)}>
                <span>📍</span><span class="ms2-label">${r.label}</span></button>`)}
        </div>`}
      </div>`}
      <div class="mapfull-map">
        <${LeafletMap} interactive=${true} fitMode="once" initialCenter=${fullCenter} focus=${focus}
          view=${view} memDays=${memDays} pins=${pins}
          pending=${pinSheet && !pinSheet.id ? pinSheet : null}
          onDayClick=${onDayClick} onPinClick=${(p) => setPinSheet({ ...p })} onMapClick=${onMapTap} />
        ${view === "want" && adding && html`<div class="map-tapnote">tap the map to drop a pin 💫</div>`}
        ${daySheet && view === "been" && html`<div class="memday-pop" onClick=${() => setDaySheet(null)}>
          ${daySheet.photo && html`<img src=${daySheet.photo} alt="" />`}
          <div class="mp-main">
            <div class="mp-title">${daySheet.title || daySheet.place || "A day together"}</div>
            <div class="mp-sub">${[daySheet.place && daySheet.title ? daySheet.place : null, fmtDay(daySheet.date), `${daySheet.count} ${daySheet.count === 1 ? "photo" : "photos"}`].filter(Boolean).join(" · ")}</div>
          </div>
          <span class="mp-x">✕</span>
        </div>`}
      </div>
      <div class="mapfull-panel">${panel(true)}</div>
    </div>`, document.body)}

    ${pinSheet && createPortal(html`<${PinSheet} f=${pinSheet} setF=${setPinSheet} onSave=${savePin} onDelete=${deletePin} />`, document.body)}
  </div>`;
}

const PIN_EMOJI = ["📍", "💗", "🍜", "🏖️", "⛰️", "🎡", "☕", "🎭", "🌲", "🗽", "🌴", "✈️"];
function PinSheet({ f, setF, onSave, onDelete }) {
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setF(null); }}>
    <div class="modal">
      <div class="handle"></div>
      <div class="eyebrow" style="margin-bottom:10px">${f.id ? "💫 place" : "💫 somewhere we want to go"}</div>
      <input autofocus value=${f.title} onInput=${up("title")} placeholder="Name this place…" />
      <div class="emoji-row mt">${PIN_EMOJI.map((e) => html`<button key=${e} class=${`emoji-pick ${f.emoji === e ? "on" : ""}`} onClick=${() => setF({ ...f, emoji: e })}>${e}</button>`)}</div>
      <input class="mt" value=${f.note || ""} onInput=${up("note")} placeholder="Why there? (optional)" />
      <button class="btn block mt" onClick=${onSave}>${f.id ? "Save" : "Pin it 💫"}</button>
      ${f.id && html`<button class="btn ghost block mt" style="color:var(--bad);border-color:var(--bad)" onClick=${onDelete}>Delete</button>`}
      <button class="linkbtn block mt" style="width:100%" onClick=${() => setF(null)}>Cancel</button>
    </div>
  </div>`;
}

function fmtDay(d) {
  try { return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}
