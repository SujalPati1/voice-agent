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

    buffer = b''
    last_transcript = ""
    last_time = 0
    COOLDOWN = 2.5
    deepgram = DeepgramStreamer()

    try:
        while True:
            audio_chunk = await websocket.receive_bytes()
            buffer += audio_chunk

           
            if len(buffer) > 32000:
                transcript = await deepgram.stream_transcribe_audio(buffer)
                buffer = b''

                print("Transcript callback:", transcript)

                now = time.time()
                if transcript.strip().lower() == last_transcript.strip().lower() and now - last_time < COOLDOWN:
                    print("Ignoring duplicate transcript within cooldown period.")
                    continue

                last_transcript = transcript
                last_time = now

                # LLM → TTS
                response = get_llm_response(transcript)
                text_to_speech(response)

                await websocket.send_text(f"LLM: {response}")

    except Exception as e:
        print("Connection closed:", e)
