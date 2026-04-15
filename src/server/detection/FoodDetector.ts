/**
 * FoodDetector — YOLO11-based food detection pipeline.
 *
 * Runs the latest Ultralytics YOLO11n model via ONNX Runtime, filters the
 * raw predictions down to food-relevant COCO classes, and returns bounding
 * boxes + confidence scores per detected food item.
 *
 * The model is downloaded once at startup and cached under ./models/.
 * Inference happens in-process so the example app stays self-contained.
 */

import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** COCO class index → class name (standard 80-class ordering used by YOLO). */
export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
  "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter",
  "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear",
  "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase",
  "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat",
  "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
  "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut",
  "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet",
  "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave",
  "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
  "scissors", "teddy bear", "hair drier", "toothbrush",
] as const;

/**
 * COCO class indices considered "food".
 *
 * YOLO trained on COCO only knows 10 canonical food classes. We also surface
 * tableware (bowl, cup, fork, knife, spoon, wine glass, bottle) as food-adjacent
 * hints — useful for "is there food in this scene?" signals.
 */
export const FOOD_CLASS_INDICES = new Set<number>([
  46, // banana
  47, // apple
  48, // sandwich
  49, // orange
  50, // broccoli
  51, // carrot
  52, // hot dog
  53, // pizza
  54, // donut
  55, // cake
]);

/** Tableware classes that hint at food context. Off by default. */
export const TABLEWARE_CLASS_INDICES = new Set<number>([
  39, // bottle
  40, // wine glass
  41, // cup
  42, // fork
  43, // knife
  44, // spoon
  45, // bowl
]);

export interface Detection {
  /** Class label, e.g. "pizza" */
  label: string;
  /** COCO class index */
  classId: number;
  /** Confidence score in [0, 1] */
  confidence: number;
  /** Bounding box in original-image pixel coords (x, y = top-left) */
  box: { x: number; y: number; width: number; height: number };
  /** Whether this is a canonical food class or tableware hint */
  kind: "food" | "tableware";
}

/**
 * Default YOLO11n ONNX model (Ultralytics, ~10MB, 80 COCO classes).
 *
 * Override with the YOLO_MODEL_URL environment variable if you want to plug in
 * a food-specific fine-tune — as long as it's a 640x640 Ultralytics export.
 */
const DEFAULT_MODEL_URL =
  "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.onnx";

const MODEL_DIR = resolve(process.cwd(), "models");
const MODEL_PATH = resolve(MODEL_DIR, "yolo11n.onnx");

const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.45;

export class FoodDetector {
  private session: ort.InferenceSession | null = null;
  private loading: Promise<void> | null = null;
  private includeTableware = false;

  constructor(opts: { includeTableware?: boolean } = {}) {
    this.includeTableware = opts.includeTableware ?? false;
  }

  /** Kick off model load; callers can await this explicitly or lazily via detect(). */
  async load(): Promise<void> {
    if (this.session) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      await ensureModelDownloaded();
      console.log(`🧠 Loading YOLO11 model from ${MODEL_PATH}`);
      this.session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
      console.log(`✅ YOLO11 model ready (inputs: ${this.session.inputNames.join(", ")})`);
    })();

    return this.loading;
  }

  /** Run food detection on a raw image buffer (JPEG/PNG/etc). */
  async detect(imageBuffer: Buffer): Promise<DetectionResult> {
    await this.load();
    if (!this.session) throw new Error("YOLO session not initialized");

    // Preprocess: resize with letterbox to 640x640, normalize to [0, 1], CHW layout
    const { tensor, origWidth, origHeight, padX, padY, scale } =
      await preprocess(imageBuffer);

    const inputName = this.session.inputNames[0];
    const outputs = await this.session.run({ [inputName]: tensor });
    const outputName = this.session.outputNames[0];
    const output = outputs[outputName];

    // YOLO11 output: [1, 84, 8400] — 84 = 4 bbox coords + 80 class scores
    const raw = output.data as Float32Array;
    const dims = output.dims as number[];
    const numClasses = dims[1] - 4; // 80
    const numBoxes = dims[2]; // 8400

    const candidates: Detection[] = [];
    const allowedClasses = this.includeTableware
      ? new Set([...FOOD_CLASS_INDICES, ...TABLEWARE_CLASS_INDICES])
      : FOOD_CLASS_INDICES;

    for (let i = 0; i < numBoxes; i++) {
      // Find best class for this anchor
      let bestScore = 0;
      let bestClass = -1;
      for (let c = 0; c < numClasses; c++) {
        if (!allowedClasses.has(c)) continue;
        const score = raw[(4 + c) * numBoxes + i];
        if (score > bestScore) {
          bestScore = score;
          bestClass = c;
        }
      }

      if (bestClass < 0 || bestScore < CONFIDENCE_THRESHOLD) continue;

      // Bbox is in 640x640 letterboxed coords — cx, cy, w, h
      const cx = raw[0 * numBoxes + i];
      const cy = raw[1 * numBoxes + i];
      const w = raw[2 * numBoxes + i];
      const h = raw[3 * numBoxes + i];

      // Unletterbox → original image coords
      const x = (cx - w / 2 - padX) / scale;
      const y = (cy - h / 2 - padY) / scale;
      const bw = w / scale;
      const bh = h / scale;

      candidates.push({
        label: COCO_CLASSES[bestClass],
        classId: bestClass,
        confidence: bestScore,
        box: {
          x: Math.max(0, Math.min(origWidth, x)),
          y: Math.max(0, Math.min(origHeight, y)),
          width: Math.max(0, Math.min(origWidth - x, bw)),
          height: Math.max(0, Math.min(origHeight - y, bh)),
        },
        kind: FOOD_CLASS_INDICES.has(bestClass) ? "food" : "tableware",
      });
    }

    return {
      detections: nonMaxSuppression(candidates, IOU_THRESHOLD),
      width: origWidth,
      height: origHeight,
    };
  }
}

