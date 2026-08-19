// Client-side helpers for "Your turn" push alerts.
//
// Each phone subscribes via the browser's PushManager and we store the
// subscription in `push_subscriptions` keyed to the player. Sending happens in
// the `notify-turn` Supabase Edge Function (see supabase/functions/), which
// signs messages with the VAPID private key (kept as a function secret).

// Public half of the VAPID pair — safe to ship in the client. The private half
// lives ONLY as an Edge Function secret (per project). Each couple's backend has
// its OWN VAPID pair, so we pick the public key by the connected project ref.
const VAPID_KEYS = {
  default:                "BGqzDqmIYJlLXRc3NkUZXwfC2995uEgymoJwZUZnBbe3r73nBY8L01w9UI8FTNICdq4vT8Znipm_LttH8tZD-FM", // Peaches & Pelucha
  tglwpgktertvyumhhkal:   "BM41zNFmQHzswaepzUMVWHLaJeMrp2s0NP9GVc6lwEL6WBE6tckb2QeBEMRPrIAij8VtszSzIXa5rReWJHt2r20", // Mayo & Briuna
  hodyxntdqtpsuppkbcra:   "BNKEzm8ybUyZ3vueHwCdhlT8lOeEVJARGXp5z5Up9A8lTb_O6_E7PCC5Gd46uoJNBsvqtJCxlQencR_BbFLXHG4", // Peaches & Pelucha — owned project (new pair, 2026-08-19)
};

// A subscription made under a different VAPID key (e.g. the pre-migration
// project's) can't be signed by the current server — detect + replace it.
function subMatchesKey(sub, publicKey) {
  try {
    const k = sub.options && sub.options.applicationServerKey;
    if (!k) return true;                                   // unknown → assume fine
    const cur = keyBytes(publicKey);
    const have = new Uint8Array(k);
    if (have.length !== cur.length) return false;
    for (let i = 0; i < cur.length; i++) if (have[i] !== cur[i]) return false;
    return true;
  } catch { return true; }
}
// Resolved at call time (not import time) — window.PP_CREDS is set once the
// client connects, so this reflects whichever couple's backend is active.
function vapidPublicKey() {
  try {
    const url = (typeof window !== "undefined" && window.PP_CREDS && window.PP_CREDS.url) || "";
    const ref = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
    if (ref && VAPID_KEYS[ref]) return VAPID_KEYS[ref];
  } catch {}
  return VAPID_KEYS.default;
}

function keyBytes(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// 'unsupported' | 'denied' | 'enabled' | 'off'
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "unsupported"; // SW not registered (e.g. localhost dev)
  const sub = await reg.pushManager.getSubscription();
  return sub ? "enabled" : "off";
}

export async function enablePush(client, playerId) {
  if (!pushSupported()) throw new Error("This browser can't do notifications. On iPhone, use the installed home-screen app (iOS 16.4+).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications not allowed. Enable them for this app in Settings.");
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Open the installed app (not a localhost preview) to enable alerts.");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(vapidPublicKey()),
  });
  const j = sub.toJSON();
  const { error } = await client.from("push_subscriptions").upsert(
    { player_id: playerId, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) throw new Error(error.message);
}

// Self-heal: iOS (especially) silently expires web-push subscriptions. Called
// on every app open — if permission is granted but the subscription vanished,
// quietly re-subscribe; either way refresh the row so the binding stays fresh.
export async function ensurePush(client, playerId) {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !subMatchesKey(sub, vapidPublicKey())) { try { await sub.unsubscribe(); } catch {} sub = null; }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(vapidPublicKey()),
      });
    }
    const j = sub.toJSON();
    await client.from("push_subscriptions").upsert(
      { player_id: playerId, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" }
    );
  } catch {}
}

export async function disablePush(client) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}

// Fire-and-forget: nudge `playerId`'s phones. Never blocks or breaks gameplay.
export function notifyTurn(client, playerId, title, body) {
  try {
    if (!client.functions || !client.functions.invoke) return;
    client.functions
      .invoke("notify-turn", { body: { player_id: playerId, title, body } })
      .catch(() => {});
  } catch {}
}
