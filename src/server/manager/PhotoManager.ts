import type { User } from "../session/User";
import { foodDetector, type Detection } from "../detection/FoodDetector";

export interface StoredPhoto {
  requestId: string;
  buffer: Buffer;
  timestamp: Date;
  userId: string;
  mimeType: string;
  filename: string;
  size: number;
  /** YOLO food detections. `undefined` while inference is still running. */
  detections?: Detection[];
  /** Dimensions of the stored image, needed to render overlays. */
  width?: number;
  height?: number;
}

interface SSEWriter {
  write: (data: string) => void;
  userId: string;
  close: () => void;
}

/**
 * PhotoManager — captures, stores, and broadcasts photos for a single user.
 *
 * Each captured photo is pushed through the YOLO food detector; results are
 * attached to the StoredPhoto and re-broadcast once ready.
 */
export class PhotoManager {
  private photos: Map<string, StoredPhoto> = new Map();
  private sseClients: Set<SSEWriter> = new Set();
  /**
   * Labels currently considered "in view" for this user. A label is added
   * when it first appears in a detection and removed when a photo comes back
   * without it. This ensures we speak each food's name once per appearance.
   */
  private foodsInView: Set<string> = new Set();

  /** Live Scan state — continuous photo capture pretending to be a video feed. */
  private liveScanActive = false;
  private liveScanIntervalMs = 1200;
  private liveScanLoopPromise: Promise<void> | null = null;
  private liveScanFrames = 0;
  private liveScanStartedAt = 0;
  /** Upper bound on photos kept in memory — important for Live Scan. */
  private static readonly MAX_STORED_PHOTOS = 50;

  constructor(private user: User) {}

  /** Capture a photo from the glasses and store + broadcast it */
  async takePhoto(opts: { size?: "small" | "medium" | "large" | "full"; compress?: "none" | "medium" | "heavy" } = {}): Promise<void> {
    const session = this.user.appSession;
    if (!session) throw new Error("No active glasses session");

    const photo = await session.camera.requestPhoto({
      size: opts.size,
      compress: opts.compress,
    });

    const stored: StoredPhoto = {
      requestId: photo.requestId,
      buffer: photo.buffer,
      timestamp: photo.timestamp,
      userId: this.user.userId,
      mimeType: photo.mimeType,
      filename: photo.filename,
      size: photo.size,
    };

    this.photos.set(photo.requestId, stored);
    this.evictOldPhotos();
    // First broadcast: image only, detections still pending on the client
    this.broadcastPhoto(stored);
    console.log(
      `📸 Photo captured for ${this.user.userId} (${photo.size} bytes) — running YOLO food detection...`,
    );

    // Fire-and-forget detection so the UI can show the photo immediately.
    this.runDetection(stored).catch((err) => {
      console.error(
        `[YOLO] Detection failed for ${this.user.userId} / ${photo.requestId}:`,
        err,
      );
    });
  }

  /** Run YOLO on the photo, attach results, re-broadcast, and announce aloud. */
  private async runDetection(stored: StoredPhoto): Promise<void> {
    const { detections, width, height } = await foodDetector.detect(stored.buffer);

    stored.detections = detections;
    stored.width = width;
    stored.height = height;

    const foodNames = detections
      .filter((d) => d.kind === "food")
      .map((d) => d.label);

    console.log(
      `🍕 Detected ${detections.length} item(s) for ${this.user.userId}:`,
      detections.map((d) => `${d.label} (${(d.confidence * 100).toFixed(1)}%)`).join(", ") ||
        "none",
    );

    this.broadcastPhoto(stored);

    // Announce each newly-visible food once. Labels that were already in view
    // stay silent; labels that disappeared from view are cleared so they can
    // be re-announced the next time they show up.
    await this.announceNewFoods(foodNames);
  }

  /**
   * Speak the name of each food that just entered view (present now but not
   * in the previous frame). Removes labels that are no longer in view so a
   * re-appearance triggers a fresh announcement.
   */
  private async announceNewFoods(foodNames: string[]): Promise<void> {
    if (!this.user.appSession) return;

    const currentlyVisible = new Set(foodNames);
    const newlyVisible: string[] = [];

    for (const label of currentlyVisible) {
      if (!this.foodsInView.has(label)) newlyVisible.push(label);
    }

    // Drop labels that are no longer in view so they'll re-announce next time.
    for (const label of this.foodsInView) {
      if (!currentlyVisible.has(label)) this.foodsInView.delete(label);
    }
    for (const label of newlyVisible) this.foodsInView.add(label);

    if (newlyVisible.length === 0) return;

    console.log(
      `🔊 Announcing new foods for ${this.user.userId}: ${newlyVisible.join(", ")}`,
    );

    // Speak each new food's name individually, sequentially, so overlapping
    // TTS calls don't clip each other on the glasses speaker.
    for (const label of newlyVisible) {
      try {
        await this.user.audio.speak(label);
      } catch (err) {
        console.warn(`[YOLO] Could not speak "${label}":`, err);
      }
    }
  }

