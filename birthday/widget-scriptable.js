// Peaches birthday countdown — a native iOS home-screen widget via the
// Scriptable app (free, App Store). Paste this into a new Scriptable script,
// then add a small Scriptable widget to the home screen and point it here.
// Before midnight: "no peeking 😛" + countdown. After: happy birthday.
// Tapping the widget opens her birthday app.

const BDAY = new Date("2026-07-11T00:00:00");
const APP_URL = "https://codewontchange-nyc.github.io/peaches-pelucha/birthday/";

const w = new ListWidget();
w.url = APP_URL;

const grad = new LinearGradient();
grad.colors = [new Color("#ffb0be"), new Color("#ff7a91")];
grad.locations = [0, 1];
w.backgroundGradient = grad;

const now = new Date();
const ms = BDAY - now;

w.addSpacer();

if (ms > 0) {
  const peek = w.addText("no peeking 😛");
  peek.font = Font.boldSystemFont(15);
  peek.textColor = Color.white();
  peek.centerAlignText();

  w.addSpacer(8);

  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  const count = w.addText(h > 0 ? `${h}h ${m}m` : `${m}m`);
  count.font = Font.boldRoundedSystemFont(34);
  count.textColor = Color.white();
  count.centerAlignText();

  w.addSpacer(6);

  const sub = w.addText("until your birthday 🎂");
  sub.font = Font.mediumSystemFont(11);
  sub.textColor = new Color("#ffffff", 0.9);
  sub.centerAlignText();

  // ask iOS to re-render soon (it batches; expect ~5–15 min cadence)
  w.refreshAfterDate = new Date(now.getTime() + 5 * 60 * 1000);
} else {
  const cake = w.addText("🍑🎂");
  cake.font = Font.systemFont(30);
  cake.centerAlignText();

  w.addSpacer(8);

  const big = w.addText("happy birthday");
  big.font = Font.boldSystemFont(16);
  big.textColor = Color.white();
  big.centerAlignText();

  const name = w.addText("my Peaches 💗");
  name.font = Font.mediumSystemFont(13);
  name.textColor = new Color("#ffffff", 0.92);
  name.centerAlignText();
}

w.addSpacer();

Script.setWidget(w);
Script.complete();
if (config.runsInApp) await w.presentSmall();
