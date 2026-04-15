/**
 * API Route Definitions
 *
 * Maps HTTP methods + paths to handler functions.
 * Each handler lives in its own file under api/.
 */

import { Hono } from "hono";
import { getHealth } from "../api/health";
import { photoStream, transcriptionStream } from "../api/stream";
import { speak, stopAudio } from "../api/audio";
import { getThemePreference, setThemePreference } from "../api/storage";
import {
  getLatestPhoto,
  getPhotoData,
  getPhotoBase64,
  getPhotoDetections,
} from "../api/photo";
import { getLiveScanStatus, setLiveScanStatus } from "../api/live-scan";

export const api = new Hono();

// Health
api.get("/health", getHealth);

// SSE streams
api.get("/photo-stream", photoStream);
api.get("/transcription-stream", transcriptionStream);

// Audio
api.post("/speak", speak);
api.post("/stop-audio", stopAudio);

// Storage / preferences
api.get("/theme-preference", getThemePreference);
api.post("/theme-preference", setThemePreference);

// Photos
api.get("/latest-photo", getLatestPhoto);
api.get("/photo/:requestId", getPhotoData);
api.get("/photo-base64/:requestId", getPhotoBase64);

// Food detections (YOLO11)
api.get("/detections/:requestId", getPhotoDetections);

// Live Scan mode (continuous photo capture for pseudo-live video detection)
api.get("/live-scan", getLiveScanStatus);
api.post("/live-scan", setLiveScanStatus);
