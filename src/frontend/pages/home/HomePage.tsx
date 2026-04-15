import { useState, useEffect, useCallback, useRef } from "react";
import { Camera, Zap, Terminal, Moon, Sun } from "lucide-react";
import {
  Badge,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui";
import { useTheme } from "../../App";
import { PhotoStream, type Photo } from "./components/PhotoStream";
import { AudioControls } from "./components/AudioControls";
import { LiveScanControl } from "./components/LiveScanControl";
import {
  TranscriptionFeed,
  type Transcription,
} from "./components/TranscriptionFeed";
import { SystemLogs, type Log } from "./components/SystemLogs";

interface HomePageProps {
  userId: string;
}

export default function HomePage({ userId }: HomePageProps) {
  const { isDarkMode, toggleTheme } = useTheme();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const logIdCounter = useRef(Date.now());

  const addLog = useCallback((message: string) => {
    setLogs((prev) =>
      [
        {
          id: logIdCounter.current++,
          message,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 20),
    );
  }, []);

  // Connect to SSE photo stream
  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connect = () => {
      try {
        eventSource = new EventSource(
          `/api/photo-stream?userId=${encodeURIComponent(userId)}`,
        );

        eventSource.onopen = () => addLog("Connected to photo stream");

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "connected") return;

            setPhotos((prev) => {
              const existing = prev.find((p) => p.requestId === data.requestId);
              const nextPhoto: Photo = {
                id: data.requestId,
                requestId: data.requestId,
                url: data.dataUrl,
                timestamp: new Date(data.timestamp).toLocaleTimeString(),
                detections: data.detections ?? null,
                width: data.width ?? null,
                height: data.height ?? null,
              };

              if (existing) {
                // Second broadcast for this photo — YOLO results just arrived.
                if (data.detections) {
                  const foodNames = (data.detections as Photo["detections"])
                    ?.filter((d) => d?.kind === "food")
                    .map((d) => d!.label);
                  if (foodNames && foodNames.length > 0) {
                    addLog(`Food detected: ${Array.from(new Set(foodNames)).join(", ")}`);
                  } else {
                    addLog("No food detected in last photo");
                  }
                }
                return prev.map((p) =>
                  p.requestId === data.requestId ? nextPhoto : p,
                );
              }

              addLog(
                `Photo captured at ${new Date(data.timestamp).toLocaleTimeString()}`,
              );
              return [nextPhoto, ...prev].slice(0, 6);
            });
          } catch {}
        };

        eventSource.onerror = () => {
          addLog("Photo stream disconnected, reconnecting...");
          eventSource?.close();
          setTimeout(connect, 3000);
        };
      } catch {
        addLog("Failed to connect to photo stream");
      }
    };

    connect();
    return () => eventSource?.close();
  }, [addLog, userId]);

  // Connect to SSE transcription stream
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let idCounter = Date.now();

    const connect = () => {
      try {
        eventSource = new EventSource(
          `/api/transcription-stream?userId=${encodeURIComponent(userId)}`,
        );

        eventSource.onopen = () => addLog("Connected to transcription stream");

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "connected") return;

            setTranscriptions((prev) => {
              const entry = {
                id: idCounter++,
                text: data.text,
                time: new Date(data.timestamp).toLocaleTimeString(),
                isFinal: data.isFinal,
              };

              if (data.isFinal) {
                if (prev.length > 0 && !prev[0].isFinal) {
                  const updated = [...prev];
                  updated[0] = { ...updated[0], ...entry, id: updated[0].id };
                  return updated.slice(0, 10);
                }
                return [entry, ...prev].slice(0, 10);
              } else {
                if (prev.length === 0 || prev[0].isFinal) {
                  return [entry, ...prev].slice(0, 10);
                }
                const updated = [...prev];
                updated[0] = { ...updated[0], ...entry, id: updated[0].id };
                return updated;
              }
            });
          } catch {}
        };

        eventSource.onerror = () => {
          addLog("Transcription stream disconnected, reconnecting...");
          eventSource?.close();
          setTimeout(connect, 3000);
        };
      } catch {
        addLog("Failed to connect to transcription stream");
      }
    };

    connect();
    return () => eventSource?.close();
  }, [addLog, userId]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Camera className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">YOLO Food Scanner</h1>
            <p className="text-xs text-muted-foreground">MentraOS · YOLO11</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono text-xs">
            {userId?.substring(0, 8)}...
          </Badge>
          <div className="flex items-center gap-2">
            <Sun className="w-3.5 h-3.5 text-muted-foreground" />
            <Switch checked={isDarkMode} onCheckedChange={toggleTheme} />
            <Moon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Live Scan toggle */}
      <LiveScanControl userId={userId} onLog={addLog} />

      {/* Photo Stream */}
      <PhotoStream photos={photos} />

      {/* Audio Controls */}
      <AudioControls userId={userId} onLog={addLog} />

      {/* Transcriptions & Logs */}
      <Tabs defaultValue="transcriptions">
        <TabsList className="w-full">
          <TabsTrigger value="transcriptions" className="flex-1">
            <Zap className="w-3.5 h-3.5" />
            Transcriptions
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex-1">
            <Terminal className="w-3.5 h-3.5" />
            System Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcriptions">
          <TranscriptionFeed transcriptions={transcriptions} />
        </TabsContent>

        <TabsContent value="logs">
          <SystemLogs logs={logs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
