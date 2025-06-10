import asyncio
import time
from services.stt import MicrophoneStream
from services.llm import get_llm_response
from services.tts import text_to_speech

last_time = 0
Cooldown = 2.5
last_transcript = ""

async def on_transcription(text):
    global last_transcript,last_time
    print(f"Transcript callback: {text}")

    now = time.time()
    if text.strip().lower() == last_transcript.strip().lower() and now - last_time < Cooldown:
        print("Ignoring duplicate transcript within cooldown period.")
        return
    
    last_transcript = text
    last_time = now
    test_llm(text)

def test_llm(transcript):
    text = get_llm_response(transcript)
    test_tts(text)

def test_tts(text):
    try:
        mic_stream.pause() 
        text_to_speech(text)
    except Exception as e:
        print(f"Error in TTS: {e}")
        return None
    finally:
        mic_stream.resume()
    print("TTS completed successfully.")
    return True

if __name__ == "__main__":
    try:
        mic_stream = MicrophoneStream(on_transcription)
        asyncio.run(mic_stream.listen_loop())
    except KeyboardInterrupt:
        print("\n Exiting...")
