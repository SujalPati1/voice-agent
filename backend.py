from fastapi import FastAPI, WebSocket
import asyncio
from fastapi.middleware.cors import CORSMiddleware
from token_generator import create_token

app = FastAPI()

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/get_token")
def get_token(identity: str, room: str = "default"):
    return {"token": create_token(identity, room)}


@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    print("Mic connected!")

    try:
        while True:
            audio_chunk = await websocket.receive_bytes()

            print(f"Received audio chunk of size {len(audio_chunk)}")

            await asyncio.sleep(1)
            await websocket.send_text("LLM response: Hello from Python!")
    except Exception as e:
        print("Connection closed:", e)
