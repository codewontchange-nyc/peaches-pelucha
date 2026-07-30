import { h, render } from 'https://esm.sh/preact@10.23.2';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.23.2/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

/* ------------------------------------------------------------------ *
 * Closer — a quiet referee for hard conversations.
 * Phone goes face-up between two people. One mic, two voices.
 * Audio → ElevenLabs Scribe (diarized) → Claude (live read + recap).
 * Everything stays on this device; keys are yours (BYO, localStorage).
 * ------------------------------------------------------------------ */

const LS = 'closer.settings.v1';
const loadSettings = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const saveSettings = (s) => localStorage.setItem(LS, JSON.stringify(s));

const DEMO = new URLSearchParams(location.search).has('demo');
const CHUNK_SECS = 25;           // recorder cycle length
const SPEECH_RMS = 0.015;        // below this peak, a chunk is silence — skip the API

const LIVE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest (recommended live)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — sharper, slower' },
];
const RECAP_MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced (recommended)' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — deepest read' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — quick + cheap' },
];

/* ---------------- little utils ---------------- */
const fmtClock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtDur = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} min ${r} sec` : `${r} sec`;
};
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDateTime = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
  ' · ' + new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function pickRecordingType() {
  const cands = [
    ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'],
    ['audio/mp4;codecs=mp4a.40.2', 'm4a'], ['audio/mp4', 'm4a'],
    ['audio/aac', 'aac'], ['audio/ogg;codecs=opus', 'ogg'],
  ];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return { mime: '', ext: 'webm' };
  for (const [mime, ext] of cands) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: '', ext: 'webm' };
}

/* ---------------- sessions live in IndexedDB, on this device only ---------------- */
const DB_NAME = DEMO ? 'closer-demo' : 'closer';
function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('sessions', { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const idbAll = async () => {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('sessions').objectStore('sessions').getAll();
    r.onsuccess = () => res((r.result || []).sort((a, b) => b.startedAt - a.startedAt));
    r.onerror = () => rej(r.error);
  });
};
const idbPut = async (s) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(s);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
};
const idbDel = async (id) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
};

/* ---------------- ElevenLabs Scribe — diarized speech-to-text ---------------- */
async function transcribeChunk({ blob, ext, apiKey }) {
  const fd = new FormData();
  fd.append('model_id', 'scribe_v2');
  fd.append('file', blob, `chunk.${ext}`);
  fd.append('diarize', 'true');
  fd.append('timestamps_granularity', 'word');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': apiKey }, body: fd,
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.detail?.message || ''; } catch {}
    throw new Error(`ElevenLabs ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  // fold the word stream into speaker turns (ids are chunk-local!)
  const turns = [];
  let cur = null;
  for (const w of data.words || []) {
    if (w.type && w.type !== 'word' && w.type !== 'spacing') continue;
    const sp = w.speaker_id || 'speaker_0';
    if (!cur || cur.speaker !== sp) { cur = { speaker: sp, start: w.start || 0, text: '' }; turns.push(cur); }
    cur.text += (w.text || '');
  }
  return turns.map(t => ({ ...t, text: t.text.replace(/\s+/g, ' ').trim() })).filter(t => t.text);
}

/* ---------------- Claude core ---------------- */
async function claudeCall({ apiKey, model, system, tool, messages, maxTokens = 4096 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name },
      messages,
    }),
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Claude ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block?.input) throw new Error('Claude returned no structured output.');
  return block.input;
}

/* ---------------- live read: attribute new turns + read the room ---------------- */
const LIVE_TOOL = {
  name: 'report_live_read',
  description: 'Attribute the new turns to the two people and report the current emotional read of the conversation.',
  input_schema: {
    type: 'object',
    properties: {
      labeled_turns: {
        type: 'array',
        description: 'Every NEW turn, in the exact order given, each attributed to you or them.',
        items: {
          type: 'object',
          properties: { speaker: { type: 'string', enum: ['you', 'them'] }, text: { type: 'string' } },
          required: ['speaker', 'text'],
        },
      },
      you_state: { type: 'string', description: "You's current state — 1-3 lowercase words, honest and specific (e.g. 'quietly listening', 'getting defensive', 'softening')." },
      them_state: { type: 'string', description: "Them's current state, same style." },
      temperature: { type: 'number', description: 'Conversation heat right now: 0 = calm and warm, 50 = tense, 100 = boiling over.' },
      trigger: {
        type: 'object',
        description: 'ONLY if a specific statement in the new turns visibly shifted the other person. Quote it near-verbatim (trim to ≤14 words). Omit entirely otherwise — most chunks have none.',
        properties: { speaker: { type: 'string', enum: ['you', 'them'] }, quote: { type: 'string' } },
        required: ['speaker', 'quote'],
      },
      new_moment: { type: 'string', description: "2-4 word label ONLY if the conversation just entered a genuinely new beat (e.g. 'the money issue', 'repair attempt', 'common ground'). Expect one every few minutes at most; omit otherwise." },
    },
    required: ['labeled_turns', 'you_state', 'them_state', 'temperature'],
  },
};

