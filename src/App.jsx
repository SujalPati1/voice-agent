import React, { useState, useEffect } from 'react';
import { Room } from 'livekit-client';
import { Mic, MicOff, Bot, User, Sparkles, Zap } from 'lucide-react';

let currentTTSSource = null;
let currentAudioContext = null;

export default function VoiceAgent() {
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // new
  const [llmResponses, setLlmResponses] = useState([]);
  const [currentAssistantMsg, setCurrentAssistantMsg] = useState("");
  const [isListening, setIsListening] = useState(false); // new

  async function init() {
    try {
      setConnectionStatus('connecting');
      const res = await fetch('http://localhost:8000/get_token?identity=test-user');
      const { token } = await res.json();

      const room = new Room();
      await room.connect('wss://voice-agent-14zd5m08.livekit.cloud', token);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = stream.getAudioTracks()[0];
      await room.localParticipant.publishTrack(audioTrack);

      console.log('Connected to LiveKit room:', room.name);
      setConnected(true);
      setConnectionStatus('connected');
      setIsListening(true);

      const ws = new WebSocket('ws://localhost:8000/ws/audio');
      ws.binaryType = 'arraybuffer';

      let lastSentTime = Date.now();
      let keepAliveInterval;

      ws.onmessage = async (event) => {
        const chunk = event.data;

        if (typeof chunk === "string" && chunk.startsWith("__TRANSCRIPT__:")) {
          const transcript = chunk.replace("__TRANSCRIPT__:", "");
          setLlmResponses((prev) => [...prev, { role: "user", content: transcript }]);
          setCurrentAssistantMsg("");
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          await playBinaryTTS(event.data);
          return;
        }

        setCurrentAssistantMsg((prev) => {
          const updated = prev + chunk;
          setLlmResponses((prevMsgs) => {
            const lastMsg = prevMsgs[prevMsgs.length - 1];
            const isAssistantLast = lastMsg?.role === "assistant";
            if (!isAssistantLast) {
              return [...prevMsgs, { role: "assistant", content: updated }];
            } else {
              const updatedMsgs = [...prevMsgs];
              updatedMsgs[updatedMsgs.length - 1].content = updated;
              return updatedMsgs;
            }
          });
          return updated;
        });
      };

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      ws.onopen = () => {
        const silence = new Int16Array(16000).buffer;
        ws.send(silence);
        console.log("WebSocket opened, sent initial silence");

        keepAliveInterval = setInterval(() => {
          const now = Date.now();
          if (now - lastSentTime > 1000 && ws.readyState === WebSocket.OPEN) {
            const silenceChunk = new Int16Array(320).buffer;
            ws.send(silenceChunk);
            console.log("[Fallback] Sent keepalive silence");
          }
        }, 1000);
      };

      ws.onclose = () => {
        clearInterval(keepAliveInterval);
        console.log("WebSocket closed");
      };

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(input, audioContext.sampleRate, 16000);
        const buffer = floatTo16BitPCM(downsampled);

        if (currentTTSSource && input.some((val) => Math.abs(val) > 0.01)) {
          console.log("User is speaking → Stopping TTS");
          try {
            currentTTSSource.stop();
            currentTTSSource.disconnect();
            currentTTSSource = null;
            currentAudioContext?.close();
            currentAudioContext = null;
          } catch (err) {
            console.error("Error stopping TTS:", err);
          }
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buffer);
          lastSentTime = Date.now();
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
      setConnectionStatus('disconnected');
    }
  }

  async function playBinaryTTS(arrayBuffer) {
    try {
      if (currentTTSSource) {
        currentTTSSource.stop();
        currentTTSSource.disconnect();
        currentTTSSource = null;
      }
      if (currentAudioContext) {
        await currentAudioContext.close();
      }

      const ttsContext = new (window.AudioContext || window.webkitAudioContext)();
      currentAudioContext = ttsContext;

      const audioBuffer = await ttsContext.decodeAudioData(arrayBuffer);
      const source = ttsContext.createBufferSource();
      source.buffer = audioBuffer;
      currentTTSSource = source;

      source.connect(ttsContext.destination);
      source.start(0);

      source.onended = () => {
        currentTTSSource = null;
        currentAudioContext?.close();
        currentAudioContext = null;
      };

      console.log("TTS playback started (binary)");
    } catch (err) {
      console.error("Error playing TTS audio:", err);
    }
  }

  function getConnectionStatusText() {
    if (connectionStatus === 'connected') return 'Connected';
    if (connectionStatus === 'connecting') return 'Connecting...';
    return 'Disconnected';
  }

  function getConnectionStatusColor() {
    if (connectionStatus === 'connected') return 'text-emerald-400';
    if (connectionStatus === 'connecting') return 'text-yellow-400';
    return 'text-red-400';
  }
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white font-inter">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-teal-600/10"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/20 via-transparent to-transparent"></div>
      
      <div className="relative z-10 container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full shadow-2xl">
              <Bot className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-teal-400 bg-clip-text text-transparent mb-4">
            Llma Bot
          </h1>
          <p className="text-xl text-gray-300 mb-2">AI Voice Assistant</p>
          <div className={`flex items-center justify-center gap-2 ${getConnectionStatusColor()}`}>
            <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>
            <span className="text-sm font-medium">{getConnectionStatusText()}</span>
          </div>
        </div>

        {/* Connection Card */}
        {!connected ? (
          <div className="bg-white/5 backdrop-blur-lg rounded-3xl p-8 border border-white/10 shadow-2xl mb-8">
            <div className="text-center">
              <div className="mb-6">
                <Sparkles className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                <h2 className="text-2xl font-semibold mb-3">Ready to Chat?</h2>
                <p className="text-gray-300">Start a conversation with Llma Bot using your voice</p>
              </div>
              
              <button
                onClick={init}
                disabled={connectionStatus === 'connecting'}
                className="group relative px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl font-semibold text-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-center gap-3">
                  {connectionStatus === 'connecting' ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      <span>Start Voice Chat</span>
                    </>
                  )}
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-2xl opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
              </button>
            </div>
          </div>
        ) : (
          /* Chat Interface */
          <div className="bg-white/5 backdrop-blur-lg rounded-3xl border border-white/10 shadow-2xl overflow-hidden">
            {/* Chat Header */}
            <div className="bg-gradient-to-r from-blue-500/20 to-purple-600/20 px-6 py-4 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Llma Bot</h3>
                    <p className="text-sm text-gray-300">AI Voice Assistant</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isListening ? (
                    <div className="flex items-center gap-2 text-emerald-400">
                      <Mic className="w-4 h-4" />
                      <div className="flex gap-1">
                        <div className="w-1 h-4 bg-emerald-400 rounded-full animate-pulse"></div>
                        <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-1 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  ) : (
                    <MicOff className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="p-6 max-h-96 overflow-y-auto">
              {llmResponses.length === 0 ? (
                <div className="text-center py-12">
                  <Zap className="w-12 h-12 text-purple-400 mx-auto mb-4 opacity-50" />
                  <p className="text-gray-400">Start speaking to begin the conversation...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {llmResponses.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 ${
                        msg.role === 'assistant' ? 'justify-start' : 'justify-end'
                      }`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex-shrink-0 mt-1">
                          <Bot className="w-4 h-4 text-white" />
                        </div>
                      )}
                      
                      <div
                        className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
                          msg.role === 'assistant'
                            ? 'bg-gradient-to-r from-blue-500/20 to-purple-600/20 text-white'
                            : 'bg-white/10 text-white ml-auto'
                        }`}
                      >
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      </div>

                      {msg.role === 'user' && (
                        <div className="p-2 bg-white/10 rounded-lg flex-shrink-0 mt-1">
                          <User className="w-4 h-4 text-gray-300" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status Bar */}
            <div className="bg-white/5 px-6 py-3 border-t border-white/10">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>Voice chat active</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span>Listening...</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-gray-400 text-sm">
          <p>Powered by Llma Bot AI • Secure voice processing</p>
        </div>
      </div>
    </div>
  );
}

