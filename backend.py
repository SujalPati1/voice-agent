from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from token_generator import create_token
from services.stt import DeepgramStreamer
from services.llm import get_llm_response
from services.tts import text_to_speech
import asyncio
import time

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/get_token")
def get_token(identity: str, room: str = "default"):
    return {"token": create_token(identity, room)}

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    print("Mic connected!")

    deepgram = DeepgramStreamer()
    await deepgram.connect()

    last_transcript = ""
    last_time = 0
    COOLDOWN = 2.5

    suppress_audio_until = 0  # Epoch timestamp

    async def receive_audio():
        nonlocal suppress_audio_until
        try:
            async for msg in websocket.iter_bytes():
                if time.time() < suppress_audio_until:
                    # Skip mic input during echo suppression window
                    continue
                await deepgram.send_audio(msg)
        except Exception as e:
            print("Audio receiving error:", e)

    async def process_transcripts():
        nonlocal last_transcript, last_time, suppress_audio_until
        try:
            while True:
                transcript = await deepgram.get_next_transcript()
                print("Transcript callback:", transcript)

                now = time.time()
                if transcript.strip().lower() == last_transcript.strip().lower() and now - last_time < COOLDOWN:
                    print("Ignoring duplicate transcript within cooldown.")
                    continue

                last_transcript = transcript
                last_time = now

                response = get_llm_response(transcript)
                text_to_speech(response)

                await websocket.send_text(f"LLM: {response}")

                # Suppress mic audio for 2.5 seconds after TTS ends
                suppress_audio_until = time.time() + 2.5

        except Exception as e:
            print("Transcript processing error:", e)

    await asyncio.gather(receive_audio(), process_transcripts())
