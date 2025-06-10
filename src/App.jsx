import React, { useEffect } from 'react';
import { connect } from 'livekit-client';

export default function VoiceAgent() {
  useEffect(() => {
    async function init() {
      // Step 1: Fetch token from your Python backend
      const res = await fetch('http://localhost:8000/get_token?identity=test-user');
      const { token } = await res.json();

      // Step 2: Connect to LiveKit room
      const room = await connect('wss://your-livekit-url', token);
      console.log('Connected to LiveKit room:', room.name);

      // Step 3: Capture mic audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      // Step 4: Setup WebSocket to your backend to send mic audio chunks
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
    }

    init();
  }, []);

  return <div>LiveKit Voice Agent Connected</div>;
}
