# CLAUDE.md — Peaches & Pelucha

A private two-person PWA for Cam ("Pelucha" 🧸) and his girlfriend ("Peaches" 🍑):
a fully playable, realtime-synced **Phase 10 card game**, a **hearts 💗
relationship currency** (earn/gift/bet/cash-out), a **Date Night Roulette**, and
a **Love Bug Calendar** (invites/FYIs + push notifications). Login is just
tapping your player — no auth, by design. Two expert users; keep UX minimal.

Live at: https://codewontchange-nyc.github.io/peaches-pelucha/

## Architecture (the rules that matter)

- **No build step. Ever.** Plain static files; Preact + htm + @supabase/supabase-js
  load from esm.sh at runtime. No node_modules, no bundler, no TypeScript.
- **Backend is Supabase** (project ref `hodyxntdqtpsuppkbcra`): Postgres + RLS
  open to the publishable key (intentional — private 2-person app), realtime on
  all tables, one Edge Function (`notify-turn`) for Web Push.
- **This repo is PUBLIC.** Never commit secrets. `config.js` is blank on
  purpose — the deploy workflow writes it from repo secrets
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- **Hosting/deploys:** GitHub Pages via `.github/workflows/deploy.yml`. Every
  push to `main` auto-deploys.

## File map

| File | What |
|---|---|
| `app.js` | App shell: tabs (Score/Plans/Wallet/Bets/Shop/More), wallet/bets/shop UI, modals |
| `engine.js` | Pure Phase 10 rules: 108-card deck, 10 phases, validation, hitting, scoring, skip logic. No I/O |
| `game.js` | Game board UI: full-screen play, fanned draggable hand, lay-down, drag-to-pile/discard, slam FX, mutual end-match |
| `roulette.js` | Date Night Roulette (date_ideas / date_spins) |
| `events.js` | Love Bug Calendar (events: invite/FYI + RSVP) |
| `push.js` | Web Push client: VAPID public key, enable/disable/ensurePush, generic `notifyTurn(client, playerId, title, body)` |
| `sw.js` | Service worker: shell cache `pp-vN` + push display handlers |
| `demo-client.js` | In-memory Supabase stand-in for `?demo=1` (keep its DEFAULTS in sync with schema column defaults) |
| `schema.sql` | Full schema for fresh installs; `migrations/NNN_*.sql` = incremental changes (keep both in sync) |
| `supabase/functions/notify-turn/` | Edge Function source (deployed via dashboard paste only) |
| `tools/devserver.py` | No-cache local server on :4174 (`.claude/launch.json` uses it) |

## Game state model

The whole live match is ONE row in `matches` (`state` jsonb + `version` int).
Moves: pure engine function → new state → optimistic UPDATE guarded by
`.eq("version", n)`; on conflict, reload. Both phones subscribe via realtime.
Hand scores/phases derive from state; lifetime wins live in `games`; hearts
balances are `SUM(transactions.amount)` — never denormalize.

## Conventions

- **Design system:** warm editorial — Fraunces (serif display) + Inter, paper
  `#faf5ef`, ink `#2b2521`, one terracotta accent `#c15f3c`, hairlines over
  boxes, minimal text (no instructional sentences — expert users), emoji as
  accents. Muted card colors; tabular numerals for scores.
- **Interactions are drag-first** on the board: drag a card onto a pile to play
  it, onto the discard pile to end the turn; tap = select + one contextual pill.
  **Never disclose move legality before commitment** (Peaches's house rule:
  validity glows are hints). Zones give neutral hover feedback only; an illegal
  placement gets a `.nope` shake and the card glides home.
- **Deploy ritual:** bump `pp-vN` in `sw.js` for ANY user-facing change →
  commit → push → wait for the Actions run → verify
  `curl https://codewontchange-nyc.github.io/peaches-pelucha/sw.js | grep pp-v`.
  The bump is REQUIRED: clients poll sw.js for the `pp-vN` beacon (on wake +
  every 5 min) and **self-update** — silent reload at the wake moment, or an
  "✨ Update ready" banner mid-session. No more force-closing.
- **Verify before shipping:** run `tools/devserver.py`, open
  `http://localhost:4174/?demo=1`, exercise the change, check the console for
  errors. The demo client (`window.__ppDemo`) lets tests craft game states.
- **Migrations:** write `migrations/NNN_name.sql` AND mirror into `schema.sql`.
  Apply via Supabase dashboard SQL Editor — or ask Cam, whose local setup can
  run them via the Management API.

## Push pipeline

Client subscribes (`push.js`, VAPID public key inline) → rows in
`push_subscriptions` → Edge Function `notify-turn` signs + sends (VAPID private
key is a function secret; **Verify JWT is OFF** because `sb_publishable_*` keys
aren't JWTs). `ensurePush()` self-heals expired subscriptions on every app
open. A pg_cron job (`lovebug-daily-digest`, 13:00 UTC ≈ 9am ET) pushes a
"📅 Today" digest of calendar events.

## Gotchas (learned the hard way)

- **iOS suppresses push banners while the PWA is foregrounded** — a "missing"
  iOS notification usually means the app was open. iOS also needs the
  home-screen-installed app (16.4+), never a Safari tab.
- **Edge Function display name ≠ URL slug.** `functions.invoke("name")` hits
  the slug; check the function's URL in the dashboard.
- **GitHub Pages deploys occasionally 401** server-side; the workflow already
  retries once. If a run still fails, re-run jobs or push again.
- **Browser/SW caching masks changes locally** — the SW intentionally skips
  localhost; use the no-cache devserver, not `python -m http.server`.
- **pg_cron is UTC-fixed** (no DST): the digest drifts to 8am ET in winter.
- Engine quirk fixed but worth knowing: going out by *hitting* the last card
  (not discarding) ends the hand — `engine.js hit()` handles it.
- **Touch drags must assume the release event may never arrive** (iOS kills
  gestures for notifications/system swipes). game.js uses a GHOST clone (the
  real card never gets inline transforms), window-level listeners, a 1.6s
  event-silence watchdog, and a self-expiring `__ppDragging` sync guard. Never
  gate sync on a flag that only a pointerup can clear — that deadlocked the
  whole board until refresh.
- **Never nest a card (or any element) as a button inside another control.**
  A disabled inner button swallows the tap on iOS/Android — this broke picking
  up from the discard pile. Static card faces must be inert divs, and
  `.pile .pcard, .meld .pcard { pointer-events: none; }` keeps taps passing
  through to the real control. Verify taps with elementFromPoint at the
  element's visual center, not `.click()` on the outer node.

## Don'ts

- Don't add a build step, framework, or npm dependency.
- Don't commit any token/key except the VAPID *public* key.
- Don't auto-sort the player's hand (order is theirs; Sort/Shuffle were
  deliberately removed for a fan/row view toggle).
- Don't add instructional UI text — the design language is badges, glows, and
  one contextual pill.
