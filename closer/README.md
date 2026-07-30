# Closer

A quiet referee for hard conversations. The phone goes face-up between two
people; Closer listens, shows each person how they're coming across in real
time, and afterwards gives both a debrief with the emotion taken out.

Standalone PWA at `/closer/` — its own manifest, icons, and service worker
(`closer-vN` cache, scope `./`), independent of the main P&P app. Not linked
from the app.

## How it works

- **Consent gate:** both people tap their half before the mic opens.
- **Instant layer (no APIs):** Web Audio RMS drives the arc pulse and the
  timeline squiggle; a screen Wake Lock keeps iOS from killing the mic.
- **Language layer (~25 s lag):** MediaRecorder cycles every 25 s (stop/restart
  — iOS mp4 slices aren't standalone files); silent chunks are skipped. Each
  chunk → ElevenLabs Scribe (`diarize=true`) → Claude (Haiku by default) which
  attributes turns (diarization ids are chunk-local!) and returns states,
  temperature, triggers, and moments via forced tool-use.
- **End:** last chunks drain, then Claude (Sonnet by default) writes the recap:
  summary, dynamic, turning points, per-person strengths/patterns, repair
  attempts, takeaways.
- **Storage:** sessions live in IndexedDB on the device — nothing is synced.
  Keys are BYO (ElevenLabs + Anthropic), kept in localStorage like MedScribe.

## Dev

`?demo=1` runs a scripted live session + a seeded past conversation with no
mic and no keys (uses a separate `closer-demo` IndexedDB). Use the repo
devserver (`tools/devserver.py`, port 4174) — SW registration is skipped on
localhost.

Deploying: push to main like everything else. Bump `closer-vN` in `sw.js` for
user-facing changes (network-first makes this mostly a safety net).
