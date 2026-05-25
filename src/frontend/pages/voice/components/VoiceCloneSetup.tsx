import { useState, useRef } from "react";
import { Mic, Upload, Square, Play, Trash2, Check } from "lucide-react";
import { Card, Button, Input } from "../../../components/ui";
import type { VoiceProfile } from "./VoiceAgentStudio";

interface VoiceCloneSetupProps {
  profile: VoiceProfile;
  onChange: (profile: VoiceProfile) => void;
  isConnected: boolean;
}

export default function VoiceCloneSetup({
  profile,
  onChange,
  isConnected,
}: VoiceCloneSetupProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);

  const blobToB64 = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
    });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunks.current = [];
      recorder.ondataavailable = (e) => audioChunks.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks.current, { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        const b64 = await blobToB64(blob);
        onChange({ ...profile, audioBlobUrl: blobUrl, audioB64: b64 });
      };
      recorder.start();
      mediaRecorder.current = recorder;
      setIsRecording(true);
    } catch (e) {
      console.error("Mic access denied:", e);
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    mediaRecorder.current = null;
    setIsRecording(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    const b64 = await blobToB64(file);
    onChange({ ...profile, audioBlobUrl: blobUrl, audioB64: b64 });
    e.target.value = "";
  };

  const togglePlayback = () => {
    if (!profile.audioBlobUrl) return;
    if (audioEl.current) {
      audioEl.current.pause();
      audioEl.current = null;
      setIsPlaying(false);
      return;
    }
    const audio = new Audio(profile.audioBlobUrl);
    audioEl.current = audio;
    audio.onended = () => {
      audioEl.current = null;
      setIsPlaying(false);
    };
    audio.play();
    setIsPlaying(true);
  };

  const clearProfile = () => {
    if (profile.audioBlobUrl) URL.revokeObjectURL(profile.audioBlobUrl);
    onChange({ audioBlobUrl: null, audioB64: null, refText: "" });
  };

  return (
    <Card className="gap-0 p-0">
      <div className="p-3 flex items-center gap-2 border-b">
        <Mic className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Voice Clone Sample</span>
        {profile.audioB64 && (
          <Check className="w-3.5 h-3.5 text-green-500 ml-auto" />
        )}
      </div>
      <div className="p-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Record or upload 5–30 seconds of clear speech. This sample will be
          cloned by Qwen3-TTS.
        </p>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isRecording ? "destructive" : "outline"}
            onClick={isRecording ? stopRecording : startRecording}
            className="flex-1 h-8 text-xs"
          >
            {isRecording ? (
              <>
                <Square className="w-3 h-3 animate-pulse" />Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-3 h-3" />Record
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            className="flex-1 h-8 text-xs"
          >
            <Upload className="w-3 h-3" />
            Upload WAV / MP3
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {profile.audioBlobUrl && (
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
            <span className="flex-1 text-xs text-muted-foreground">
              Voice sample ready
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={togglePlayback}
              className="h-6 w-6 p-0"
            >
              <Play
                className={`w-3 h-3 ${
                  isPlaying ? "text-green-500" : ""
                }`}
              />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearProfile}
              className="h-6 w-6 p-0"
            >
              <Trash2 className="w-3 h-3 text-destructive" />
            </Button>
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Reference text (optional — transcript of the sample)
          </label>
          <Input
            value={profile.refText}
            onChange={(e) => onChange({ ...profile, refText: e.target.value })}
            placeholder="What the sample audio says..."
            className="h-7 text-xs"
          />
        </div>

        {!profile.audioB64 && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400">
            No sample — responses will use demo audio until a sample is provided.
          </p>
        )}
      </div>
    </Card>
  );
}