const SYSTEM_LIVE = `You are the live engine inside Closer, an app a couple places face-up between them during a difficult conversation. One phone, one microphone, two people: "you" (the person on the blue bottom half, who owns the phone and was asked to say the first words of the session) and "them" (the red top half).

You receive the conversation so far (already attributed) plus newly transcribed turns. The new turns carry diarization ids like A/B that are ARBITRARY AND CHUNK-LOCAL — A in this chunk is not necessarily A from any earlier chunk. Attribute each new turn to "you" or "them" using conversational continuity: who said what before, who is being addressed, self-references, topic ownership. At the very start of the session, the first voice is "you". If a turn genuinely blends both voices, attribute it to the more likely speaker rather than skipping it.

Reading the room:
- States are honest, specific, lowercase, 1-3 words. Never clinical jargon, never flattery. "getting upset", "quietly listening", "stonewalling", "reaching out".
- Temperature is the heat of the exchange, not the topic's seriousness.
- Triggers and moments are rare by design; when unsure, omit them.
- You observe. You never advise, judge, or take sides.`;

function turnsBlock(turns) {
  return turns.map(t => `[${fmtClock(t.t)}] ${t.speaker}: ${t.text}`).join('\n');
}

async function analyzeLive({ apiKey, model, labeledSoFar, newTurns, elapsed }) {
  const seen = {};
  const anon = newTurns.map(t => {
    if (!seen[t.speaker]) seen[t.speaker] = String.fromCharCode(64 + Object.keys(seen).length + 1); // A, B, …
    return `[${fmtClock(t.t)}] ${seen[t.speaker]}: ${t.text}`;
  }).join('\n');
  const prompt = `Elapsed: ${fmtClock(elapsed)}.

Conversation so far (attributed):
${labeledSoFar.length ? turnsBlock(labeledSoFar) : '(session just started — the first voice is "you")'}

New turns to attribute and read (ids are arbitrary this chunk):
${anon}`;
  return claudeCall({
    apiKey, model, system: SYSTEM_LIVE, tool: LIVE_TOOL, maxTokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
}

/* ---------------- recap: the honest debrief ---------------- */
const PERSON_SHAPE = {
  type: 'object',
  properties: {
    showed_up_as: { type: 'string', description: 'How this person showed up, one honest phrase.' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'What they did well in THIS conversation, specific.' },
    patterns: { type: 'array', items: { type: 'string' }, description: 'Habits that showed up (interrupting, absolutes, mind-reading, withdrawing…). Neutral, evidence-based.' },
    try_next_time: { type: 'array', items: { type: 'string' }, description: 'Curated, concrete experiments for next time. 1-3 items.' },
  },
  required: ['showed_up_as', 'strengths', 'patterns', 'try_next_time'],
};

const RECAP_TOOL = {
  name: 'record_session_recap',
  description: 'Record the structured debrief of the conversation.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain lowercase name for this conversation, 2-5 words (e.g. "the vacation budget").' },
      summary: { type: 'string', description: 'What actually happened, stripped of emotion — the account both people would agree is fair. 3-6 sentences.' },
      dynamic: { type: 'string', description: 'The real dynamic underneath: who pursued, who withdrew, what the fight was actually about. 2-4 sentences, even-handed.' },
      turning_points: {
        type: 'array',
        description: 'The 2-5 statements that changed the conversation\'s direction, quoted near-verbatim.',
        items: {
          type: 'object',
          properties: {
            speaker: { type: 'string', enum: ['you', 'them'] },
            quote: { type: 'string' },
            effect: { type: 'string', description: 'What it did to the conversation, briefly.' },
          },
          required: ['speaker', 'quote', 'effect'],
        },
      },
      you: PERSON_SHAPE,
      them: PERSON_SHAPE,
      repair_attempts: {
        type: 'array',
        description: 'Moments someone reached toward the other (apology, humor, touchpoint, concession) — and whether it landed.',
        items: {
          type: 'object',
          properties: { speaker: { type: 'string', enum: ['you', 'them'] }, description: { type: 'string' }, landed: { type: 'boolean' } },
          required: ['speaker', 'description', 'landed'],
        },
      },
      unresolved: { type: 'array', items: { type: 'string' }, description: 'What was raised but never settled. Empty if everything closed.' },
      takeaways: {
        type: 'array',
        description: '2-4 curated takeaways, the things worth remembering from this specific conversation.',
        items: {
          type: 'object',
          properties: { for: { type: 'string', enum: ['you', 'them', 'both'] }, text: { type: 'string' } },
          required: ['for', 'text'],
        },
      },
      closing_note: { type: 'string', description: 'One warm, honest line to end on. Never saccharine.' },
    },
    required: ['title', 'summary', 'dynamic', 'turning_points', 'you', 'them', 'repair_attempts', 'unresolved', 'takeaways', 'closing_note'],
  },
};

