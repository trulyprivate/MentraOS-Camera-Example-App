import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Video } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
} from "../../../components/ui";

interface LiveScanControlProps {
  userId: string;
  onLog: (message: string) => void;
}

interface LiveScanStatus {
  active: boolean;
  intervalMs: number;
  frames: number;
  elapsedMs: number;
  fps: number;
}

/**
 * Start/stop button for Live Scan (continuous photo capture + YOLO food
 * detection). Polls /api/live-scan once per second while the view is open so
 * the FPS indicator stays accurate even when toggled from the glasses
 * (double-tap).
 */
export function LiveScanControl({ userId, onLog }: LiveScanControlProps) {
  const [status, setStatus] = useState<LiveScanStatus>({
    active: false,
    intervalMs: 1200,
    frames: 0,
    elapsedMs: 0,
    fps: 0,
  });
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/live-scan?userId=${encodeURIComponent(userId)}`,
      );
      if (!res.ok) return;
      const next: LiveScanStatus = await res.json();
      setStatus(next);
    } catch {
      /* transient — ignore */
    }
  }, [userId]);

  useEffect(() => {
    fetchStatus();
    pollRef.current = window.setInterval(fetchStatus, 1000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  const toggle = useCallback(async () => {
    setBusy(true);
    const nextActive = !status.active;
    try {
      const res = await fetch("/api/live-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, enabled: nextActive }),
      });
      if (res.ok) {
        const next: LiveScanStatus = await res.json();
        setStatus(next);
        onLog(nextActive ? "Live Scan started" : "Live Scan stopped");
      } else {
        const err = await res.json().catch(() => ({}));
        onLog(`Live Scan error: ${err.error ?? res.status}`);
      }
    } catch (e) {
      onLog(`Live Scan error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [status.active, userId, onLog]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Live Video Scan</CardTitle>
          </div>
          {status.active && (
            <Badge variant="secondary" className="text-xs gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE · {status.fps.toFixed(1)} fps
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Continuous YOLO food detection on a pseudo-live feed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Button
            onClick={toggle}
            disabled={busy}
            variant={status.active ? "destructive" : "default"}
            className="gap-2"
          >
            {status.active ? (
              <>
                <Square className="w-3.5 h-3.5" /> Stop Live Scan
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" /> Start Live Scan
              </>
            )}
          </Button>
          <div className="text-xs text-muted-foreground">
            {status.active ? (
              <>
                {status.frames} frame{status.frames === 1 ? "" : "s"} ·
                interval {status.intervalMs}ms
              </>
            ) : (
              <>Tip: double-tap your glasses temple to toggle</>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
