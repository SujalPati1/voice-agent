# voice-agent

## What problem it solves

Most voice assistants are built as a chain of blocking steps — record the whole utterance, upload it, wait for a transcript, wait for the model to finish writing, wait for the audio to be synthesised, then finally play it. Each wait is small on its own and the sum is a two-to-four second pause that makes the thing feel dead in conversation, because human turn-taking budgets about 200 ms. This project is an attempt at a speech-to-speech agent where every stage streams instead of waiting: the browser downsamples mic audio to 16 kHz PCM and pushes it over a WebSocket in chunks, Deepgram returns interim transcripts as you speak, Groq (Llama 4 Scout) streams tokens back the moment the utterance ends, and ElevenLabs synthesises the reply which is sent back down the same socket. It also handles the problem every open-mic agent hits — the agent hearing and transcribing its own voice — with a cooldown window that suppresses inbound audio for a couple of seconds after it speaks, plus duplicate-transcript filtering. Per-turn latency was measured into `session_metrics.csv` (end-of-utterance time, time-to-first-token, time-to-first-byte of audio, total), which is the number the whole design exists to bring down.

## How it works

```
Browser mic ──16kHz PCM──► WebSocket /ws/audio ──► Deepgram streaming STT
                                                          │ transcript
                                                          ▼
                          ◄── audio bytes ── ElevenLabs ◄── Groq (streaming LLM)
```

| File | Role |
|---|---|
| `backend.py` | FastAPI app — WebSocket audio loop, health check, LiveKit token endpoint |
| `services/stt.py` | Deepgram streaming client with auto-reconnect |
| `services/llm.py` | Groq chat completions, streamed token by token |
| `services/tts.py` | ElevenLabs text-to-speech, returns PCM bytes |
| `token_generator.py` | Signs LiveKit room join tokens |
| `src/App.jsx` | React client — mic capture, downsampling, WebSocket, playback |

## How to run it

**Prerequisites:** Python 3.10+, Node.js 18+, a microphone, and API keys for Deepgram, Groq and ElevenLabs (LiveKit only if you use the token endpoint).

**1. Python environment**

There is no `requirements.txt` yet, so install directly:

```bash
python -m venv venv
source venv/bin/activate          # venv\Scripts\activate on Windows
pip install fastapi uvicorn websockets python-dotenv openai \
            elevenlabs soundfile numpy pyjwt
```

**2. Environment variables**

Create a `.env` in the repo root:

```env
DEEPGRAM_API_KEY=
GROQ_API_KEY=
GROQ_API_BASE=https://api.groq.com/openai/v1
ELEVENLABS_API_KEY=
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Keep this file out of version control — add `.env` to `.gitignore` before your first commit.

**3. Run both processes**

```bash
npm install
npm run dev
```

That starts the API on `:8000` and, once it responds, the Vite frontend on `:5173`. To run them separately in two terminals:

```bash
uvicorn backend:app --host 0.0.0.0 --port 8000     # terminal 1
npm run dev:app                                     # terminal 2
```

Open `http://localhost:5173`, allow microphone access, and start talking. Transcripts arrive on the socket prefixed with `__TRANSCRIPT__:`, LLM tokens stream in as plain text, and the spoken reply comes back as binary audio.

## Known rough edges

- The frontend hardcodes `http://localhost:8000` and `ws://localhost:8000/ws/audio` in `src/App.jsx` — move these to an env var before deploying anywhere.
- CORS is `allow_origins=["*"]`, fine for local development only.
- `services/metrics.py` is empty; the CSV logging that produced `session_metrics.csv` isn't wired into the current code path.
- Barge-in is handled by a fixed 2.5 s suppression window rather than real echo cancellation, so interrupting the agent mid-sentence doesn't work cleanly yet.
