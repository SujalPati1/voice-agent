# services/tts.py
import os
import numpy as np
from io import BytesIO
import soundfile as sf
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

load_dotenv()
api_key = os.getenv("ELEVENLABS_API_KEY")
client = ElevenLabs(api_key=api_key)

def text_to_speech_bytes(text, voice_name="Jessica") -> bytes:
    try:
        voices = client.voices.get_all().voices
        voice = next((v for v in voices if v.name == voice_name), None)
        if not voice:
            raise ValueError(f"Voice '{voice_name}' not found.")

        audio_chunks = client.text_to_speech.convert(
            voice_id=voice.voice_id,
            model_id="eleven_monolingual_v1",
            text=text,
            output_format="pcm_16000",
        )
        audio_bytes = b"".join(audio_chunks)

        # Convert to WAV in memory
        pcm_np = np.frombuffer(audio_bytes, dtype=np.int16)
        buffer = BytesIO()
        sf.write(buffer, pcm_np, 16000, format="WAV", subtype="PCM_16")
        return buffer.getvalue()

    except Exception as e:
        print(f"Error in TTS: {e}")
        return None
