import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { useMemoryComments, MEM_REACTS } from "./comments.js";

const html = htm.bind(h);

/* 📸 Memories — a shared photo & video gallery (Supabase Storage) and a
   memory-match game: flip cards to find two photos taken on the SAME DAY. */

const dayHead = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
};

// client-side photo downscale → fast uploads, consistent quality.
// Two decode paths: createImageBitmap (fast) falling back to an <img> decode
// (handles iPhone HEIC on Safari, where createImageBitmap can refuse).
async function decodeImage(file) {
  try { return await createImageBitmap(file); } catch {}
  return await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("undecodable image")); };
    img.src = url;
  });
}
// Draw any decoded source (ImageBitmap, <img>, or <video>) into a canvas
// downscaled so its longest edge is `maxDim`. object-fit:cover crop optional.
function canvasOf(src, maxDim, square) {
  const w0 = src.videoWidth || src.naturalWidth || src.width;
  const h0 = src.videoHeight || src.naturalHeight || src.height;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  if (square) {
    cv.width = cv.height = maxDim;
    const s = Math.max(maxDim / w0, maxDim / h0);
    const dw = w0 * s, dh = h0 * s;
    ctx.drawImage(src, (maxDim - dw) / 2, (maxDim - dh) / 2, dw, dh);
  } else {
    const s = Math.min(1, maxDim / Math.max(w0, h0));
    cv.width = Math.round(w0 * s); cv.height = Math.round(h0 * s);
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
  }
  return cv;
}
// Encode a canvas, preferring WebP but honestly falling back to JPEG when the
// browser can't encode WebP (iOS < 16). Reports the real type so paths/CT match.
async function encodeCanvas(cv, q, preferWebp = true) {
  if (preferWebp) {
    const w = await new Promise((r) => cv.toBlob(r, "image/webp", q));
    if (w && w.type === "image/webp") return { blob: w, ext: "webp", ct: "image/webp" };
  }
  const j = await new Promise((r) => cv.toBlob(r, "image/jpeg", q));
  if (!j) throw new Error("couldn’t encode image");
  return { blob: j, ext: "jpg", ct: "image/jpeg" };
}
// tiny blurred placeholder as a data-URL (~20px). Stretched + blurred in CSS.
function blurDataURL(src) {
  const cv = canvasOf(src, 20, true);
  try { const u = cv.toDataURL("image/webp", 0.5); if (u.startsWith("data:image/webp")) return u; } catch {}
  try { return cv.toDataURL("image/jpeg", 0.4); } catch { return null; }
}
// One decode → full (1600 JPEG), thumb (400 WebP/JPEG), blur (20px data-URL).
async function processPhoto(file) {
  const src = await decodeImage(file);            // throws if truly undecodable
  try {
    const full = await encodeCanvas(canvasOf(src, 1600), 0.82, false);   // keep full as JPEG
    const thumb = await encodeCanvas(canvasOf(src, 400, true), 0.8);
    const blur = blurDataURL(src);
    return { full: full.blob, thumb, blur };
  } finally {
    if (src.close) try { src.close(); } catch {}
    if (src.src) try { URL.revokeObjectURL(src.src); } catch {}
  }
}
// Capture a poster frame + blur from a video, on-device. Returns null on any
// hiccup (the grid then falls back to a neutral tile). Watchdog-guarded — a
// video that never fires loadeddata/seeked won't hang the upload.
function videoPoster(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (val) => { if (done) return; done = true; clearTimeout(wd); try { URL.revokeObjectURL(url); } catch {} resolve(val); };
    const grab = async () => {
      try {
        const thumb = await encodeCanvas(canvasOf(v, 400, true), 0.8);
        const blur = blurDataURL(v);
        finish({ thumb, blur });
      } catch { finish(null); }
    };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { grab(); } };
    v.onseeked = grab;
    v.onerror = () => finish(null);
    const wd = setTimeout(() => finish(null), 6000);
    v.src = url;
  });
}
// Same capture, but from a Storage URL (for backfilling posters onto legacy
// videos that predate on-device poster generation). preload=metadata + a short
// seek only pulls the first frames via range requests — not the whole file —
// and crossOrigin keeps the captured frame untainted so it can be encoded. Run
// it OFF-DOM and one-at-a-time; many video elements at once is what crashed the
// day grid. Any CORS/decode hiccup resolves null and is simply skipped.
function posterFromUrl(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "metadata"; v.crossOrigin = "anonymous";
    let done = false;
    const finish = (val) => { if (done) return; done = true; clearTimeout(wd); try { v.removeAttribute("src"); v.load(); } catch {} resolve(val); };
    const grab = async () => {
      try {
        const thumb = await encodeCanvas(canvasOf(v, 400, true), 0.8);
        const blur = blurDataURL(v);
        finish({ thumb, blur });
      } catch { finish(null); }
    };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { grab(); } };
    v.onseeked = grab;
    v.onerror = () => finish(null);
    const wd = setTimeout(() => finish(null), 8000);
    v.src = url;
  });
}

/* ---- capture metadata: the photo knows when and where it was taken -------
   EXIF lives as a TIFF block after an "Exif\0\0" marker — in JPEGs and HEICs
   alike — so one byte-scan covers both. Videos carry a creation time in the
   MP4 'mvhd' box. file.lastModified is the LAST resort (phones often stamp it
   with the pick time, which was the whole bug). */
async function exifMeta(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer());
    let i = -1;
    for (let k = 0; k < buf.length - 6; k++) {
      if (buf[k] === 0x45 && buf[k+1] === 0x78 && buf[k+2] === 0x69 && buf[k+3] === 0x66 && buf[k+4] === 0 && buf[k+5] === 0) { i = k + 6; break; }
    }
    if (i < 0) return {};
    const dv = new DataView(buf.buffer, i);
    const big = dv.getUint16(0) === 0x4d4d;
    const u16 = (o) => dv.getUint16(o, !big);
    const u32 = (o) => dv.getUint32(o, !big);
    const found = {};
    const readIFD = (off, tags) => {
      let n; try { n = u16(off); } catch { return; }
      for (let k = 0; k < n; k++) {
        const e = off + 2 + k * 12;
        const tag = u16(e);
        if (tags[tag]) found[tags[tag]] = { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8), entry: e };
      }
    };
    readIFD(u32(4), { 0x8769: "exifPtr", 0x8825: "gpsPtr", 0x0132: "dt" });
    if (found.exifPtr) readIFD(found.exifPtr.value, { 0x9003: "dto" });
    if (found.gpsPtr) readIFD(found.gpsPtr.value, { 1: "latRef", 2: "lat", 3: "lngRef", 4: "lng" });
    const out = {};
    // TIFF rule: values that fit in 4 bytes live INLINE in the entry; bigger
    // ones live behind a pointer. GPS refs ("N"/"W", 2 bytes) are inline.
    const dataAt = (f, byteLen) => (byteLen <= 4 ? f.entry + 8 : f.value);
    const ascii = (f) => { const off = dataAt(f, f.count); let s = ""; for (let k = 0; k < f.count - 1; k++) s += String.fromCharCode(dv.getUint8(off + k)); return s; };
    const dtf = found.dto || found.dt;
    if (dtf) {
      const m = ascii(dtf).match(/(\d{4}):(\d{2}):(\d{2})/);
      if (m) out.taken_on = `${m[1]}-${m[2]}-${m[3]}`;
    }
    const rat3 = (f) => { const v = []; for (let k = 0; k < 3; k++) v.push(u32(f.value + k * 8) / (u32(f.value + k * 8 + 4) || 1)); return v[0] + v[1] / 60 + v[2] / 3600; };
    if (found.lat && found.lng) {
      let lat = rat3(found.lat), lng = rat3(found.lng);
      if (found.latRef && ascii(found.latRef) === "S") lat = -lat;
      if (found.lngRef && ascii(found.lngRef) === "W") lng = -lng;
      if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = +lat.toFixed(5); out.lng = +lng.toFixed(5); }
    }
    return out;
  } catch { return {}; }
}

