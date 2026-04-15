# MentraOS-Camera-Example-App — YOLO Food Scanner

A fork of the MentraOS Camera Example App that turns your MentraOS glasses into
a real-time **food scanner**. Every photo you capture is run through the latest
Ultralytics **YOLO11** object detector, filtered down to food classes, and
displayed in the webview with bounding boxes + confidence scores. The glasses
also speak out what they see ("I see a pizza and a cup of coffee.").

## What it does

1. You tap the right temple / press the camera button on your glasses.
2. The photo is streamed to the server.
3. The server runs YOLO11 (ONNX) locally and extracts food detections.
4. The webview shows the photo with colored bounding boxes around each food
   item, labeled with the food name and confidence (e.g. `pizza 91%`).
5. The glasses speak the name of each food as it first enters view —
   each label is announced **once per appearance** (no re-announcing while
   the food stays visible across subsequent frames).

### Live Video Scan

Two modes are available:

- **Single capture** — tap temple / button → one photo → detections.
- **Live Scan** — continuous capture loop (default ~1.2s interval) that gives
  a pseudo-live video feed. Each new food entering view is spoken once.
  Toggle it from the webview ("Start Live Scan" button) or by **double-tapping**
  your glasses temple.

Live Scan uses small/heavily-compressed photos for low latency. Actual FPS
depends on your glasses → cloud → server round-trip (typically 0.5–2 fps on
Mentra glasses).

Supported food classes out-of-the-box (COCO dataset):

> banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake

Plug in a fine-tuned Ultralytics ONNX model via `YOLO_MODEL_URL` to expand the
vocabulary (e.g. a [Food101](https://data.vision.ee.ethz.ch/cvl/datasets_extra/food-101/)
fine-tune).

## Setup

### Install MentraOS on your phone

[mentra.glass/install](https://mentra.glass/install)

### Set up ngrok

1. `brew install ngrok`
2. Make an ngrok account
3. [Create a static URL](https://dashboard.ngrok.com/)

### Register your App with MentraOS

1. Go to [console.mentra.glass](https://console.mentra.glass/)
2. Sign in with your MentraOS account
3. Click "Create App"
4. Set a unique package name like `com.yourName.foodScanner`
5. For "Public URL", enter your ngrok static URL
6. Add the **microphone** permission (needed for TTS feedback)

### Run the app

1. [Install Bun](https://bun.sh/docs/installation)
2. Clone and install:
   ```
   git clone https://github.com/Mentra-Community/MentraOS-Camera-Example-App
   cd MentraOS-Camera-Example-App
   bun install
   ```
3. Set up environment variables:
   ```
   cp .env.example .env
   ```
   Edit `.env`:
   ```
   PORT=3000
   PACKAGE_NAME=com.yourName.foodScanner
   MENTRAOS_API_KEY=your_api_key_from_console
   # Optional — use a different YOLO ONNX export
   # YOLO_MODEL_URL=https://example.com/my-food-yolo.onnx
   # Include tableware (bowls, cups, forks, etc.) as food-adjacent detections
   # YOLO_INCLUDE_TABLEWARE=true
   ```
4. Run:
   ```
   bun run dev
   ```
5. Expose to the internet:
   ```
   ngrok http --url=<YOUR_NGROK_URL_HERE> 3000
   ```

On first run the server downloads `yolo11n.onnx` (~10MB) into `./models/`. The
model is cached locally — subsequent runs skip the download.

## API

- `GET /api/latest-photo?userId=...` — latest photo metadata **including detections**
- `GET /api/photo/:requestId?userId=...` — raw image bytes
- `GET /api/detections/:requestId?userId=...` — just the YOLO detections for a photo
- `GET /api/photo-stream?userId=...` — SSE stream of photos + detections (UI uses this)
- `GET /api/live-scan?userId=...` — current Live Scan status (active, fps, frames)
- `POST /api/live-scan` — body `{ userId, enabled, intervalMs? }` to start/stop Live Scan

Each detection is shaped like:
```json
{
  "label": "pizza",
  "classId": 53,
  "confidence": 0.912,
  "box": { "x": 120, "y": 80, "width": 300, "height": 220 },
  "kind": "food"
}
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `YOLO_MODEL_URL` | Ultralytics yolo11n.onnx release asset | Override the ONNX model |
| `YOLO_INCLUDE_TABLEWARE` | `false` | Also surface bowls/cups/forks/etc. |

## Architecture

- `src/server/detection/FoodDetector.ts` — ONNX Runtime YOLO inference (letterbox preprocessing, NMS, COCO-class filtering).
- `src/server/manager/PhotoManager.ts` — captures photos, runs detection asynchronously, re-broadcasts over SSE.
- `src/frontend/pages/home/components/PhotoStream.tsx` — renders photos with SVG bounding-box overlays and food-label chips.

## Next steps

- Fine-tune YOLO on a food-specific dataset for broader coverage.
- Add nutritional info lookup by label (USDA FoodData Central).
- Pipe detections to [Roboflow](https://roboflow.com) or a database for logging.

Full docs: [docs.mentra.glass](https://docs.mentra.glass/camera)
