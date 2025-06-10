import asyncio
import websockets
import json
import sounddevice as sd
import os
import numpy as np
from dotenv import load_dotenv

# Audio config
SAMPLE_RATE = 16000
CHUNK_SIZE = 2048

load_dotenv()
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
DEEPGRAM_URL = f"wss://api.deepgram.com/v1/listen?punctuate=true&language=en&sample_rate={SAMPLE_RATE}&encoding=linear16"

class MicrophoneStream:
    def __init__(self, callback):
        self.callback = callback
        self.paused = False
        self.loop = None
        self.ws = None
        self.audio_queue = asyncio.Queue()

    def pause(self):
        self.paused = True
        print("Mic paused.")

    def resume(self):
        self.paused = False
        print("Mic resumed.")

    def _audio_callback(self, indata, _frames, _time, status):
        if status:
            print(f"Audio status: {status}")
        if self.paused:
            silent_audio = np.zeros_like(indata)
            audio_bytes = silent_audio.tobytes()
        else:
            audio_bytes = indata.tobytes()
        self.audio_queue.put_nowait(audio_bytes)

    async def send_audio_loop(self, ws):
        while True:
            audio_chunk = await self.audio_queue.get()
            try:
                await ws.send(audio_chunk)
            except Exception as e:
                print(f"Error sending audio: {e}")
                break

    async def receive_transcripts(self, ws):
        async for msg in ws:
            data = json.loads(msg)
            transcript = data.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
            is_final = data.get("is_final", False)

            if is_final and transcript.strip() and not self.paused:
                await self.callback(transcript)

    async def heartbeat(self, ws):
        while True:
            try:
                await ws.send("") 
                await asyncio.sleep(5)
            except:
                break

    async def listen_loop(self):
        self.loop = asyncio.get_running_loop()

        while True:
            try:
                async with websockets.connect(
                    DEEPGRAM_URL,
                    extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                    ping_interval=5,
                    ping_timeout=10
                ) as ws:
                    self.ws = ws

                    # Start audio stream
                    stream = sd.InputStream(
                        samplerate=SAMPLE_RATE,
                        blocksize=CHUNK_SIZE,
                        dtype='int16',
                        channels=1,
                        callback=self._audio_callback
                    )

                    with stream:
                        print("Listening... Press Ctrl+C to stop.")
                        await asyncio.gather(
                            self.send_audio_loop(ws),
                            self.receive_transcripts(ws),
                            self.heartbeat(ws)
                        )

            except websockets.ConnectionClosedError as e:
                print(f"WebSocket closed with error {e.code}: {e.reason}. Reconnecting...")
                await asyncio.sleep(1)
                continue
            except Exception as e:
                print(f"Unexpected error: {e}")
                break