export interface DetectionResult {
  detections: Detection[];
  width: number;
  height: number;
}

/** Letterbox-resize to 640x640 and lay out as CHW Float32. */
async function preprocess(imageBuffer: Buffer): Promise<{
  tensor: ort.Tensor;
  origWidth: number;
  origHeight: number;
  padX: number;
  padY: number;
  scale: number;
}> {
  const image = sharp(imageBuffer).rotate(); // respect EXIF orientation
  const metadata = await image.metadata();
  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;
  if (!origWidth || !origHeight) {
    throw new Error("Could not read image dimensions");
  }

  const scale = Math.min(INPUT_SIZE / origWidth, INPUT_SIZE / origHeight);
  const newWidth = Math.round(origWidth * scale);
  const newHeight = Math.round(origHeight * scale);
  const padX = Math.floor((INPUT_SIZE - newWidth) / 2);
  const padY = Math.floor((INPUT_SIZE - newHeight) / 2);

  const resized = await image
    .resize(newWidth, newHeight, { fit: "fill" })
    .extend({
      top: padY,
      bottom: INPUT_SIZE - newHeight - padY,
      left: padX,
      right: INPUT_SIZE - newWidth - padX,
      background: { r: 114, g: 114, b: 114 }, // YOLO's standard gray pad
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  // resized is HWC uint8 (RGB). Convert to CHW float32 normalized to [0,1].
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    chw[i] = resized[i * 3] / 255; // R
    chw[plane + i] = resized[i * 3 + 1] / 255; // G
    chw[2 * plane + i] = resized[i * 3 + 2] / 255; // B
  }

  const tensor = new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, origWidth, origHeight, padX, padY, scale };
}

/** Class-aware non-maximum suppression. */
function nonMaxSuppression(detections: Detection[], iouThreshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];

  for (const det of sorted) {
    let overlap = false;
    for (const k of kept) {
      if (k.classId !== det.classId) continue;
      if (iou(det.box, k.box) > iouThreshold) {
        overlap = true;
        break;
      }
    }
    if (!overlap) kept.push(det);
  }

  return kept;
}

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersect = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersect;
  return union > 0 ? intersect / union : 0;
}

/** Download the YOLO11n ONNX model on first run. */
async function ensureModelDownloaded(): Promise<void> {
  if (existsSync(MODEL_PATH)) return;

  const url = process.env.YOLO_MODEL_URL || DEFAULT_MODEL_URL;
  console.log(`⬇️  Downloading YOLO model from ${url} ...`);
  mkdirSync(MODEL_DIR, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download YOLO model (${res.status}): ${url}`);
  }
  const ab = await res.arrayBuffer();
  await writeFile(MODEL_PATH, Buffer.from(ab));
  console.log(`✅ Model downloaded to ${MODEL_PATH} (${(ab.byteLength / 1e6).toFixed(1)} MB)`);
}

/** Shared singleton — loading the model is expensive. */
export const foodDetector = new FoodDetector({
  includeTableware: process.env.YOLO_INCLUDE_TABLEWARE === "true",
});
