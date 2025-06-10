import asyncio
import websockets
import os
import json
from dotenv import load_dotenv

# Config
SAMPLE_RATE = 16000
DEEPGRAM_URL = f"wss://api.deepgram.com/v1/listen?punctuate=true&language=en&sample_rate={SAMPLE_RATE}&encoding=linear16"

load_dotenv()
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

class DeepgramStreamer:
    def __init__(self):
        self.buffer = b""
        self.transcript = ""
        self.transcript_ready = asyncio.Event()

    async def send_audio(self, ws):
        try:
            await ws.send(self.buffer)
        except Exception as e:
            print("Error sending audio:", e)

    async def receive_transcript(self, ws):
        async for msg in ws:
            data = json.loads(msg)
            transcript = data.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
            is_final = data.get("is_final", False)

            if is_final and transcript.strip():
                self.transcript = transcript
                self.transcript_ready.set()
                break  # we can close after 1 transcription

    async def stream_transcribe_audio(self, pcm_bytes: bytes):
        self.buffer = pcm_bytes
        self.transcript = ""
        self.transcript_ready.clear()

        try:
            async with websockets.connect(
                DEEPGRAM_URL,
                extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                ping_interval=5,
                ping_timeout=10,
            ) as ws:
                await asyncio.gather(
                    self.send_audio(ws),
                    self.receive_transcript(ws),
                )
        except Exception as e:
            print("Deepgram error:", e)
            return ""

        await self.transcript_ready.wait()
        return self.transcript
