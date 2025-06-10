import React, { useState } from 'react';
import { Room, createLocalTracks } from 'livekit-client';

export default function VoiceAgent() {
  const [connected, setConnected] = useState(false);

  async function init() {
    try {
      const res = await fetch('http://localhost:8000/get_token?identity=test-user');
      const { token } = await res.json();

      const room = new Room();
      await room.connect('wss://voice-agent-14zd5m08.livekit.cloud', token);

      const tracks = await createLocalTracks({ audio: true });
      tracks.forEach(track => room.localParticipant.publishTrack(track));

      console.log('Connected to LiveKit room:', room.name);
      setConnected(true);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      const ws = new WebSocket('ws://localhost:8000/ws/audio');
      ws.binaryType = 'arraybuffer';

      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const buffer = floatTo16BitPCM(input);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buffer);
        }
      };

      function floatTo16BitPCM(input) {
        const buffer = new ArrayBuffer(input.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < input.length; i++) {
          let s = Math.max(-1, Math.min(1, input[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return buffer;
      }
    } catch (err) {
      console.error('Error during init:', err);
    }
  }

  return (
    <div>
      <h2>{connected ? "LiveKit Voice Agent Connected" : "Click to Start Voice Agent"}</h2>
      {!connected && <button onClick={init}>Start Agent</button>}
    </div>
  );
}