const SYSTEM_RECAP = `You are the debrief engine inside Closer. Two people just finished a difficult conversation with the app listening between them ("you" = blue/bottom, owns the phone; "them" = red/top). You watched the whole thing. Now give them the recap a wise, neutral third party would give — the version of events with the emotion taken out, so they can see the real dynamic.

Rules:
- Base everything ONLY on the transcript. Quote near-verbatim. Specific beats general, always.
- Be even-handed. If one person carried more of the problem, say so plainly — but find what each did well.
- No therapy clichés ("hold space", "validate feelings", "communication styles"). Plain language.
- If the conversation was actually calm or kind, say that — do not invent conflict.
- You are a mirror, not a judge, and not a licensed therapist.`;

async function makeRecap({ apiKey, model, turns, moments, duration }) {
  const momentsLine = moments.length ? `\nMoments the live engine flagged: ${moments.map(m => `${m.label} (${fmtClock(m.t)})`).join(', ')}.` : '';
  const prompt = `The conversation lasted ${fmtDur(duration)}.${momentsLine}

Full transcript:
${turnsBlock(turns)}`;
  return claudeCall({
    apiKey, model, system: SYSTEM_RECAP, tool: RECAP_TOOL, maxTokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });
}

const talkBalance = (turns) => {
  let you = 0, them = 0;
  for (const t of turns) {
    const w = t.text.split(/\s+/).length;
    if (t.speaker === 'you') you += w; else them += w;
  }
  return { you, them };
};

/* ---------------- demo data (?demo=1 — no mic, no keys) ---------------- */
const DEMO_RECAP = {
  title: 'the sunday plans fight',
  summary: 'You raised feeling left out of weekend plans made with friends. Them explained the plans came together last-minute in a group chat. The conversation escalated when the word "always" entered, then recovered after Them acknowledged the pattern and You admitted the real issue was wanting to be asked, not wanting to veto. You both agreed on a check-in before committing weekends.',
  dynamic: 'You pursued the issue; Them initially defended with logistics instead of hearing the feeling underneath. The fight was never about Sunday — it was about being considered. Once that surfaced, the temperature dropped fast.',
  turning_points: [
    { speaker: 'you', quote: 'you always decide and I find out after', effect: 'Turned a logistics talk into a character claim — Them went defensive.' },
    { speaker: 'them', quote: "okay. you're right that I didn't think to ask", effect: 'First real acknowledgment — the turning point back toward each other.' },
    { speaker: 'you', quote: "I don't want a veto, I want a text", effect: 'Named the actual need. Everything after this was solution-finding.' },
  ],
  you: {
    showed_up_as: 'hurt but willing to name it',
    strengths: ['Named the real need instead of litigating the example', 'Accepted the repair when it came instead of extending the fight'],
    patterns: ['Reached for "always" when the feeling peaked', 'Opened with the accusation instead of the feeling'],
    try_next_time: ['Lead with "I felt left out" — you got there eventually and it worked instantly'],
  },
  them: {
    showed_up_as: 'defensive first, generous second',
    strengths: ['Gave a clean acknowledgment without a "but"', 'Proposed the fix (the check-in text) unprompted'],
    patterns: ['Answered feelings with logistics for the first third', 'Voice rose to match volume rather than de-escalating'],
    try_next_time: ['When accused, try naming the feeling you heard before correcting the facts'],
  },
  repair_attempts: [
    { speaker: 'them', description: 'A joke about the group chat being a "hostage situation" — mistimed', landed: false },
    { speaker: 'them', description: 'Direct acknowledgment: "I didn\'t think to ask"', landed: true },
  ],
  unresolved: ['Whether standing Sunday plans with friends continue as-is'],
  takeaways: [
    { for: 'both', text: 'The fight de-escalated the moment the need was named — a 15-second sentence ended 8 minutes of circling.' },
    { for: 'you', text: '"Always" cost you the high ground twice.' },
    { for: 'them', text: 'Logistics answers landed as dismissal, even though they were true.' },
  ],
  closing_note: 'You found the actual issue in under fifteen minutes. Most people never do.',
};

const demoSession = () => {
  const tempSeries = [8, 12, 15, 22, 30, 42, 58, 71, 68, 74, 66, 52, 38, 30, 24, 18].map((v, i) => ({ t: i * 55, v }));
  return {
    id: 'demo-1',
    startedAt: Date.now() - 1000 * 60 * 60 * 26,
    duration: 14 * 60 + 43,
    turns: [
      { t: 2, speaker: 'you', text: 'Can we talk about Sunday? I saw the plans in the group chat.' },
      { t: 9, speaker: 'them', text: 'It literally came together an hour before, it was not some scheme.' },
      { t: 21, speaker: 'you', text: 'You always decide and I find out after.' },
      { t: 27, speaker: 'them', text: 'Always? One brunch is always now?' },
      { t: 190, speaker: 'them', text: "Okay. You're right that I didn't think to ask." },
      { t: 205, speaker: 'you', text: "I don't want a veto, I want a text." },
      { t: 460, speaker: 'them', text: 'Check-in before either of us commits a weekend. Deal.' },
    ],
    moments: [
      { t: 20, label: 'the flashpoint' }, { t: 185, label: 'repair attempt' },
      { t: 200, label: 'the real need' }, { t: 455, label: 'common ground' },
    ],
    tempSeries,
    talk: { you: 610, them: 540 },
    recap: DEMO_RECAP,
  };
};

