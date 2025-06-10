import jwt
import time
import os

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

def create_token(identity: str, room: str = "default"):
    now = int(time.time())
    exp = now + 3600 

    payload = {
        "jti": f"{identity}-{now}",
        "iss": LIVEKIT_API_KEY,
        "sub": identity,
        "nbf": now,
        "exp": exp,
        "video": {
            "roomJoin": True,
            "room": room,
            "canPublish": True,
            "canSubscribe": True
        }
    }

    token = jwt.encode(payload, LIVEKIT_API_SECRET, algorithm="HS256")
    return token
