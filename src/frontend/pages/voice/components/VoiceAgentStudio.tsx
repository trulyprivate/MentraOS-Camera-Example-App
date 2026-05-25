import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  RefreshCw,
  Zap,
} from "lucide-react";
import { Badge, Card, Button } from "../../../components/ui";
import VoiceCloneSetup from "./VoiceCloneSetup";
import WakeWordConfig from "./WakeWordConfig";
import LiveTranscriptionPanel from "./LiveTranscriptionPanel";
import AudioVisualizer from "./AudioVisualizer";

export type AgentState = "idle" | "activated" | "generating" | "playing";

export interface TranscriptEntry {
  id: number;
  text: string;
  time: string;
  isFinal: boolean;
  hookDetected: boolean;
  isActivated: boolean;
}

export interface VoiceProfile {
  audioBlobUrl: string | null;
  audioB64: string | null;
  refText: string;
}

export interface AgentConfig {
  hookWord: string;
  instruction: string;
  responseMappings: Record<string, string>;
}

type ConnState = "disconnected" | "connecting" | "connected" | "error";

interface Props {
  userId: string;
}

export default function VoiceAgentStudio({ userId }: Props) {
  const [connState, setConnState] = useState<ConnState>("disconnected");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [statusMsg, setStatusMsg] = useState("Disconnected");
  const [lastResponse, setLastResponse] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>({
    audioBlobUrl: null,
    audioB64: null,
    refText: "",
  });
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    hookWord: "Jarvis",
    instruction: "Be a helpful and concise voice assistant.",
    responseMappings: {},
  });

  const ws = useRef<WebSocket | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const nextPlayTime = useRef(0);
  const recognitionRef = useRef<any>(null);
  const transcriptId = useRef(Date.now());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connStateRef = useRef<ConnState>("disconnected");
  const isMutedRef = useRef(false);
  const agentConfigRef = useRef(agentConfig);

  useEffect(() => {
    connStateRef.current = connState;
  }, [connState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    agentConfigRef.current = agentConfig;
  }, [agentConfig]);

  useEffect(() => {
    audioCtx.current = new (window.AudioContext ||
      (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return () => {
      audioCtx.current?.close();
    };
  }, []);

  const addTranscript = useCallback(
    (entry: Omit<TranscriptEntry, "id" | "time">) => {
      setTranscripts((prev) => {
        const newEntry: TranscriptEntry = {
          ...entry,
          id: transcriptId.current++,
          time: new Date().toLocaleTimeString(),
        };
        if (!entry.isFinal && prev.length > 0 && !prev[0].isFinal) {
          return [{ ...prev[0], ...newEntry, id: prev[0].id }, ...prev.slice(1)].slice(0, 30);
        }
        return [newEntry, ...prev].slice(0, 30);
      });
    },
    [],
  );

  const playAudioChunk = useCallback(async (buf: ArrayBuffer) => {
    if (!audioCtx.current || isMutedRef.current) return;
    if (audioCtx.current.state === "suspended") {
      await audioCtx.current.resume();
    }
    const float32 = new Float32Array(buf);
    if (float32.length === 0) return;

    const audioBuf = audioCtx.current.createBuffer(1, float32.length, 24000);
    audioBuf.getChannelData(0).set(float32);
    const src = audioCtx.current.createBufferSource();
    src.buffer = audioBuf;
    src.connect(audioCtx.current.destination);

    const now = audioCtx.current.currentTime;
    if (nextPlayTime.current < now) nextPlayTime.current = now + 0.05;
    src.start(nextPlayTime.current);
    nextPlayTime.current += audioBuf.duration;

    const rms = Math.sqrt(
      float32.reduce((s, v) => s + v * v, 0) / float32.length,
    );
    setAudioLevel(Math.min(1, rms * 8));
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (ws.current) {
      ws.current.onclose = null;
      ws.current.close();
      ws.current = null;
    }
    setConnState("disconnected");
    setAgentState("idle");
    setIsListening(false);
    setStatusMsg("Disconnected");
  }, []);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    disconnect();
    setConnState("connecting");
    setStatusMsg("Connecting to voice agent...");

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const sid = userId.slice(0, 8) + Math.random().toString(36).slice(2, 5);
    const url = `${proto}//${window.location.host}/ws/voice-agent?sid=${encodeURIComponent(sid)}`;

    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws.current = socket;

    socket.onopen = () => {
      setConnState("connected");
      setStatusMsg("Connected — sending voice profile...");
      const cfg = agentConfigRef.current;
      socket.send(
        JSON.stringify({
          type: "setup_clone",
          audio_b64: voiceProfile.audioB64,
          ref_text: voiceProfile.refText,
          hook_word: cfg.hookWord,
          instruction: cfg.instruction,
          response_mappings: cfg.responseMappings,
        }),
      );
    };

    socket.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        setAgentState("playing");
        await playAudioChunk(event.data);
        return;
      }
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case "status":
            if (msg.status === "clone_ready" || msg.status === "config_updated") {
              setStatusMsg(
                `Ready · Wake word: "${msg.hook_word || agentConfigRef.current.hookWord}"${
                  msg.tts_available === false ? " (demo audio mode)" : ""
                }`,
              );
            } else {
              setStatusMsg(msg.message);
            }
            break;
          case "transcript_analysis":
            addTranscript({
              text: msg.transcript,
              isFinal: msg.is_final,
              hookDetected: msg.hook_detected,
              isActivated: msg.is_activated,
            });
            if (msg.is_activated && agentState === "idle") {
              setAgentState("activated");
            }
            break;
          case "generating":
            setAgentState("generating");
            setStatusMsg("Generating response...");
            break;
          case "response_text":
            setLastResponse(msg.text);
            setStatusMsg("Synthesizing voice...");
            break;
          case "audio_complete":
            setAgentState("idle");
            setAudioLevel(0);
            setStatusMsg(
              `Ready · Wake word: "${agentConfigRef.current.hookWord}"${
                msg.demo ? " (demo audio — upload a voice sample for cloning)" : ""
              }`,
            );
            break;
          case "error":
            setStatusMsg(`Error: ${msg.message}`);
            break;
        }
      } catch {}
    };

    socket.onerror = () => {
      setConnState("error");
      setStatusMsg("Connection error");
    };

    socket.onclose = () => {
      if (connStateRef.current !== "disconnected") {
        setConnState("disconnected");
        setStatusMsg("Disconnected — retrying in 5s...");
        reconnectTimer.current = setTimeout(connect, 5000);
      }
    };
  }, [userId, voiceProfile, disconnect, addTranscript, playAudioChunk]);

  const startListening = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setStatusMsg(
        "Browser speech recognition unavailable — using glasses transcription only",
      );
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        const isFinal = event.results[i].isFinal;
        ws.current?.send(
          JSON.stringify({ type: "live_transcript", text, is_final: isFinal }),
        );
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Pipe MentraOS glasses SSE transcription into the WebSocket
  useEffect(() => {
    if (connState !== "connected") return;
    let es: EventSource | null = null;
    const connectSSE = () => {
      es = new EventSource(
        `/api/transcription-stream?userId=${encodeURIComponent(userId)}`,
      );
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "connected" || !data.text) return;
          ws.current?.send(
            JSON.stringify({
              type: "live_transcript",
              text: data.text,
              is_final: data.isFinal,
            }),
          );
        } catch {}
      };
    };
    connectSSE();
    return () => es?.close();
  }, [connState, userId]);

  // Push live config updates to backend
  useEffect(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          type: "update_config",
          hook_word: agentConfig.hookWord,
          instruction: agentConfig.instruction,
          response_mappings: agentConfig.responseMappings,
        }),
      );
    }
  }, [agentConfig]);

  const handleInterrupt = () => {
    ws.current?.send(JSON.stringify({ type: "interrupt" }));
    setAgentState("idle");
    nextPlayTime.current = 0;
  };

  const stateRing: Record<AgentState, string> = {
    idle: "",
    activated: "border-l-4 border-l-yellow-500",
    generating: "border-l-4 border-l-blue-500",
    playing: "border-l-4 border-l-green-500",
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <Card className={`gap-0 p-0 overflow-hidden ${stateRing[agentState]}`}>
        <div className="p-3 flex items-center justify-between border-b">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Qwen3-TTS Voice Agent</span>
            <Badge
              variant={connState === "connected" ? "default" : "outline"}
              className="text-xs"
            >
              {connState === "connected" ? "Live" : connState}
            </Badge>
          </div>
          <div className="flex gap-2">
            {connState === "connected" && (
              <>
                <Button
                  size="sm"
                  variant={isListening ? "destructive" : "outline"}
                  onClick={isListening ? stopListening : startListening}
                  className="h-7 px-2 text-xs gap-1"
                >
                  {isListening ? (
                    <MicOff className="w-3 h-3" />
                  ) : (
                    <Mic className="w-3 h-3" />
                  )}
                  <span className="hidden sm:inline">
                    {isListening ? "Stop Mic" : "Start Mic"}
                  </span>
                </Button>
                {agentState !== "idle" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleInterrupt}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span className="hidden sm:inline">Reset</span>
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              variant={connState === "connected" ? "outline" : "default"}
              onClick={
                connState === "connected" ? disconnect : connect
              }
              className="h-7 px-2 text-xs gap-1"
            >
              {connState === "connected" ? (
                <><WifiOff className="w-3 h-3" /><span className="hidden sm:inline">Disconnect</span></>
              ) : (
                <><Wifi className="w-3 h-3" /><span className="hidden sm:inline">Connect</span></>
              )}
            </Button>
          </div>
        </div>

        <div className="p-3 flex items-center gap-3">
          {agentState === "generating" && (
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
          )}
          {agentState === "playing" && (
            <Volume2 className="w-3.5 h-3.5 animate-pulse text-green-500 shrink-0" />
          )}
          {agentState === "activated" && (
            <Zap className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
          )}
          <p className="text-xs text-muted-foreground flex-1 truncate">
            {statusMsg}
          </p>
          <AudioVisualizer level={audioLevel} isActive={agentState === "playing"} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsMuted((m) => !m)}
            className="h-6 w-6 p-0 shrink-0"
          >
            {isMuted ? (
              <VolumeX className="w-3 h-3" />
            ) : (
              <Volume2 className="w-3 h-3" />
            )}
          </Button>
        </div>

        {lastResponse && (
          <div className="px-3 pb-3 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Last response: </span>
              {lastResponse}
            </p>
          </div>
        )}
      </Card>

      {/* Setup panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <VoiceCloneSetup
          profile={voiceProfile}
          onChange={setVoiceProfile}
          isConnected={connState === "connected"}
        />
        <WakeWordConfig
          config={agentConfig}
          onChange={setAgentConfig}
          isConnected={connState === "connected"}
        />
      </div>

      {/* Live transcription with hook highlighting */}
      <LiveTranscriptionPanel
        transcripts={transcripts}
        hookWord={agentConfig.hookWord}
        agentState={agentState}
      />
    </div>
  );
}