const DEMO_SCRIPT = [
  { at: 3, you: 'settling in', them: 'guarded', temp: 18 },
  { at: 7, moment: 'opening up' },
  { at: 10, you: 'explaining', them: 'listening', temp: 28 },
  { at: 14, trigger: { speaker: 'you', quote: 'you always decide and I find out after' }, you: 'frustrated', them: 'getting upset', temp: 66, moment: 'the flashpoint' },
  { at: 20, you: 'quietly listening', them: 'venting', temp: 74 },
  { at: 26, moment: 'repair attempt', you: 'reaching out', them: 'softening', temp: 46 },
  { at: 32, you: 'warm', them: 'open', temp: 24, moment: 'common ground' },
];

/* ================================================================== *
 * UI
 * ================================================================== */

function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [view, setView] = useState('menu');           // menu | live
  const [sessions, setSessions] = useState([]);
  const [openSession, setOpenSession] = useState(null); // recap overlay
  const [showSettings, setShowSettings] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    try {
      let list = await idbAll();
      if (DEMO && !list.some(s => s.id === 'demo-1')) {
        const d = demoSession(); await idbPut(d); list = await idbAll();
      }
      setSessions(list);
    } catch { /* private mode etc — list stays empty */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(''), 4000);
    return () => clearTimeout(id);
  }, [note]);

  const keysReady = DEMO || (settings.elevenKey && settings.anthropicKey);

  const onSessionDone = async (session, message) => {
    if (session) {
      await idbPut(session).catch(() => {});
      await refresh();
      setOpenSession(session);
    }
    if (message) setNote(message);
    setView('menu');
  };

  const startSession = () => {
    if (!keysReady) { setShowSettings(true); return; }
    setView('live');
  };

  const deleteSession = async (id) => {
    await idbDel(id).catch(() => {});
    setOpenSession(null);
    refresh();
  };

  const retryRecap = async (session) => {
    const recap = await makeRecap({
      apiKey: settings.anthropicKey, model: settings.recapModel || 'claude-sonnet-5',
      turns: session.turns, moments: session.moments || [], duration: session.duration,
    });
    const updated = { ...session, recap };
    await idbPut(updated); await refresh();
    setOpenSession(updated);
  };

  return html`
    ${view === 'menu' && html`
      <${Menu}
        sessions=${sessions} note=${note} keysReady=${keysReady}
        onStart=${startSession} onOpen=${setOpenSession} onSettings=${() => setShowSettings(true)} />`}
    ${view === 'live' && html`
      <${Live} settings=${settings} onDone=${onSessionDone} />`}
    ${openSession && html`
      <${Recap} session=${openSession} onClose=${() => setOpenSession(null)}
        onDelete=${deleteSession} onRetry=${retryRecap} />`}
    ${showSettings && html`
      <${Settings} settings=${settings} onClose=${() => setShowSettings(false)}
        onSave=${(s) => { setSettings(s); saveSettings(s); }} />`}
  `;
}

