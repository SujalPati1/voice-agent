import React, { useState } from 'react';
import { Room } from 'livekit-client';

export default function VoiceAgent() {
  const [connected, setConnected] = useState(false);

  async function init() {
    try {
      const res = await fetch('http://localhost:8000/get_token?identity=test-user');
      const { token } = await res.json();

      const room = new Room();
      await room.connect('wss://voice-agent-14zd5m08.livekit.cloud', token);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Publish mic stream to LiveKit
      const audioTrack = stream.getAudioTracks()[0];
      await room.localParticipant.publishTrack(audioTrack);

      console.log('Connected to LiveKit room:', room.name);
      setConnected(true);

      // Send audio to Deepgram over WebSocket
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      const ws = new WebSocket('ws://localhost:8000/ws/audio');
      ws.binaryType = 'arraybuffer';

      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      // Send 1 second of silence to wake Deepgram
      ws.onopen = () => {
        const silence = new Int16Array(16000).buffer;
        ws.send(silence);
        console.log("WebSocket opened, sent initial silence");
      };

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(input, audioContext.sampleRate, 16000);
        const buffer = floatTo16BitPCM(downsampled);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buffer);
          console.log("Sent audio chunk:", buffer.byteLength);
        }
      };

      function downsampleBuffer(buffer, sampleRate = 48000, outSampleRate = 16000) {
        if (outSampleRate === sampleRate) return buffer;
        const sampleRateRatio = sampleRate / outSampleRate;
        const newLength = Math.round(buffer.length / sampleRateRatio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
          const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
          let accum = 0, count = 0;
          for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
          }
          result[offsetResult] = accum / count;
          offsetResult++;
          offsetBuffer = nextOffsetBuffer;
        }
        return result;
      }

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