async function mp4Date(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
    for (let k = 0; k < buf.length - 24; k++) {
      if (buf[k] === 0x6d && buf[k+1] === 0x76 && buf[k+2] === 0x68 && buf[k+3] === 0x64) { // 'mvhd'
        const dv = new DataView(buf.buffer, k + 4);
        const version = dv.getUint8(0);
        const secs = version === 1 ? Number(dv.getBigUint64(4)) : dv.getUint32(4);
        const ms = (secs - 2082844800) * 1000;            // 1904 epoch → unix
        if (ms > 631152000000 && ms < Date.now() + 86400000) {  // sanity: after 1990
          const d = new Date(ms);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
    }
  } catch {}
  return null;
}

// free, key-less reverse geocode (BigDataCloud client API) — best effort
async function placeFor(lat, lng) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    const j = await r.json();
    const town = j.city || j.locality || j.principalSubdivision;
    if (!town) return null;
    const region = (j.principalSubdivisionCode || "").split("-")[1] || j.countryCode;
    return region && region !== town ? `${town}, ${region}` : town;
  } catch { return null; }
}

// Retry a Supabase call that resolves to {error} OR throws on a dropped
// connection — mobile networks drop large bodies routinely, and a thrown
// network error must be retried, not allowed to escape. Exponential backoff
// with jitter (so parallel lanes don't retry in lockstep), capped; the final
// failure propagates so the caller can mark the file failed.
async function withRetry(fn, attempts = 5, base = 800) {
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fn();
      if (!res || !res.error) return res;
      lastErr = res.error;
    } catch (e) { lastErr = e; }
    if (attempt < attempts - 1)
      await new Promise((r) => setTimeout(r, Math.min(base * 2 ** attempt, 8000) + Math.random() * 500));
  }
  throw lastErr || new Error("failed");
}

const uploadWithRetry = (client, path, blob, contentType) =>
  withRetry(() => client.storage.from("memories")
    .upload(path, blob, { contentType, cacheControl: "31536000", upsert: true }));

// Process + upload ONE reward proof photo/video. Goes in the memories bucket but
// NOT the memories table — so it stays a separate "reward" card and never joins
// a memory day. Returns the stored paths/blur + a taken_on date for the
// redemption row. (Reuses the same on-device shrink + thumb pipeline.)
export async function uploadRewardPhoto(client, file) {
  const base = `r${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isVideo = file.type.startsWith("video/");
  const meta = isVideo ? { taken_on: await mp4Date(file) } : await exifMeta(file);
  let path, thumb_path = null, blur = null;
  if (isVideo) {
    const ext = file.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4";
    path = `${base}.${ext}`;
    await uploadWithRetry(client, path, file, file.type || "video/mp4");
    const poster = await videoPoster(file);
    if (poster) { try { thumb_path = `t${base.slice(1)}.${poster.thumb.ext}`; await uploadWithRetry(client, thumb_path, poster.thumb.blob, poster.thumb.ct); blur = poster.blur; } catch { thumb_path = null; } }
  } else {
    try {
      const out = await processPhoto(file);
      path = `${base}.jpg`;
      await uploadWithRetry(client, path, out.full, "image/jpeg");
      blur = out.blur;
      thumb_path = `t${base.slice(1)}.${out.thumb.ext}`;
      try { await uploadWithRetry(client, thumb_path, out.thumb.blob, out.thumb.ct); } catch { thumb_path = null; }
    } catch {
      // undecodable on this device → keep the original bytes
      const ext = ((file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "")) || "jpg";
      path = `${base}.${ext}`;
      await uploadWithRetry(client, path, file, file.type || "image/jpeg");
    }
  }
  let taken_on = meta.taken_on;
  if (!taken_on) { const d = new Date(file.lastModified || Date.now()); taken_on = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  return { path, thumb_path, blur, taken_on };
}

// Resumable (TUS) upload for LARGE files — i.e. videos. A one-shot upload of a
// 160MB clip over a phone uplink restarts from zero if the connection drops at
// 90%. TUS checkpoints in 6MB chunks (the size Supabase requires): on a dropped
// chunk we re-sync the server's true offset via HEAD and continue from there,
// not from the start. Covers the common case (a flaky network during one
// upload); we don't persist across app restarts. Falls back to the one-shot
// path if the TUS endpoint is ever unavailable, so it can only add reliability.
const TUS_CHUNK = 6 * 1024 * 1024;                   // Supabase requires exactly 6MB chunks
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
async function uploadResumable(path, blob, contentType, onProgress) {
  const creds = window.PP_CREDS;
  if (!creds || !creds.url || !creds.key) throw new Error("no creds for resumable upload");
  const endpoint = `${creds.url}/storage/v1/upload/resumable`;
  const auth = { authorization: `Bearer ${creds.key}`, apikey: creds.key, "Tus-Resumable": "1.0.0" };
  const total = blob.size;
  // 1) create the upload — server hands back a Location to PATCH chunks into
  const meta = [["bucketName", "memories"], ["objectName", path], ["contentType", contentType], ["cacheControl", "31536000"]]
    .map(([k, v]) => `${k} ${b64(v)}`).join(",");
  const create = await fetch(endpoint, { method: "POST", headers: { ...auth, "Upload-Length": String(total), "Upload-Metadata": meta, "x-upsert": "true" } });
  if (!create.ok) throw new Error("tus create " + create.status);
  const loc = create.headers.get("location");
  if (!loc) throw new Error("tus: no upload location (CORS?)");
  const url = loc.startsWith("http") ? loc : new URL(loc, endpoint).href;
  // 2) stream the chunks, re-syncing the offset on any hiccup
  let offset = 0, tries = 0;
  while (offset < total) {
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { ...auth, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream", "x-upsert": "true" },
        body: blob.slice(offset, Math.min(offset + TUS_CHUNK, total)),
      });
      if (!res.ok) throw new Error("tus patch " + res.status);
      offset = parseInt(res.headers.get("upload-offset"), 10) || Math.min(offset + TUS_CHUNK, total);
      tries = 0;
      if (onProgress) onProgress(offset, total);
    } catch (e) {
      if (++tries > 6) throw e;                       // give up → caller falls back to one-shot
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** tries, 15000) + Math.random() * 400));
      try { const h = await fetch(url, { method: "HEAD", headers: auth }); if (h.ok) { const o = parseInt(h.headers.get("upload-offset"), 10); if (!isNaN(o)) offset = o; } } catch {}
    }
  }
}

// the grid needs only these columns — never pull the (large, unused) lat/lng or
// any future heavy column into the list query. blur is a tiny inline data-URL.
const SELECT_COLS = "id,path,thumb_path,blur,kind,taken_on,place,created_at";
const PAGE = 60;                                     // rows per infinite-scroll page
// gallery order: newest-taken first, then newest-uploaded — the comparator that
// keeps the in-memory list sorted as realtime rows merge in.
const memCmp = (a, b) =>
  a.taken_on < b.taken_on ? 1 : a.taken_on > b.taken_on ? -1
  : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

// chapter title shown until the AI weaves a real one
const fallbackTitle = (g) => (g.items.find((i) => i.place) || {}).place || "A Day Together";
// shown under a day until its AI story is woven (placeholder, never empty)
const fallbackStory = (g) => {
  const place = (g.items.find((i) => i.place) || {}).place;
  const n = g.items.length, moments = n === 1 ? "moment" : "moments";
  return place ? `${place} — ${n} ${moments} from the day.` : `${n} ${moments} you kept from this day.`;
};
// Special days (birthdays, from players.birthday 'MM-DD') get a real book
// chapter: a multi-paragraph story the day view lays out between the photos.
const specialOf = (date, players) => {
  if (!date) return null;
  const p = (players || []).find((pl) => pl.birthday && date.slice(5) === pl.birthday);
  return p ? `${p.name}'s birthday` : null;
};
// multi-paragraph placeholder so a special day reads like a book even before
// (or without) the AI chapter
const fallbackStorySpecial = (g, occ) => {
  const place = (g.items.find((i) => i.place) || {}).place;
  const n = g.items.length, moments = n === 1 ? "moment" : "moments";
  return [
    `Today is ${occ} — and the day already knows it.`,
    `${place ? place + " holds" : "You kept"} ${n} ${moments} of it: the small ones that end up mattering most.`,
    `The full chapter is being written — give it a moment, then come back to read it together.`,
  ].join("\n\n");
};