/* ---------------- menu ---------------- */
function Spark({ series }) {
  if (!series || series.length < 2) return null;
  const max = Math.max(100, ...series.map(p => p.v));
  const pts = series.map((p, i) => `${(i / (series.length - 1)) * 60},${18 - (p.v / max) * 16}`).join(' ');
  return html`<svg class="spark" viewBox="0 0 60 20" preserveAspectRatio="none">
    <polyline points=${pts} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

function Menu({ sessions, note, keysReady, onStart, onOpen, onSettings }) {
  return html`
    <div class="menu">
      <header class="menu-top">
        <h1>Closer</h1>
        <button class="iconbtn" aria-label="Settings" onClick=${onSettings}>⚙</button>
      </header>

      <div class="menu-hero">
        <button class="startbtn" onClick=${onStart}>
          <span class="startdot them-dot"></span><span class="startdot you-dot"></span>
          Start a conversation
        </button>
        ${!keysReady && html`<div class="hint-line">add your API keys first (⚙)</div>`}
      </div>

      ${note && html`<div class="note-banner">${note}</div>`}

      <div class="past">
        ${sessions.length === 0
          ? html`<div class="empty-line">Conversations you have here stay here — on this phone only.</div>`
          : html`
            <div class="past-head">Past conversations</div>
            ${sessions.map(s => html`
              <button class="sessrow" onClick=${() => onOpen(s)}>
                <div class="sessmain">
                  <div class="sesstitle">${s.recap?.title || 'conversation'}</div>
                  <div class="sessmeta">${fmtDate(s.startedAt)} · ${fmtDur(s.duration)}${s.recap ? '' : ' · not yet analyzed'}</div>
                </div>
                <${Spark} series=${s.tempSeries} />
              </button>`)}
          `}
      </div>

      <div class="footnote">Closer is a mirror, not a therapist. Audio is processed by ElevenLabs + Anthropic with both people's consent.</div>
    </div>
  `;
}

/* ---------------- live session ---------------- */
function Live({ settings, onDone }) {
  const [stage, setStage] = useState('consent');  // consent | live | ending
  const [armed, setArmed] = useState({ you: false, them: false });
  const [elapsed, setElapsed] = useState(0);
  const [youState, setYouState] = useState('');
  const [themState, setThemState] = useState('');
  const [temp, setTemp] = useState(10);
  const [trigger, setTrigger] = useState(null);
  const [moments, setMoments] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [endArmed, setEndArmed] = useState(false);
  const [toast, setToast] = useState('');

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunkTimerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const elapsedRef = useRef(0);
  const timerRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const labeledRef = useRef([]);
  const pendingRawRef = useRef([]);
  const tempSeriesRef = useRef([]);
  const chunkPeakRef = useRef(0);
  const volSamplesRef = useRef([]);
  const wakeLockRef = useRef(null);
  const startedAtRef = useRef(0);
  const demoRef = useRef({ idx: 0, raf: 0 });

  useEffect(() => () => cleanup(), []); // unmount safety net

  useEffect(() => {
    if (armed.you && armed.them && stage === 'consent') begin();
  }, [armed, stage]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  function cleanup() {
    runningRef.current = false;
    clearInterval(timerRef.current);
    clearTimeout(chunkTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (demoRef.current.raf) cancelAnimationFrame(demoRef.current.raf);
    try { recRef.current?.state !== 'inactive' && recRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    try { audioCtxRef.current?.close(); } catch {}
    wakeLockRef.current?.release?.().catch(() => {});
    document.removeEventListener('visibilitychange', onVisible);
  }

  async function grabWakeLock() {
    try { wakeLockRef.current = await navigator.wakeLock?.request('screen'); } catch { /* best effort */ }
  }
  function onVisible() {
    if (document.visibilityState === 'visible' && runningRef.current) grabWakeLock();
  }

  /* --- volume meter + squiggle, shared rAF --- */
  function startMeter(stream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC(); ctx.resume?.();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioCtxRef.current = ctx;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      feedVolume(rms);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function feedVolume(rms) {
    chunkPeakRef.current = Math.max(chunkPeakRef.current, rms);
    const samples = volSamplesRef.current;
    samples.push(rms);
    if (samples.length > 72) samples.shift();
    rootRef.current?.style.setProperty('--vol', Math.min(1, rms * 4).toFixed(3));
    drawSquiggle();
  }

  function drawSquiggle() {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 96, H = 26;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.beginPath();
    const samples = volSamplesRef.current;
    for (let i = 0; i < samples.length; i++) {
      const x = (i / 71) * W;
      const jitter = Math.sin(i * 2.7) * 0.6;
      const y = H / 2 - Math.min(H / 2 - 1, samples[i] * 90) * (i % 2 ? 1 : -1) + jitter;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = '#8a8a8a';
    g.lineWidth = 1.2;
    g.stroke();
  }

  /* --- the session --- */
  async function begin() {
    setError('');
    setStage('live');
    setStatus('You — say the first few words');
    runningRef.current = true;
    startedAtRef.current = Date.now();
    elapsedRef.current = 0;
    timerRef.current = setInterval(() => {
      // wall-clock, not tick-counting — interval timers get throttled
      elapsedRef.current = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(elapsedRef.current);
    }, 1000);
    grabWakeLock();
    document.addEventListener('visibilitychange', onVisible);

    if (DEMO) { runDemo(); return; }

    try {
      // raw-ish capture: the phone sits between two people, keep distant voices
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      streamRef.current = stream;
      startMeter(stream);
      beginChunk();
    } catch {
      cleanup();
      onDone(null, 'Microphone access was blocked — allow it and try again.');
    }
  }

  function beginChunk() {
    if (!runningRef.current) return;
    const { mime, ext } = pickRecordingType();
    const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    const parts = [];
    const startSec = elapsedRef.current;
    chunkPeakRef.current = 0;
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      const hadSpeech = chunkPeakRef.current > SPEECH_RMS;
      const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' });
      if (hadSpeech && blob.size > 2000) enqueueChunk({ blob, ext, startSec });
      if (runningRef.current) beginChunk();
    };
    rec.start();
    recRef.current = rec;
    chunkTimerRef.current = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, CHUNK_SECS * 1000);
  }

  function enqueueChunk(chunk) {
    queueRef.current = queueRef.current.then(() => processChunk(chunk)).catch(() => {});
  }

  async function processChunk({ blob, ext, startSec }) {
    let raw;
    try {
      setStatus(''); // clear the calibration hint once audio flows
      raw = await transcribeChunk({ blob, ext, apiKey: settings.elevenKey });
    } catch (e) {
      // one retry, then let the chunk go rather than stall the session
      try { raw = await transcribeChunk({ blob, ext, apiKey: settings.elevenKey }); }
      catch { setError('transcription hiccup — still listening'); return; }
    }
    const chunkTurns = raw.map(t => ({ speaker: t.speaker, t: startSec + Math.floor(t.start || 0), text: t.text }));
    if (!chunkTurns.length && !pendingRawRef.current.length) return;
    const newTurns = pendingRawRef.current.concat(chunkTurns);

    try {
      const read = await analyzeLive({
        apiKey: settings.anthropicKey,
        model: settings.liveModel || 'claude-haiku-4-5-20251001',
        labeledSoFar: labeledRef.current, newTurns, elapsed: elapsedRef.current,
      });
      pendingRawRef.current = [];
      const labeled = (read.labeled_turns || []).map((lt, i) => ({
        speaker: lt.speaker === 'them' ? 'them' : 'you',
        text: lt.text,
        t: newTurns[Math.min(i, newTurns.length - 1)]?.t ?? startSec,
      }));
      labeledRef.current = labeledRef.current.concat(labeled);
      applyRead(read);
      setError('');
    } catch {
      pendingRawRef.current = newTurns; // carry these turns into the next read
      setError('analysis paused — still recording');
    }
  }

  function applyRead(read) {
    if (read.you_state) setYouState(read.you_state);
    if (read.them_state) setThemState(read.them_state);
    if (typeof read.temperature === 'number') {
      const v = Math.max(0, Math.min(100, read.temperature));
      setTemp(v);
      tempSeriesRef.current.push({ t: elapsedRef.current, v });
    }
    if (read.trigger?.quote) setTrigger(read.trigger);
    if (read.new_moment) setMoments(m => [...m, { t: elapsedRef.current, label: read.new_moment }]);
  }

  /* --- demo driver: scripted session, synthetic volume --- */
  function runDemo() {
    setStatus('You — say the first few words');
    const d = demoRef.current;
    const loop = () => {
      if (!runningRef.current) return;
      const t = (Date.now() - startedAtRef.current) / 1000;
      const noise = Math.abs(Math.sin(t * 2.1)) * Math.abs(Math.sin(t * 0.7)) * 0.12 + Math.random() * 0.02;
      feedVolume(noise);
      while (d.idx < DEMO_SCRIPT.length && DEMO_SCRIPT[d.idx].at <= t) {
        const ev = DEMO_SCRIPT[d.idx++];
        setStatus('');
        applyRead({
          you_state: ev.you, them_state: ev.them, temperature: ev.temp,
          trigger: ev.trigger, new_moment: ev.moment,
        });
      }
      d.raf = requestAnimationFrame(loop);
    };
    loop();
    labeledRef.current = demoSession().turns;
  }

  /* --- ending --- */
  async function endSession() {
    if (stage === 'ending') return;
    setStage('ending');
    setStatus('reading the room…');
    runningRef.current = false;
    clearInterval(timerRef.current);
    clearTimeout(chunkTimerRef.current);

    if (!DEMO) {
      const rec = recRef.current;
      if (rec && rec.state !== 'inactive') {
        await new Promise(res => { rec.addEventListener('stop', res, { once: true }); rec.stop(); });
      }
      await queueRef.current; // let the last chunks transcribe + read
    }
    cleanup();

    const turns = labeledRef.current;
    if (!turns.length) { onDone(null, 'Nothing was said — session discarded.'); return; }

    const base = {
      id: uid(),
      startedAt: startedAtRef.current,
      duration: elapsedRef.current,
      turns,
      moments,
      tempSeries: tempSeriesRef.current,
      talk: talkBalance(turns),
      recap: null,
    };

    if (DEMO) {
      await new Promise(r => setTimeout(r, 900));
      onDone({ ...base, tempSeries: demoSession().tempSeries, recap: DEMO_RECAP });
      return;
    }

    try {
      const recap = await makeRecap({
        apiKey: settings.anthropicKey, model: settings.recapModel || 'claude-sonnet-5',
        turns, moments, duration: elapsedRef.current,
      });
      onDone({ ...base, recap });
    } catch (e) {
      onDone(base, 'Saved — the recap failed, open the session to retry.');
    }
  }

  const armEnd = () => {
    if (endArmed) { endSession(); return; }
    setEndArmed(true);
    setTimeout(() => setEndArmed(false), 3000);
  };

  /* --- render --- */
  if (stage === 'consent') {
    return html`
      <div class="live consent" ref=${rootRef}>
        <button class="consent-half them ${armed.them ? 'armed' : ''}" onClick=${() => setArmed(a => ({ ...a, them: true }))}>
          <span>Them</span>
          <b>${armed.them ? 'ready' : 'tap to agree'}</b>
        </button>
        <div class="consent-mid">
          <div class="consent-note">Closer records this conversation.<br/>It starts when you both agree.</div>
          <button class="ghostbtn" onClick=${() => onDone(null)}>cancel</button>
        </div>
        <button class="consent-half you ${armed.you ? 'armed' : ''}" onClick=${() => setArmed(a => ({ ...a, you: true }))}>
          <b>${armed.you ? 'ready' : 'tap to agree'}</b>
          <span>You</span>
        </button>
      </div>
    `;
  }

  const shownMoments = moments.slice(-5);
  return html`
    <div class="live ${stage}" ref=${rootRef} style=${`--temp:${temp}`}>
      <div class="arc them"><div class="arc-inner">
        <span class="arc-name">Them</span>
        <b class="arc-state">${themState || ' '}</b>
      </div></div>

      <button class="endbtn ${endArmed ? 'armed' : ''}" onClick=${armEnd} disabled=${stage === 'ending'}>
        ${stage === 'ending' ? '…' : endArmed ? 'tap again to end' : 'end'}
      </button>

      <div class="live-center">
        <div class="trigger ${trigger ? 'show' : ''}">
          ${trigger && html`Triggered by statement <span class="tq">“${trigger.quote}”</span>`}
        </div>

        <div class="timeline">
          <div class="tl-track">
            ${shownMoments.map((m) => html`
              <button class="tl-dot" key=${m.t} onClick=${() => setToast(`${m.label} · ${fmtClock(m.t)}`)}></button>
              <span class="tl-line"></span>`)}
            <canvas ref=${canvasRef} class="tl-squiggle" width="96" height="26"></canvas>
          </div>
          <div class="tl-time">${fmtDur(elapsed)}</div>
        </div>

        ${toast && html`<div class="toast">${toast}</div>`}
        ${(status || error) && html`<div class="status">${error || status}</div>`}
      </div>

      <div class="you-state">${youState || ' '}</div>
      <div class="arc you"><div class="arc-inner">
        <span class="arc-name">You</span>
      </div></div>
    </div>
  `;
}

/* ---------------- recap overlay ---------------- */
function TempChart({ series }) {
  if (!series || series.length < 2) return null;
  const W = 320, H = 72;
  const maxT = series[series.length - 1].t || 1;
  const pts = series.map(p => `${(p.t / maxT) * W},${H - 6 - (Math.min(100, p.v) / 100) * (H - 12)}`).join(' ');
  return html`
    <svg class="tempchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="0" y1=${H - 6} x2=${W} y2=${H - 6} stroke="#e5e0da" stroke-width="1" />
      <polyline points=${pts} fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
}

