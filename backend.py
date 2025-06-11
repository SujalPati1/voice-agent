from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from token_generator import create_token
from services.stt import DeepgramStreamer
from services.llm import get_llm_response
from services.tts import text_to_speech_bytes   
import asyncio
import time
from io import StringIO
import os

app = FastAPI()
os.makedirs("audio", exist_ok=True)
app.mount("/audio", StaticFiles(directory="audio"), name="audio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.api_route("/", methods=["GET", "HEAD"])
def health_check():
    return {"status": "ok"}

@app.get("/get_token")
def get_token(identity: str, room: str = "default"):
    return {"token": create_token(identity, room)}

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    print("[dev:api] Mic connected!")

    try:
        deepgram = DeepgramStreamer()
        await deepgram.connect()
    except Exception as e:
        print(f"[dev:api] Failed to connect to Deepgram: {e}")
        return

    audio_queue = asyncio.Queue()
    last_transcript = ""
    last_time = 0
    COOLDOWN = 2.5
    suppress_audio_until = 0

    async def receive_audio():
        try:
            print("[dev:api] Receiving audio from frontend...")
            while True:
                msg = await websocket.receive_bytes()
                await audio_queue.put(msg)
        except Exception as e:
            print("[dev:api] Error receiving audio from WebSocket:", e)

    async def forward_audio():
        nonlocal suppress_audio_until
        print("[dev:api] Forwarding audio to Deepgram...")
        try:
            while True:
                if not getattr(deepgram, "connected", True):
                    print("[dev:api] Deepgram disconnected. Reconnecting...")
                    await deepgram.connect()

                try:
                    chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.2)
                    await deepgram.send_audio(chunk)
                except asyncio.TimeoutError:
                    # Always send silence if no new audio
                    await deepgram.send_audio(b'\x00' * 320)
        except Exception as e:
            print("[dev:api] Error forwarding audio to Deepgram:", e)


    async def process_transcripts():
        nonlocal last_transcript, last_time, suppress_audio_until
        print("[dev:api] Processing transcripts from Deepgram...")
        try:
            while True:
                transcript = await deepgram.get_next_transcript()
                print("[dev:api] Transcript callback:", transcript)

                now = time.time()
                if transcript.strip().lower() == last_transcript.strip().lower() and now - last_time < COOLDOWN:
                    print("[dev:api] Duplicate transcript ignored due to cooldown.")
                    continue

                last_transcript = transcript
                last_time = now

                await websocket.send_text("__TRANSCRIPT__:" + transcript)

                response_txt = StringIO()
                async for chunk in get_llm_response(transcript):
                    await websocket.send_text(chunk)
                    response_txt.write(chunk)

                final_response = response_txt.getvalue()
                audio_bytes = text_to_speech_bytes(final_response)
                if audio_bytes:
                    await websocket.send_bytes(audio_bytes)

                suppress_audio_until = time.time() + 2.5

        except Exception as e:
            print("[dev:api] Error in transcript/LLM/TTS flow:", e)

    await asyncio.gather(
        receive_audio(),
        forward_audio(),
        process_transcripts()
    )