export function MemoriesTab({ client, me, players = [], flash }) {
  const [items, setItems] = useState(null);          // null = loading; else loaded window (paged)
  const [view, setView] = useState("gallery");       // 'gallery' | 'game'
  const [lightbox, setLightbox] = useState(null);    // index into items
  const [uploads, setUploads] = useState(null);      // {done, total} | null
  const fileInput = useRef(null);
  // pagination cursor lives in a ref (no re-render churn): how many rows we've
  // pulled via range(), whether the tail is reached, and an in-flight guard.
  const more = useRef({ offset: 0, done: false, loading: false });
  const sentinel = useRef(null);                     // IntersectionObserver target
  const [stories, setStories] = useState({});        // day -> { title, story }
  const storyTried = useRef(new Set());              // days we've already asked to generate this session
  const [dayOpen, setDayOpen] = useState(null);      // the day whose photo grid is open (null = title-card feed)
  const [events, setEvents] = useState([]);          // calendar events, to cite the ones that fell on a day
  const [reweaving, setReweaving] = useState(false); // a manual story rewrite is in flight
  // remember how far down the day-feed you'd scrolled, so returning from a day
  // lands you back there instead of at the top (the feed unmounts while a day
  // is open). contain-intrinsic-size on the tiles keeps the height stable so the
  // restore is exact even before off-screen cards paint.
  const feedScroll = useRef(0);
  const openDay = useCallback((date) => { feedScroll.current = window.scrollY || 0; setDayOpen(date); window.scrollTo(0, 0); }, []);
  useLayoutEffect(() => { if (!dayOpen) window.scrollTo(0, feedScroll.current || 0); }, [dayOpen]);

  // private comments + reactions for whichever memory the lightbox is showing
  const lbItemId = (items && lightbox != null && items[lightbox]) ? items[lightbox].id : null;
  const lbCom = useMemoryComments(client, me, lbItemId);

  const pubUrl = useCallback((path) => {
    try { return client.storage.from("memories").getPublicUrl(path).data.publicUrl; }
    catch { return ""; }
  }, [client]);
  // On-the-fly resized render of a stored image (Supabase image transform). Used
  // so a legacy full-size original is served as a small thumbnail instead of
  // shipping a multi-MB JPEG into a grid tile (a 5MB original → ~290KB @ w=400).
  const renderUrl = useCallback((path, width, quality = 70) => {
    const u = pubUrl(path);
    return u.includes("/object/public/")
      ? u.replace("/object/public/", "/render/image/public/") + `?width=${width}&quality=${quality}`
      : u;
  }, [pubUrl]);
  // The grid/game preview image: the stored thumb if we have one; else a RESIZED
  // render of a legacy photo. Thumbless videos have no preview image (null) — the
  // grid shows a poster tile, never a heavyweight <video> (many at once crash iOS).
  const thumbUrl = useCallback((it) =>
    it.thumb_path ? pubUrl(it.thumb_path) : (it.kind === "photo" ? renderUrl(it.path, 400) : null),
    [pubUrl, renderUrl]);

  const pageQuery = useCallback((from, to) =>
    client.from("memories").select(SELECT_COLS)
      .order("taken_on", { ascending: false }).order("created_at", { ascending: false })
      .range(from, to), [client]);

  // initial page (also used to reset after a hard refresh)
  const load = useCallback(async () => {
    const m = more.current; m.loading = true;
    const { data, error } = await pageQuery(0, PAGE - 1);
    m.loading = false;
    m.offset = (data || []).length;
    m.done = !data || data.length < PAGE;
    setItems(error ? [] : (data || []));
  }, [pageQuery]);

  // next page — keyset would be ideal at huge scale, but offset+dedupe is robust
  // here: a realtime insert above the window just makes range() re-read one seen
  // row, which the id-dedupe drops (no gap, no dupe).
  const loadMore = useCallback(async () => {
    const m = more.current;
    if (m.loading || m.done) return;
    m.loading = true;
    const { data, error } = await pageQuery(m.offset, m.offset + PAGE - 1);
    m.loading = false;
    if (error) return;
    const rows = data || [];
    m.offset += rows.length;
    if (rows.length < PAGE) m.done = true;
    setItems((cur) => {
      const seen = new Set((cur || []).map((r) => r.id));
      const add = rows.filter((r) => !seen.has(r.id));
      return [...(cur || []), ...add];
    });
    // A day-grouped feed can collapse a 60-row page into just a few tiles,
    // leaving the sentinel still on-screen. IntersectionObserver won't re-fire
    // while it stays intersecting, so keep pulling pages until the feed grows
    // tall enough to push the sentinel below the fold (or we reach the end).
    if (!m.done) requestAnimationFrame(() => {
      const el = sentinel.current;
      if (el && el.getBoundingClientRect().top < window.innerHeight + 800) loadMore();
    });
  }, [pageQuery]);

  // re-pull page 0 and upsert — catches anything realtime missed while the phone
  // was asleep, without discarding the pages already scrolled into view.
  const refresh = useCallback(async () => {
    const { data } = await pageQuery(0, PAGE - 1);
    if (!data) return;
    setItems((cur) => {
      if (!cur) return data;
      const map = new Map(cur.map((r) => [r.id, r]));
      for (const r of data) map.set(r.id, r);
      return [...map.values()].sort(memCmp);
    });
  }, [pageQuery]);

  // merge ONE realtime row instead of refetching the whole library.
  const mergeRow = useCallback((payload) => {
    setItems((cur) => {
      if (!cur) return cur;
      if (payload.eventType === "DELETE") {
        const id = payload.old && payload.old.id;
        return id ? cur.filter((r) => r.id !== id) : cur;
      }
      const row = payload.new;
      if (!row) return cur;
      const without = cur.filter((r) => r.id !== row.id);
      // if it sorts older than our last loaded row and there are still unloaded
      // pages, let pagination surface it later rather than stranding it mid-list.
      const last = without[without.length - 1];
      if (!more.current.done && last && memCmp(row, last) > 0) return without;
      return [...without, row].sort(memCmp);
    });
  }, []);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-memories")
        .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, mergeRow)
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load, refresh, mergeRow]);

  // Backfill posters for legacy videos that predate on-device poster generation
  // (no thumb_path). The grid shows a clean poster tile for these instead of a
  // crashy live <video>; here we quietly mint a real thumbnail so it — and the
  // day feed and the Map — get a still. OFF-DOM, idle-gated, one at a time, a
  // few per pass; the effect re-fires as state settles so it works through the
  // whole library across a session without ever mounting concurrent videos.
  const bf = useRef({ running: false, done: new Set() });
  useEffect(() => {
    if (!items || bf.current.running) return;
    const need = items.filter((it) => it.kind === "video" && !it.thumb_path && !bf.current.done.has(it.id));
    if (!need.length) return;
    bf.current.running = true;
    let live = true;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    idle(async () => {
      try {
        let made = 0;
        for (const it of need) {
          if (!live || made >= 6) break;              // bounded per pass; spreads the work + data
          bf.current.done.add(it.id);                 // never retry the same row this session
          const poster = await posterFromUrl(pubUrl(it.path));
          if (!live) return;
          if (!poster) continue;
          const thumb_path = it.path.replace(/(\.[^.]+)?$/, "") + ".thumb." + poster.thumb.ext;
          try {
            await uploadWithRetry(client, thumb_path, poster.thumb.blob, poster.thumb.ct);
            await client.from("memories").update({ thumb_path, blur: poster.blur }).eq("id", it.id);
            setItems((cur) => (cur || []).map((r) => r.id === it.id ? { ...r, thumb_path, blur: poster.blur } : r));
            made++;
          } catch {}
        }
      } finally { bf.current.running = false; }
    });
    return () => { live = false; bf.current.running = false; };
  }, [items, client, pubUrl]);

  // infinite scroll: a sentinel below the grid pulls the next page as it nears.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== "gallery") return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, view, items === null, dayOpen]);

  // Opened from the Reactions thread: jump straight to that memory's lightbox
  // once it's in the loaded window. Pull more pages if it's older. The thread
  // now lives in this same room, so also listen for its pp-focus-memory event
  // (the items-change effect alone wouldn't fire on a tap while already here).
  const focusWanted = useCallback(() => {
    if (!items) return;
    const want = window.__ppFocusMemory;
    if (!want) return;
    const idx = items.findIndex((it) => it.id === want);
    if (idx >= 0) { window.__ppFocusMemory = null; setView("gallery"); setLightbox(idx); }
    else if (!more.current.done) loadMore();          // not loaded yet → fetch more, effect re-runs
  }, [items, loadMore]);
  useEffect(() => { focusWanted(); }, [focusWanted]);
  useEffect(() => {
    window.addEventListener("pp-focus-memory", focusWanted);
    return () => window.removeEventListener("pp-focus-memory", focusWanted);
  }, [focusWanted]);

  // Concurrent upload queue (2 lanes) with per-file status — photos shrink
  // on-device first; videos go as-is. Two lanes (not three) keeps fewer large
  // bodies in flight on a phone uplink, so a dropped connection loses less and
  // each request is less likely to time out; the shrunk photos still fly.
  const onPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const jobs = files.map((f, i) => ({ i, f, status: "queued" }));
    const forceDay = dayOpen;                         // picking inside an open day → the file belongs to THAT day
    const added = [];                                 // inserted rows, merged in immediately (survives pagination)
    const paint = () => {
      const done = jobs.filter((j) => j.status === "done" || j.status === "failed").length;
      // fractional progress so a single big video animates the bar instead of
      // sitting at 0% until it finishes (each job contributes 0..1).
      const frac = jobs.reduce((s, j) => s + (j.status === "done" || j.status === "failed" ? 1 : (j.prog || 0)), 0);
      setUploads({ done, total: jobs.length, failed: jobs.filter((j) => j.status === "failed").length, pct: Math.round((frac / jobs.length) * 100) });
    };
    paint();
    const runJob = async (j) => {
      const f = j.f;
      try {
        const isVideo = f.type.startsWith("video/");
        if (isVideo && f.size > 490 * 1024 * 1024) throw new Error("video over 500MB — trim it first");
        j.status = "working"; paint();
        const base = `u${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // real capture metadata comes from the ORIGINAL file bytes (before shrink)
        const meta = isVideo ? { taken_on: await mp4Date(f) } : await exifMeta(f);
        let blob, ext, ct, thumb = null, blur = null;
        if (isVideo) {
          blob = f; ext = f.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4"; ct = f.type || "video/mp4";
          const poster = await videoPoster(f);                 // best-effort; null is fine
          if (poster) { thumb = poster.thumb; blur = poster.blur; }
        } else {
          try {
            const out = await processPhoto(f);
            blob = out.full; ext = "jpg"; ct = "image/jpeg";
            thumb = out.thumb; blur = out.blur;
          } catch {
            // undecodable on THIS device (e.g. HEIC opened in desktop Chrome, or
            // a canvas that ran out of memory) — save the ORIGINAL bytes rather
            // than lose the memory. The grid falls back to the full image when a
            // row has no thumb, and the couple's phones (Safari/iOS) render HEIC.
            blob = f;
            ct = f.type || "image/jpeg";
            ext = ((f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "")) || "jpg";
          }
        }
        const path = `${base}.${ext}`;
        // Videos are big & uploaded over a phone → resumable (TUS) so a dropped
        // connection resumes instead of restarting. Photos/thumbs are tiny → the
        // one-shot upload (resumable's 6MB-chunk floor would only add overhead).
        if (isVideo && window.PP_CREDS && window.PP_CREDS.url) {
          try {
            await uploadResumable(path, blob, ct, (sent, tot) => { j.prog = tot ? sent / tot : 0; paint(); });
          } catch {
            j.prog = 0; paint();
            await uploadWithRetry(client, path, blob, ct);   // TUS unavailable → one-shot fallback
          }
        } else {
          await uploadWithRetry(client, path, blob, ct);
        }
        j.prog = 1; paint();
        // thumbnail/poster is a separate small object; failure here is non-fatal
        // (grid falls back to the full image), so don't sink the whole upload.
        let thumb_path = null;
        if (thumb) {
          thumb_path = `t${base.slice(1)}.${thumb.ext}`;
          try { await uploadWithRetry(client, thumb_path, thumb.blob, thumb.ct); }
          catch { thumb_path = null; }
        }
        let taken_on = forceDay || meta.taken_on;     // an open day wins over the photo's own capture date
        if (!taken_on) {
          const taken = new Date(f.lastModified || Date.now());
          taken_on = `${taken.getFullYear()}-${String(taken.getMonth() + 1).padStart(2, "0")}-${String(taken.getDate()).padStart(2, "0")}`;
        }
        const place = meta.lat != null ? await placeFor(meta.lat, meta.lng) : null;
        // the bytes are already in Storage — don't lose the memory to one
        // transient DB blip. Retry the row insert with the same backoff, and get
        // the row back so we can show it instantly (even in a day outside the
        // currently-loaded page window).
        const res = await withRetry(() => client.from("memories")
          .insert({ path, kind: isVideo ? "video" : "photo", taken_on, uploaded_by: me.id,
                    place, lat: meta.lat ?? null, lng: meta.lng ?? null, thumb_path, blur })
          .select(SELECT_COLS).single());
        if (res && res.data) added.push(res.data);
        j.status = "done";
      } catch (err) {
        j.status = "failed"; j.err = err.message || "failed";
      }
      paint();
    };
    const lanes = Array.from({ length: 2 }, async () => {
      for (;;) {
        const j = jobs.find((x) => x.status === "queued");
        if (!j) return;
        j.status = "working";
        await runJob(j);
      }
    });
    await Promise.all(lanes);
    const ok = jobs.filter((j) => j.status === "done").length;
    const failed = jobs.filter((j) => j.status === "failed");
    setUploads(null);
    // merge the new rows in immediately so they appear in their day at once —
    // including a day below the loaded window (uploading into an opened old day).
    if (added.length) setItems((cur) => {
      const map = new Map((cur || []).map((r) => [r.id, r]));
      for (const r of added) map.set(r.id, r);
      return [...map.values()].sort(memCmp);
    });
    if (ok) refresh();                                // also reconcile with the server
    if (failed.length) flash(`⚠️ ${failed.length} failed (${failed[0].err})${ok ? ` · ${ok} added` : ""}`);
    else if (ok) flash(`Added ${ok} ${ok === 1 ? "memory" : "memories"} 📸`);
  };

  // tap & hold ANY memory → start multi-select (and grab that one). Quick tap →
  // lightbox. Single-item options (save/date/place/delete) live on the
  // lightbox's ⋯ button.
  const [sheet, setSheet] = useState(null);          // single-item options sheet
  const press = useRef(null);
  const origin = useRef(null);                       // where the tap landed → lightbox zooms from there
  const holdStart = (it) => (e) => {
    const sx = e.clientX, sy = e.clientY;
    press.current = { sx, sy, fired: false, t: setTimeout(() => {
      press.current = { fired: true };
      try { navigator.vibrate && navigator.vibrate(30); } catch {}
      setSel((s) => { const n = new Set(s || []); n.add(it.id); return n; });   // enter select mode + select this one
    }, 420) };
  };
  const holdEnd = (it) => (e) => {
    const p = press.current;
    if (p && p.t) clearTimeout(p.t);
    const fired = p && p.fired;
    press.current = null;
    if (!fired) {                                    // quick tap → lightbox
      const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
      origin.current = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      setLightbox(flat.indexOf(it));
    }
  };
  // any real movement before the timer fires = a scroll/drag, not a hold → cancel
  const holdCancel = (e) => {
    const p = press.current;
    if (!p || !p.t) return;
    const moved = e && e.clientX != null && p.sx != null
      ? Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10 : true;
    if (moved) { clearTimeout(p.t); press.current = null; }
  };

  /* ---- select mode: tap to toggle, drag across cells to sweep-select ----
     (cells get touch-action: pan-y, so vertical scrolling still works) */
  const [sel, setSel] = useState(null);              // null = browsing; Set of ids = selecting
  const [editor, setEditor] = useState(null);        // {type:'date'|'place', ids:[...]}
  const [busy, setBusy] = useState(false);
  const edInput = useRef(null);
  const dragSel = useRef(null);
  const selToggle = (id, to) => setSel((s) => { const n = new Set(s); to ? n.add(id) : n.delete(id); return n; });
  // Deliberate gesture: we do NOT toggle on touch-down. A stationary release is
  // a tap (toggle one). A HORIZONTAL drag engages sweep-select. A VERTICAL drag
  // is a scroll and selects nothing — fixes accidental selection while scrolling.
  const selDown = (it) => (e) => {
    dragSel.current = { id: it.id, sx: e.clientX, sy: e.clientY, mode: "pending", to: !sel.has(it.id), seen: new Set() };
  };
  const selMove = (e) => {
    const d = dragSel.current;
    if (!d || d.mode === "scroll") return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.mode === "pending") {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { d.mode = "scroll"; return; }   // vertical → let the page scroll
      if (Math.abs(dx) > 12) {                                  // horizontal → deliberate sweep
        d.mode = "sweep"; d.seen.add(d.id); selToggle(d.id, d.to);
        try { navigator.vibrate && navigator.vibrate(10); } catch {}
      } else return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest(".memcell[data-id]");
    const id = cell && cell.dataset.id;
    if (id && !d.seen.has(id)) { d.seen.add(id); selToggle(id, d.to); try { navigator.vibrate && navigator.vibrate(4); } catch {} }
  };
  const selUp = () => {
    const d = dragSel.current; dragSel.current = null;
    if (d && d.mode === "pending") { selToggle(d.id, d.to); try { navigator.vibrate && navigator.vibrate(6); } catch {} }  // tap → toggle one
  };
  const selCancel = () => { dragSel.current = null; };       // scroll began → make no selection
  const dayToggle = (g) => () => {
    const all = g.items.every((i) => sel.has(i.id));
    setSel((s) => { const n = new Set(s); g.items.forEach((i) => (all ? n.delete(i.id) : n.add(i.id))); return n; });
    try { navigator.vibrate && navigator.vibrate(8); } catch {}
  };

  const bulkDelete = async () => {
    const its = (items || []).filter((it) => sel.has(it.id));
    if (!its.length) return;
    if (!confirm(`Delete ${its.length === 1 ? "this memory" : `these ${its.length} memories`} for both of you?`)) return;
    setBusy(true);
    try {
      try { await client.storage.from("memories").remove(its.flatMap((i) => i.thumb_path ? [i.path, i.thumb_path] : [i.path])); } catch {}
      const { error } = await client.from("memories").delete().in("id", its.map((i) => i.id));
      if (error) throw error;
      const gone = new Set(its.map((i) => i.id));
      setItems((cur) => (cur || []).filter((r) => !gone.has(r.id)));
      flash(`Deleted ${its.length}`);
      setSel(null);
    } catch (err) { flash("⚠️ " + (err.message || "delete failed")); }
    setBusy(false);
  };

  const editorDefault = () => {
    const first = (items || []).find((i) => editor.ids.includes(i.id));
    return editor.type === "date" ? (first ? first.taken_on : "") : ((first && first.place) || "");
  };
  const applyEditor = async (clear) => {
    const ids = editor.ids;
    let patch;
    if (editor.type === "date") {
      const v = edInput.current && edInput.current.value;
      if (!v) return;
      patch = { taken_on: v };
    } else {
      const v = clear === true ? "" : ((edInput.current && edInput.current.value) || "").trim();
      patch = { place: v || null, lat: null, lng: null };   // hand-set place ≠ the photo's GPS
    }
    setBusy(true);
    try {
      const { error } = await client.from("memories").update(patch).in("id", ids);
      if (error) throw error;
      const idset = new Set(ids);
      setItems((cur) => (cur || []).map((r) => idset.has(r.id) ? { ...r, ...patch } : r).sort(memCmp));
      flash(`${editor.type === "date" ? "📅" : "📍"} ${ids.length} updated`);
      setEditor(null); setSheet(null); setSel(null);
    } catch (err) { flash("⚠️ " + (err.message || "update failed")); }
    setBusy(false);
  };

  const saveItem = async (it) => {
    try {
      const res = await fetch(pubUrl(it.path));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = it.path;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      flash("Saving 📥");
    } catch { flash("⚠️ couldn’t fetch the file"); }
    setSheet(null);
  };
  const deleteItem = async (it) => {
    if (!confirm("Delete this memory for both of you?")) return;
    try {
      await client.storage.from("memories").remove([it.path, ...(it.thumb_path ? [it.thumb_path] : [])]);
      await client.from("memories").delete().eq("id", it.id);
      setItems((cur) => (cur || []).filter((r) => r.id !== it.id));
      flash("Deleted");
      setSheet(null);
    } catch (err) { flash("⚠️ " + (err.message || "delete failed")); }
  };

  // group by day for the gallery
  const groups = useMemo(() => {
    const g = [];
    for (const it of items || []) {
      const last = g[g.length - 1];
      if (last && last.date === it.taken_on) last.items.push(it);
      else g.push({ date: it.taken_on, items: [it] });
    }
    return g;
  }, [items]);

  // ---- AI day-stories: load cached ones, then weave the newest few that are
  // missing (Claude vision via the `day-story` edge function). Bounded per
  // session so a lifetime of days doesn't fan out into a flood of calls.
  useEffect(() => {
    const days = groups.map((g) => g.date).filter(Boolean);
    if (!days.length) return;
    let live = true;
    client.from("day_stories").select("day,title,story,sig").in("day", days).then(({ data }) => {
      if (!live || !data) return;
      const got = {}; data.forEach((r) => { got[r.day] = { title: r.title, story: r.story, sig: r.sig }; });
      setStories((s) => { const merged = {}; for (const k in got) merged[k] = { title: got[k].title, story: got[k].story }; return { ...merged, ...s }; });
      // Queue days that need a story woven — DEFERRED and ONE AT A TIME so these
      // long edge-function calls never compete with the feed's image loading.
      // A day re-weaves when enough NEW content arrived since it was last told:
      // ≥3 new photos, or ≥2 that grew the day by half. A stray photo or two
      // keeps the existing story (the words still fit, and re-weaving costs an
      // AI call + churns the partner's view). The guard key is day+count so a
      // grown day re-runs but the same volume never weaves twice. (sig = "count:firstId".)
      const queue = [];
      for (const g of groups) {
        if (queue.length >= 6) break;
        if (!g.date) continue;
        const cur = g.items.length;
        const key = g.date + ":" + cur;
        if (storyTried.current.has(key)) continue;
        const stored = got[g.date];
        if (stored) {
          const was = parseInt(String(stored.sig || "").split(":")[0], 10) || 0;
          const added = cur - was;
          // a special day whose stored story is still a one-paragraph caption
          // upgrades to a full chapter; otherwise the usual new-content rule
          const wantsChapter = specialOf(g.date, players) && !/\n{2,}/.test(stored.story || "");
          if (!wantsChapter && !(added >= 3 || (added >= 2 && added >= was * 0.5))) continue;   // not enough new content → keep it
        }
        storyTried.current.add(key); queue.push(g);
      }
      if (queue.length) {
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1400));
        idle(async () => { for (const g of queue) { if (!live) break; await weaveStory(g); } });
      }
    });
    return () => { live = false; };
  }, [groups, client, players]);

  // calendar events — so a day can cite what was planned/happening then
  useEffect(() => {
    let live = true;
    client.from("events").select("id,title,emoji,starts_on").then(({ data }) => { if (live && data) setEvents(data); });
    return () => { live = false; };
  }, [client]);

  // opts.fresh = the day's current story → asks the function for a NEW take.
  // Returns true on success so a manual rewrite can confirm/flash.
  const weaveStory = useCallback(async (g, opts = {}) => {
    // Hand the AI SMALL images: the thumbnail if we have one, else a resized
    // Storage render of the full image — never a multi-MB original (6 of those
    // blew the Edge Function's memory: WORKER_RESOURCE_LIMIT, e.g. on days with
    // thumbless HEIC-fallback uploads).
    const aiImg = (it) => {
      if (it.thumb_path) return pubUrl(it.thumb_path);
      const full = pubUrl(it.path);
      return full.includes("/object/public/") ? full.replace("/object/public/", "/render/image/public/") + "?width=480&quality=68" : full;
    };
    const images = g.items.filter((it) => it.kind === "photo").map(aiImg).filter(Boolean).slice(0, 6);
    if (!images.length) return false;
    const place = (g.items.find((i) => i.place) || {}).place || null;
    const sig = g.items.length + ":" + g.items[0].id;
    const body = { day: g.date, images, context: { date: dayHead(g.date), place, count: g.items.length, sig } };
    const occ = specialOf(g.date, players);
    if (occ) body.special = occ;                    // birthdays → a multi-paragraph chapter
    if (opts.fresh && (opts.fresh.story || opts.fresh.title)) body.fresh = { title: opts.fresh.title || null, story: opts.fresh.story || null };
    try {
      const { data } = await client.functions.invoke("day-story", { body });
      if (data && data.story) { setStories((s) => ({ ...s, [g.date]: { title: data.title, story: data.story } })); return true; }
      return false;
    } catch { return false; }
  }, [client, pubUrl, players]);

  const flat = items || [];
  const openGroup = dayOpen ? groups.find((g) => g.date === dayOpen) : null;

  // one photo/video tile (used in a day's grid)
  const cell = (it) => {
    const src = thumbUrl(it);                         // null only for a thumbless video → poster tile
    return html`<button class=${`memcell ${sel ? "selble" : ""} ${sel && sel.has(it.id) ? "selon" : ""}`} key=${it.id} data-id=${it.id}
      onPointerDown=${sel ? selDown(it) : holdStart(it)} onPointerUp=${sel ? selUp : holdEnd(it)}
      onPointerMove=${sel ? selMove : holdCancel} onPointerCancel=${sel ? selCancel : holdCancel}
      onContextMenu=${(e) => e.preventDefault()}>
      ${it.blur && html`<span class="memblur" style=${`background-image:url(${it.blur})`}></span>`}
      ${src && html`<img src=${src} loading="lazy" decoding="async" alt="" crossorigin="anonymous"
          onLoad=${(e) => e.target.classList.add("ld")}
          ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />`}
      ${it.kind === "video" && html`<span class="memplay">🎥</span>`}
      ${sel && html`<span class="selbadge">${sel.has(it.id) ? "✓" : ""}</span>`}
    </button>`;
  };

  return html`<div>
    <div class="card">
      <!-- a day's detail page hides the Memories chrome (title + view toggle);
           only that day's own actions (Select, Add-to-this-day) remain -->
      <div class="shead">
        ${!openGroup && html`<h2>Memories</h2>`}
        <div class="shead-actions">
          ${sel ? html`<button class="btn sm" onClick=${() => setSel(null)}>Done</button>`
          : html`${!openGroup && html`<div class="seg" style="padding:3px">
            <button class=${view === "gallery" ? "on" : ""} onClick=${() => setView("gallery")}>Gallery</button>
            <button class=${view === "game" ? "on" : ""} onClick=${() => setView("game")}>Match</button>
          </div>`}
          ${view === "gallery" && dayOpen && html`<button class="linkbtn micro" onClick=${() => setSel(new Set())}>Select</button>`}
          <button class="btn sm" disabled=${!!uploads} onClick=${() => fileInput.current && fileInput.current.click()}>
            ${uploads ? `${uploads.done}/${uploads.total}…` : "＋ Add"}
          </button>`}
        </div>
      </div>
      <input ref=${fileInput} type="file" accept="image/*,video/*" multiple style="display:none" onChange=${onPick} />

      ${uploads && html`<div class="upbar"><div class="upbar-fill" style=${`width:${uploads.pct != null ? uploads.pct : Math.round((uploads.done / uploads.total) * 100)}%`}></div></div>`}
      ${uploads && html`<div class="tiny muted" style="margin:-6px 0 10px">uploading ${uploads.done}/${uploads.total}${uploads.failed ? ` · ${uploads.failed} failed` : ""}</div>`}

      ${items === null && html`<div class="memskel">${[...Array(9)].map((_, i) => html`<div class="memskel-cell" key=${i}></div>`)}</div>`}
      ${items !== null && items.length === 0 && html`<div class="empty"><span class="big">📸</span>No memories yet — add your first.</div>`}

      <!-- title-card feed: scroll the days like a journey; tap a card to open the day -->
      ${view === "gallery" && items !== null && !openGroup && html`<div class="dayfeed">
        ${groups.map((g, gi) => {
          const s = stories[g.date];
          const cover = g.items.find((i) => i.kind === "photo") || g.items[0];
          const heroSrc = cover.thumb_path ? pubUrl(cover.thumb_path) : (cover.kind === "photo" ? renderUrl(cover.path, 700) : null);
          const evs = events.filter((e) => e.starts_on === g.date);
          // blur-up placeholder (instant) under a natively lazy hero (off-screen cards never fetch)
          return html`<button class="daytile" key=${g.date} style=${cover.blur ? `background-image:url(${cover.blur})` : ""} onClick=${() => openDay(g.date)}>
            ${heroSrc && html`<img class="dt-img" src=${heroSrc} alt="" decoding="async" crossorigin="anonymous"
              loading=${gi === 0 ? "eager" : "lazy"} fetchpriority=${gi === 0 ? "high" : "auto"}
              onLoad=${(e) => e.target.classList.add("ld")}
              ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />`}
            <span class="dt-scrim"></span>
            ${evs.length ? html`<span class="dt-ev" title=${evs.map((e) => e.title).join(", ")}>${evs[0].emoji || "📌"}${evs.length > 1 ? ` +${evs.length - 1}` : ""}</span>` : ""}
            <span class="dt-count">${g.items.length} 📸</span>
            <span class="dt-body">
              <span class="dt-date">${dayHead(g.date)}</span>
              <span class="dt-title">${(s && s.title) || fallbackTitle(g)}</span>
              <span class="dt-story">${((s && s.story) || fallbackStory(g)).split(/\n{2,}/)[0]}</span>
            </span>
          </button>`;
        })}
        <div ref=${sentinel} class="memsentinel">${!more.current.done ? html`<span class="memspin"></span>` : ""}</div>
      </div>`}

      <!-- a single day: its story, then the photos. Ordinary days are a lede +
           one grid; special days (birthdays) read like a BOOK — the chapter's
           paragraphs interleaved with runs of photos, ending on the last words. -->
      ${view === "gallery" && openGroup && (() => {
        const st = stories[openGroup.date] || {};
        const occ = specialOf(openGroup.date, players);
        const storyText = st.story || (occ ? fallbackStorySpecial(openGroup, occ) : fallbackStory(openGroup));
        const paras = storyText.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
        const book = paras.length > 1;
        // split the day's photos into one run per remaining paragraph
        const runs = [];
        if (book) {
          const n = paras.length - 1, len = openGroup.items.length;
          const base = Math.floor(len / n); let rem = len % n, i = 0;
          for (let k = 0; k < n; k++) { const take = base + (k < rem ? 1 : 0); runs.push(openGroup.items.slice(i, i + take)); i += take; }
        }
        return html`<div class="daydetail">
        <button class="dd-back" onClick=${() => setDayOpen(null)}>‹ All days</button>
        <div class="dd-head">
          <div class="dd-date">${dayHead(openGroup.date)}</div>
          ${occ && html`<div class="dd-occasion">🎂 ${occ}</div>`}
          <div class="dd-title">${st.title || fallbackTitle(openGroup)}</div>
          <p class=${`dd-story ${book ? "lede" : ""}`}>${paras[0]}</p>
          <button class="dd-rewrite" disabled=${reweaving} onClick=${async () => {
            if (reweaving) return; setReweaving(true);
            storyTried.current.add(openGroup.date + ":" + openGroup.items.length);   // keep the auto-weaver from racing it
            let ok = false;
            try { ok = await weaveStory(openGroup, { fresh: stories[openGroup.date] }); } finally { setReweaving(false); }
            flash(ok ? "Rewritten ✨" : "⚠️ Couldn't rewrite — try again");
          }}>${reweaving ? "rewriting…" : "↻ rewrite"}</button>
          ${(() => { const evs = events.filter((e) => e.starts_on === openGroup.date); return evs.length ? html`<div class="dd-events">
            <span class="dd-ev-label">📌 that day</span>
            ${evs.map((e) => html`<span class="dd-ev" key=${e.id}>${e.emoji || "•"} ${e.title}</span>`)}
          </div>` : ""; })()}
          ${sel && html`<button class=${`dayall ${openGroup.items.every((i) => sel.has(i.id)) ? "on" : ""}`} onClick=${dayToggle(openGroup)}>✓ Select all this day</button>`}
        </div>
        ${book
          ? html`${runs.map((run, i) => html`<div class="booksec" key=${i}>
                ${run.length > 0 && html`<div class="memgrid">${run.map(cell)}</div>`}
                <p class="bookpara">${paras[i + 1]}</p>
              </div>`)}
              <div class="bookend">⁂</div>`
          : html`<div class="memgrid">${openGroup.items.map(cell)}</div>`}
      </div>`; })()}

      ${view === "game" && items !== null && html`<${MatchGame} items=${items} pubUrl=${pubUrl} thumbUrl=${thumbUrl} />`}
    </div>

    ${lightbox !== null && html`<${Lightbox} items=${flat} index=${lightbox} pubUrl=${pubUrl} renderUrl=${renderUrl} origin=${origin.current}
      me=${me} players=${players} com=${lbCom}
      onClose=${() => setLightbox(null)} onNav=${(i) => setLightbox(i)} onOptions=${(it) => setSheet(it)} />`}

    ${sheet && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setSheet(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="asheet-preview">
          <span class="apv-media" style=${!thumbUrl(sheet) && sheet.blur ? `background-image:url(${sheet.blur});background-size:cover;background-position:center` : ""}>
            ${thumbUrl(sheet) && html`<img src=${thumbUrl(sheet)} alt="" crossorigin="anonymous" />`}
            ${sheet.kind === "video" && html`<span class="memplay">🎥</span>`}
          </span>
          <div class="tiny muted" style="margin-top:8px">${dayHead(sheet.taken_on)}${sheet.place ? " · 📍 " + sheet.place : ""}</div>
        </div>
        <button class="btn ghost block mt" onClick=${() => saveItem(sheet)}>📥 Save to device</button>
        <div class="sheetduo mt">
          <button class="btn ghost" onClick=${() => setEditor({ type: "date", ids: [sheet.id] })}>📅 Date</button>
          <button class="btn ghost" onClick=${() => setEditor({ type: "place", ids: [sheet.id] })}>📍 Place</button>
        </div>
        <button class="btn ghost block mt" style="color:var(--bad);border-color:var(--bad)" onClick=${() => deleteItem(sheet)}>🗑 Delete for both</button>
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setSheet(null)}>Cancel</button>
      </div>
    </div>`}

    ${sel && html`<div class="selbar">
      <span class="selcount">${sel.size}</span>
      <button class="selact" disabled=${!sel.size || busy} onClick=${() => setEditor({ type: "date", ids: [...sel] })}>📅</button>
      <button class="selact" disabled=${!sel.size || busy} onClick=${() => setEditor({ type: "place", ids: [...sel] })}>📍</button>
      <button class="selact" disabled=${!sel.size || busy} onClick=${bulkDelete}>🗑</button>
    </div>`}

    ${editor && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setEditor(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="eyebrow" style="margin-bottom:10px">${editor.type === "date" ? "📅 date" : "📍 place"} · ${editor.ids.length} ${editor.ids.length === 1 ? "memory" : "memories"}</div>
        ${editor.type === "date"
          ? html`<input ref=${edInput} type="date" value=${editorDefault()} style="width:100%" />`
          : html`<input ref=${edInput} type="text" value=${editorDefault()} placeholder="City, ST" style="width:100%" />`}
        <button class="btn block mt" disabled=${busy} onClick=${applyEditor}>${busy ? "…" : "Apply"}</button>
        ${editor.type === "place" && html`<button class="btn ghost block mt" disabled=${busy} onClick=${() => applyEditor(true)}>Remove place</button>`}
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setEditor(null)}>Cancel</button>
      </div>
    </div>`}
  </div>`;
}

/* ---- fullscreen lightbox, native-feel ------------------------------------
   - opens by ZOOMING from the tapped thumbnail (transform-origin at the cell)
   - horizontal swipes are finger-attached: prev/current/next ride a track
     that follows the drag, with rubber-band resistance at the ends and a
     spring release that commits or snaps back
   - dragging DOWN scales the media and fades the backdrop under your finger
     (release past the threshold dismisses, otherwise it springs home)      */
function Lightbox({ items, index, pubUrl, renderUrl, me, players = [], com, onClose, onNav, onOptions, origin }) {
  const it = items[index];
  const track = useRef(null);
  const bg = useRef(null);
  const root = useRef(null);
  const drag = useRef(null);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [showCom, setShowCom] = useState(false);     // comments thread open?
  const [draft, setDraft] = useState("");
  const [kbLift, setKbLift] = useState(0);
  const comInput = useRef(null);
  const W = () => window.innerWidth;
  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "?" };
  const c = com || { comments: [], reactions: [], myReaction: null, addComment: () => {}, toggleReaction: () => {} };

  // keep the comment composer above the iOS keyboard
  useEffect(() => {
    if (!showCom || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onVV = () => setKbLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    onVV(); vv.addEventListener("resize", onVV); vv.addEventListener("scroll", onVV);
    return () => { vv.removeEventListener("resize", onVV); vv.removeEventListener("scroll", onVV); setKbLift(0); };
  }, [showCom]);
  useEffect(() => { setShowCom(false); }, [index]);   // close the thread when you swipe to another memory
  const send = () => { const t = draft.trim(); if (!t) return; c.addComment(t); setDraft(""); try { comInput.current && comInput.current.focus(); } catch {} };
  const stop = { onPointerDown: (e) => e.stopPropagation(), onPointerMove: (e) => e.stopPropagation(), onPointerUp: (e) => e.stopPropagation() };

  useEffect(() => { requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true))); }, []);

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 230);
  }, [onClose]);

  // reset the track instantly (no transition) whenever the index settles
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    t.style.transition = "none";
    t.style.transform = `translateX(${-W()}px)`;
  }, [index]);

  const down = (e) => {
    if (e.target.tagName === "VIDEO") return;            // let native controls work
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: null, dx: 0, dy: 0 };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x; d.dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.hypot(d.dx, d.dy) < 8) return;
      d.axis = Math.abs(d.dx) > Math.abs(d.dy) ? "x" : "y";
    }
    if (d.axis === "x") {
      const atStart = index === 0 && d.dx > 0, atEnd = index === items.length - 1 && d.dx < 0;
      const dx = (atStart || atEnd) ? d.dx * 0.32 : d.dx;          // rubber-band at the ends
      track.current.style.transition = "none";
      track.current.style.transform = `translateX(${-W() + dx}px)`;
    } else if (d.dy > 0) {                                          // pull-down to dismiss
      const p = Math.min(1, d.dy / 320);
      track.current.style.transition = "none";
      track.current.style.transform = `translateX(${-W()}px) translateY(${d.dy * 0.82}px) scale(${1 - p * 0.18})`;
      if (bg.current) bg.current.style.opacity = String(1 - p * 0.65);
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.axis) return;
    const vel = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
    const spring = "transform .26s cubic-bezier(.22,.9,.3,1.02)";
    if (d.axis === "x") {
      const go = (Math.abs(d.dx) > 72 || vel > 0.45) ? (d.dx < 0 ? 1 : -1) : 0;
      const n = index + go;
      if (go !== 0 && n >= 0 && n < items.length) {
        track.current.style.transition = spring;
        track.current.style.transform = `translateX(${-W() * (1 + go)}px)`;
        setTimeout(() => onNav(n), 240);
      } else {
        track.current.style.transition = spring;
        track.current.style.transform = `translateX(${-W()}px)`;
      }
    } else {
      if (d.dy > 130) { dismiss(); return; }
      track.current.style.transition = spring;
      track.current.style.transform = `translateX(${-W()}px)`;
      if (bg.current) { bg.current.style.transition = "opacity .25s ease"; bg.current.style.opacity = "1"; }
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "ArrowRight" && index + 1 < items.length) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, dismiss]);

  if (!it) return null;
  // Neighbour panes load only their POSTER/blur — the heavy full image or video
  // streams in only for the pane you're actually on. Full-res images develop in
  // over the blur (no white flash, no layout pop).
  // Only the CURRENT pane streams the heavy media (full image / the video). The
  // two neighbours show a light poster (thumb, or a resized render, or the blur)
  // so swiping never has more than one <video> mounted — and never a multi-MB
  // original just to sit off-screen.
  const pane = (item, current) => {
    if (!item) return html`<div class="lb-pane"></div>`;
    return html`<div class="lb-pane" key=${item.id}>
      ${item.kind === "video"
        ? (current
            ? html`<video src=${pubUrl(item.path)} poster=${item.thumb_path ? pubUrl(item.thumb_path) : undefined} controls playsinline autoplay muted=${false}></video>`
            : html`<span class="lb-frame">
                ${item.blur && html`<span class="lb-blur" style=${`background-image:url(${item.blur})`}></span>`}
                ${item.thumb_path && html`<img src=${pubUrl(item.thumb_path)} alt="" crossorigin="anonymous" />`}
                <span class="lb-play">🎥</span>
              </span>`)
        : html`<span class="lb-frame">
            ${item.blur && html`<span class="lb-blur" style=${`background-image:url(${item.blur})`}></span>`}
            <img src=${current ? pubUrl(item.path) : (item.thumb_path ? pubUrl(item.thumb_path) : renderUrl(item.path, 500))} alt="" crossorigin="anonymous"
              onLoad=${(e) => e.target.classList.add("ld")}
              ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />
          </span>`}
    </div>`;
  };

  const ox = origin ? origin.x : W() / 2;
  const oy = origin ? origin.y : window.innerHeight / 2;
  return html`<div ref=${root} class=${`lightbox lbx ${entered && !closing ? "in" : ""}`}
    style=${`transform-origin:${ox}px ${oy}px`}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    <div ref=${bg} class="lb-bg"></div>
    <button class="lb-close" onClick=${dismiss}>✕</button>
    <button class="lb-opts" onClick=${() => { onClose(); onOptions && onOptions(it); }}>⋯</button>
    <div ref=${track} class="lb-track" style=${`transform:translateX(${-W()}px)`}>
      ${pane(items[index - 1], false)}
      ${pane(it, true)}
      ${pane(items[index + 1], false)}
    </div>

    <!-- reactions + comments (private, just the two of you) -->
    <div class="lb-foot" ...${stop}>
      ${c.reactions.length > 0 && html`<div class="lb-rx">
        ${c.reactions.map((r) => html`<span class="lb-rxchip" key=${r.id} title=${pinfo(r.author_id).name}>${r.emoji}<i>${pinfo(r.author_id).emoji}</i></span>`)}
      </div>`}
      <div class="lb-reactbar">
        ${MEM_REACTS.map((e) => html`<button key=${e} class=${`lb-react ${c.myReaction && c.myReaction.emoji === e ? "on" : ""}`}
          onClick=${() => c.toggleReaction(e)}>${e}</button>`)}
        <button class=${`lb-commentbtn ${showCom ? "on" : ""}`} onClick=${() => setShowCom((v) => !v)}>💬${c.comments.length ? ` ${c.comments.length}` : ""}</button>
      </div>
    </div>
    <div class="lb-meta">${dayHead(it.taken_on)}${it.place ? " · 📍 " + it.place : ""} · ${index + 1} / ${items.length}</div>

    ${showCom && html`<div class="lb-comments" style=${kbLift ? `bottom:${kbLift}px` : ""} ...${stop}>
      <div class="lb-com-head"><span>Comments</span><button class="linkbtn" onClick=${() => setShowCom(false)}>✕</button></div>
      <div class="lb-com-list">
        ${c.comments.length === 0
          ? html`<div class="lb-com-empty">No comments yet — say something 💬</div>`
          : c.comments.map((m) => html`<div class=${`lb-com ${m.author_id === me.id ? "mine" : ""} ${m.pending ? "pending" : ""}`} key=${m.id}>
              ${m.author_id !== me.id && html`<span class="lb-com-who">${m.author_id ? pinfo(m.author_id).emoji : `${m.author_emoji || "👵"} ${m.author_name || "Family"}`}</span>`}
              <span class="lb-com-txt">${m.text}</span>
            </div>`)}
      </div>
      <div class="lb-com-bar">
        <input ref=${comInput} value=${draft} maxlength="500" placeholder="Add a comment…"
          onInput=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") send(); }} />
        <button class="btn sm" disabled=${!draft.trim()} onClick=${send}>Send</button>
      </div>
    </div>`}
  </div>`;
}

/* ---- memory match: find the two photos from the same day ---- */
function MatchGame({ items, pubUrl, thumbUrl }) {
  const buildDeck = useCallback(() => {
    const byDay = {};
    for (const it of items) if (it.kind === "photo") (byDay[it.taken_on] = byDay[it.taken_on] || []).push(it);
    const days = Object.keys(byDay).filter((d) => byDay[d].length >= 2);
    const picked = days.sort(() => Math.random() - 0.5).slice(0, 6);
    const cards = [];
    for (const d of picked) {
      const pool = [...byDay[d]].sort(() => Math.random() - 0.5).slice(0, 2);
      for (const it of pool) cards.push({ key: it.id + "-" + Math.random().toString(36).slice(2, 5), day: d, it });
    }
    return cards.sort(() => Math.random() - 0.5);
  }, [items]);

  const [deck, setDeck] = useState(buildDeck);
  const [open, setOpen] = useState([]);        // up to 2 card keys
  const [matched, setMatched] = useState([]);  // matched days
  const [flips, setFlips] = useState(0);
  const lock = useRef(false);

  const tap = (card) => {
    if (lock.current || open.includes(card.key) || matched.includes(card.day)) return;
    const next = [...open, card.key];
    setOpen(next);
    setFlips((f) => f + 1);
    if (next.length === 2) {
      const [a, b] = next.map((k) => deck.find((c) => c.key === k));
      if (a.day === b.day) {
        lock.current = true;
        setTimeout(() => { setMatched((m) => [...m, a.day]); setOpen([]); lock.current = false;
          try { navigator.vibrate && navigator.vibrate([40, 30, 60]); } catch {} }, 450);
      } else {
        lock.current = true;
        setTimeout(() => { setOpen([]); lock.current = false; }, 950);
      }
    }
  };

  const won = deck.length > 0 && matched.length === deck.length / 2;
  if (deck.length < 4) return html`<div class="empty"><span class="big">🃏</span>Need a few more same-day photos to play.</div>`;

  return html`<div class="match">
    <div class="row between" style="margin:10px 0 12px">
      <span class="eyebrow">Find the same-day pairs</span>
      <span class="tiny muted tnum">${flips} flips</span>
    </div>
    <div class="matchgrid">
      ${deck.map((c) => {
        const faceUp = open.includes(c.key) || matched.includes(c.day);
        const done = matched.includes(c.day);
        return html`<button class=${`mcard ${faceUp ? "up" : ""} ${done ? "done" : ""}`} key=${c.key} onClick=${() => tap(c)}>
          <div class="mcard-inner">
            <div class="mcard-back">🍑🧸</div>
            <div class="mcard-face"><img src=${thumbUrl(c.it)} loading="lazy" decoding="async" alt="" crossorigin="anonymous" /></div>
          </div>
        </button>`;
      })}
    </div>
    ${won && html`<div class="center" style="padding:16px 0 4px">
      <div class="gamehero-title" style="font-size:22px">Matched in ${flips} flips 💗</div>
      <button class="btn mt" onClick=${() => { setDeck(buildDeck()); setOpen([]); setMatched([]); setFlips(0); }}>Play again</button>
    </div>`}
  </div>`;
}