function PersonCard({ label, tone, p }) {
  if (!p) return null;
  return html`
    <div class="person ${tone}">
      <div class="person-head"><span class="pdot"></span>${label} — <i>${p.showed_up_as}</i></div>
      ${p.strengths?.length > 0 && html`<div class="psec"><h4>did well</h4><ul>${p.strengths.map(x => html`<li>${x}</li>`)}</ul></div>`}
      ${p.patterns?.length > 0 && html`<div class="psec"><h4>patterns</h4><ul>${p.patterns.map(x => html`<li>${x}</li>`)}</ul></div>`}
      ${p.try_next_time?.length > 0 && html`<div class="psec"><h4>try next time</h4><ul>${p.try_next_time.map(x => html`<li>${x}</li>`)}</ul></div>`}
    </div>`;
}

function Recap({ session, onClose, onDelete, onRetry }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState('');
  const r = session.recap;
  const talk = session.talk || { you: 1, them: 1 };
  const youPct = Math.round((talk.you / Math.max(1, talk.you + talk.them)) * 100);

  const retry = async () => {
    setRetrying(true); setRetryErr('');
    try { await onRetry(session); } catch (e) { setRetryErr(e.message); }
    setRetrying(false);
  };

  return html`
    <div class="sheet">
      <div class="sheet-top">
        <button class="iconbtn" onClick=${onClose} aria-label="Close">✕</button>
        <div class="sheet-title">${r?.title || 'conversation'}</div>
        <span style="width:34px"></span>
      </div>
      <div class="sheet-body">
        <div class="meta-line">${fmtDateTime(session.startedAt)} · ${fmtDur(session.duration)}</div>

        <div class="balance">
          <div class="balance-bar"><span class="b-you" style=${`width:${youPct}%`}></span></div>
          <div class="balance-labels"><span class="you-txt">you ${youPct}%</span><span class="them-txt">them ${100 - youPct}%</span></div>
        </div>

        <${TempChart} series=${session.tempSeries} />
        ${session.moments?.length > 0 && html`
          <div class="moments-line">${session.moments.map(m => html`<span class="chip">${m.label} · ${fmtClock(m.t)}</span>`)}</div>`}

        ${!r && html`
          <div class="recap-missing">
            <p>This conversation hasn't been analyzed yet.</p>
            <button class="btn primary" disabled=${retrying} onClick=${retry}>${retrying ? 'reading the room…' : 'Analyze now'}</button>
            ${retryErr && html`<div class="status err">${retryErr}</div>`}
          </div>`}

        ${r && html`
          <section><h3>what happened</h3><p>${r.summary}</p></section>
          <section><h3>the dynamic</h3><p>${r.dynamic}</p></section>

          ${r.turning_points?.length > 0 && html`
            <section><h3>turning points</h3>
              ${r.turning_points.map(tp => html`
                <div class="quote ${tp.speaker}">
                  <div class="q-text">“${tp.quote}”</div>
                  <div class="q-meta">${tp.speaker} — ${tp.effect}</div>
                </div>`)}
            </section>`}

          <section class="people">
            <${PersonCard} label="You" tone="you" p=${r.you} />
            <${PersonCard} label="Them" tone="them" p=${r.them} />
          </section>

          ${r.repair_attempts?.length > 0 && html`
            <section><h3>repair attempts</h3>
              <ul class="plain">${r.repair_attempts.map(ra => html`
                <li><span class=${ra.landed ? 'ok' : 'miss'}>${ra.landed ? '✓' : '✕'}</span> <b>${ra.speaker}</b> — ${ra.description}</li>`)}</ul>
            </section>`}

          ${r.unresolved?.length > 0 && html`
            <section><h3>left unresolved</h3>
              <ul class="plain">${r.unresolved.map(u => html`<li>· ${u}</li>`)}</ul>
            </section>`}

          ${r.takeaways?.length > 0 && html`
            <section><h3>takeaways</h3>
              ${r.takeaways.map(t => html`
                <div class="takeaway"><span class="chip ${t.for}">${t.for}</span>${t.text}</div>`)}
            </section>`}

          ${r.closing_note && html`<div class="closing">${r.closing_note}</div>`}
        `}

        ${session.turns?.length > 0 && html`
          <details class="transcript">
            <summary>transcript</summary>
            ${session.turns.map(t => html`
              <div class="turn ${t.speaker}"><span class="turn-ts">${fmtClock(t.t)}</span><b>${t.speaker}</b> ${t.text}</div>`)}
          </details>`}

        <div class="danger-row">
          <button class="ghostbtn danger" onClick=${() => confirmDel ? onDelete(session.id) : setConfirmDel(true)}>
            ${confirmDel ? 'tap again to delete forever' : 'delete this conversation'}
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ---------------- settings ---------------- */
function Settings({ settings, onSave, onClose }) {
  const [eleven, setEleven] = useState(settings.elevenKey || '');
  const [anthropic, setAnthropic] = useState(settings.anthropicKey || '');
  const [liveModel, setLiveModel] = useState(settings.liveModel || 'claude-haiku-4-5-20251001');
  const [recapModel, setRecapModel] = useState(settings.recapModel || 'claude-sonnet-5');

  const save = () => {
    onSave({ elevenKey: eleven.trim(), anthropicKey: anthropic.trim(), liveModel, recapModel });
    onClose();
  };

  return html`
    <div class="sheet">
      <div class="sheet-top">
        <button class="iconbtn" onClick=${onClose} aria-label="Close">✕</button>
        <div class="sheet-title">settings</div>
        <span style="width:34px"></span>
      </div>
      <div class="sheet-body">
        <div class="field">
          <label>ElevenLabs API key</label>
          <div class="hint">hears the conversation. stored only on this phone.</div>
          <input type="password" value=${eleven} placeholder="sk_…" onInput=${e => setEleven(e.target.value)} />
        </div>
        <div class="field">
          <label>Anthropic API key</label>
          <div class="hint">reads the room. stored only on this phone.</div>
          <input type="password" value=${anthropic} placeholder="sk-ant-…" onInput=${e => setAnthropic(e.target.value)} />
        </div>
        <div class="field">
          <label>live model</label>
          <select value=${liveModel} onChange=${e => setLiveModel(e.target.value)}>
            ${LIVE_MODELS.map(m => html`<option value=${m.id} selected=${m.id === liveModel}>${m.label}</option>`)}
          </select>
        </div>
        <div class="field">
          <label>recap model</label>
          <select value=${recapModel} onChange=${e => setRecapModel(e.target.value)}>
            ${RECAP_MODELS.map(m => html`<option value=${m.id} selected=${m.id === recapModel}>${m.label}</option>`)}
          </select>
        </div>
        <button class="btn primary" onClick=${save}>Save</button>
      </div>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

/* own service worker, own scope — independent of any sibling apps */
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
