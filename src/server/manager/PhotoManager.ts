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

  constructor(private user: User) {}

  /** Capture a photo from the glasses and store + broadcast it */
  async takePhoto(): Promise<void> {
    const session = this.user.appSession;
    if (!session) throw new Error("No active glasses session");

    const photo = await session.camera.requestPhoto();

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

  addSSEClient(client: SSEWriter): void {
    this.sseClients.add(client);
  }

  removeSSEClient(client: SSEWriter): void {
    this.sseClients.delete(client);
  }

  /** Tear down — clear photos, SSE clients, and in-view tracking */
  destroy(): void {
    this.photos.clear();
    this.sseClients.clear();
    this.foodsInView.clear();
  }
}