  /**
   * Start continuous photo capture (a.k.a. "Live Scan"). Uses small+heavily
   * compressed photos so each round-trip stays fast, giving a pseudo-video
   * feed with YOLO detections on every frame.
   *
   * Already running? Returns immediately. Already-in-view labels won't be
   * re-announced thanks to the delta logic in announceNewFoods().
   */
  startLiveScan(intervalMs?: number): void {
    if (this.liveScanActive) return;
    if (!this.user.appSession) {
      console.warn(`[LiveScan] Cannot start — no glasses session for ${this.user.userId}`);
      return;
    }
    this.liveScanActive = true;
    this.liveScanIntervalMs = Math.max(500, intervalMs ?? 1200);
    this.liveScanFrames = 0;
    this.liveScanStartedAt = Date.now();
    console.log(
      `🎥 Live Scan started for ${this.user.userId} (interval ${this.liveScanIntervalMs}ms)`,
    );
    this.liveScanLoopPromise = this.liveScanLoop();
  }

  /** Stop continuous photo capture. Safe to call if not running. */
  stopLiveScan(): void {
    if (!this.liveScanActive) return;
    this.liveScanActive = false;
    // Clear in-view tracking so the next session starts fresh.
    this.foodsInView.clear();
    console.log(`🛑 Live Scan stopped for ${this.user.userId}`);
  }

  /** Snapshot of current live-scan state for the UI/API. */
  getLiveScanStatus(): {
    active: boolean;
    intervalMs: number;
    frames: number;
    elapsedMs: number;
    fps: number;
  } {
    const elapsedMs = this.liveScanActive ? Date.now() - this.liveScanStartedAt : 0;
    const fps = elapsedMs > 0 ? this.liveScanFrames / (elapsedMs / 1000) : 0;
    return {
      active: this.liveScanActive,
      intervalMs: this.liveScanIntervalMs,
      frames: this.liveScanFrames,
      elapsedMs,
      fps: Math.round(fps * 10) / 10,
    };
  }

  /**
   * Loop that drives Live Scan. Captures, waits for the configured interval
   * (measured from the start of the capture so slow captures don't pile up),
   * and exits cleanly when liveScanActive is flipped off.
   */
  private async liveScanLoop(): Promise<void> {
    while (this.liveScanActive) {
      const iterationStart = Date.now();
      try {
        // Small + heavy compression → lowest-latency frames for pseudo-live.
        await this.takePhoto({ size: "small", compress: "heavy" });
        this.liveScanFrames++;
      } catch (err) {
        console.error(`[LiveScan] Frame capture failed for ${this.user.userId}:`, err);
        // Back off a bit on error to avoid tight-loop spamming the glasses.
        await sleep(1000);
      }

      if (!this.liveScanActive) break;

      // If the user disconnected, stop the loop cleanly.
      if (!this.user.appSession) {
        this.liveScanActive = false;
        console.log(`[LiveScan] Glasses session gone for ${this.user.userId} — stopping`);
        break;
      }

      const spent = Date.now() - iterationStart;
      const wait = Math.max(0, this.liveScanIntervalMs - spent);
      if (wait > 0) await sleep(wait);
    }
    this.liveScanLoopPromise = null;
  }

  /** Push a photo (and any detections so far) to all connected SSE clients */
  broadcastPhoto(photo: StoredPhoto): void {
    const base64Data = photo.buffer.toString("base64");
    const payload = JSON.stringify({
      requestId: photo.requestId,
      timestamp: photo.timestamp.getTime(),
      mimeType: photo.mimeType,
      filename: photo.filename,
      size: photo.size,
      userId: photo.userId,
      base64: base64Data,
      dataUrl: `data:${photo.mimeType};base64,${base64Data}`,
      detections: photo.detections ?? null,
      width: photo.width ?? null,
      height: photo.height ?? null,
    });

    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  getPhoto(requestId: string): StoredPhoto | undefined {
    return this.photos.get(requestId);
  }

  /** All photos for this user, sorted newest-first */
  getAll(): StoredPhoto[] {
    return Array.from(this.photos.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
  }

  /** The full photos map (used by SSE to send history on connect) */
  getAllMap(): Map<string, StoredPhoto> {
    return this.photos;
  }

  removeAll(): void {
    this.photos.clear();
  }

  /** Drop the oldest stored photos once we exceed MAX_STORED_PHOTOS. */
  private evictOldPhotos(): void {
    const overflow = this.photos.size - PhotoManager.MAX_STORED_PHOTOS;
    if (overflow <= 0) return;
    // Map iteration order is insertion order, so the first N keys are oldest.
    const it = this.photos.keys();
    for (let i = 0; i < overflow; i++) {
      const key = it.next().value;
      if (key) this.photos.delete(key);
    }
  }

  addSSEClient(client: SSEWriter): void {
    this.sseClients.add(client);
  }

  removeSSEClient(client: SSEWriter): void {
    this.sseClients.delete(client);
  }

  /** Tear down — stop live scan, clear photos, SSE clients, and in-view tracking */
  destroy(): void {
    this.stopLiveScan();
    this.photos.clear();
    this.sseClients.clear();
    this.foodsInView.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

