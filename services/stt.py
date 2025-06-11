import asyncio
import websockets
import os
import json
from dotenv import load_dotenv

load_dotenv()
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
SAMPLE_RATE = 16000
DEEPGRAM_URL = (
    f"wss://api.deepgram.com/v1/listen"
    f"?punctuate=true&language=en&sample_rate={SAMPLE_RATE}&encoding=linear16"
)

class DeepgramStreamer:
    def __init__(self):
        self.ws = None
        self.transcript_queue = asyncio.Queue()
        self.reconnect_attempts = 0
        

    async def connect(self):
        print("[STT] Connecting to Deepgram...")
        try:
            self.ws = await websockets.connect(
                DEEPGRAM_URL,
                extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                ping_interval=5,
                ping_timeout=10,
            )
            print("[STT] Connected to Deepgram.")
            asyncio.create_task(self.receive_transcripts())
        except Exception as e:
            print(f"[STT] Failed to connect: {e}")
            await asyncio.sleep(1)
            await self.connect()

    async def receive_transcripts(self):
        try:
            async for msg in self.ws:
                data = json.loads(msg)
                transcript = data.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
                is_final = data.get("is_final", False)

                if is_final and transcript.strip():
                    print(f"[STT] Final Transcript: {transcript}")
                    await self.transcript_queue.put(transcript)

        except websockets.exceptions.ConnectionClosedError as e:
            print(f"[STT] Connection closed: {e}. Reconnecting...")
            await self.connect()

    async def send_audio(self, audio_chunk: bytes):
        if self.ws:
            try:
                await self.ws.send(audio_chunk)
            except Exception as e:
                print(f"[STT] Error sending audio: {e}")

    async def get_next_transcript(self):
        return await self.transcript_queue.get()

    async def close(self):
        if self.ws:
            await self.ws.close()
