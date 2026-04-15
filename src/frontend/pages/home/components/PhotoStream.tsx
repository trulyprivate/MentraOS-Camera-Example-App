import { Camera, Image, Utensils } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui";

export interface Detection {
  label: string;
  classId: number;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
  kind: "food" | "tableware";
}

export interface Photo {
  id: string;
  url: string;
  timestamp: string;
  requestId: string;
  detections?: Detection[] | null;
  width?: number | null;
  height?: number | null;
}

interface PhotoStreamProps {
  photos: Photo[];
}

export function PhotoStream({ photos }: PhotoStreamProps) {
  // Count food-class detections across all photos for the header summary.
  const foodCount = photos.reduce(
    (sum, p) => sum + (p.detections?.filter((d) => d.kind === "food").length ?? 0),
    0,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Food Scanner</CardTitle>
          </div>
          {foodCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              <Utensils className="w-3 h-3" />
              {foodCount} food{foodCount === 1 ? "" : "s"} detected
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {photos.length} captured — YOLO11 food detection
        </CardDescription>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <div className="text-center py-10">
            <div className="inline-flex p-3 rounded-xl bg-muted mb-3">
              <Image className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Point your glasses at food and tap to capture
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Detected items will be labeled with bounding boxes
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PhotoCard({ photo }: { photo: Photo }) {
  const foods = (photo.detections ?? []).filter((d) => d.kind === "food");
  const pending = photo.detections === null || photo.detections === undefined;

  return (
    <div className="space-y-2 animate-photo-in">
      <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
        <img
          src={photo.url}
          alt={`Captured at ${photo.timestamp}`}
          className="w-full h-full object-cover"
        />
        {photo.width && photo.height && (
          <DetectionOverlay
            detections={photo.detections ?? []}
            imgWidth={photo.width}
            imgHeight={photo.height}
          />
        )}
        <div className="absolute top-2 right-2">
          <span className="text-[10px] text-white font-mono bg-black/60 px-1.5 py-0.5 rounded">
            {photo.timestamp}
          </span>
        </div>
      </div>

      {/* Label chips below each photo */}
      <div className="flex flex-wrap gap-1.5 min-h-[22px]">
        {pending && (
          <span className="text-xs text-muted-foreground italic">
            Analyzing with YOLO11…
          </span>
        )}
        {!pending && foods.length === 0 && (
          <span className="text-xs text-muted-foreground italic">
            No food detected
          </span>
        )}
        {foods.map((d, i) => (
          <Badge
            key={`${d.label}-${i}`}
            variant="secondary"
            className="text-xs gap-1"
            style={{ borderLeft: `3px solid ${colorFor(d.label)}` }}
          >
            <Utensils className="w-3 h-3" />
            {d.label}
            <span className="opacity-60">
              {(d.confidence * 100).toFixed(0)}%
            </span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders bounding boxes over the image using the original pixel coords scaled
 * to the rendered box (we use percentages, so it scales automatically).
 */
function DetectionOverlay({
  detections,
  imgWidth,
  imgHeight,
}: {
  detections: Detection[];
  imgWidth: number;
  imgHeight: number;
}) {
  if (!detections.length) return null;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${imgWidth} ${imgHeight}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {detections.map((d, i) => {
        const color = colorFor(d.label);
        const labelText = `${d.label} ${(d.confidence * 100).toFixed(0)}%`;
        // Rough label background sizing — tuned for viewBox pixel units.
        const fontSize = Math.max(14, Math.min(imgWidth, imgHeight) * 0.025);
        const padding = fontSize * 0.35;
        const labelW = labelText.length * fontSize * 0.55 + padding * 2;
        const labelH = fontSize + padding * 2;
        return (
          <g key={i}>
            <rect
              x={d.box.x}
              y={d.box.y}
              width={d.box.width}
              height={d.box.height}
              fill="none"
              stroke={color}
              strokeWidth={Math.max(2, imgWidth * 0.004)}
            />
            <rect
              x={d.box.x}
              y={Math.max(0, d.box.y - labelH)}
              width={labelW}
              height={labelH}
              fill={color}
              opacity={0.85}
            />
            <text
              x={d.box.x + padding}
              y={Math.max(0, d.box.y - labelH) + fontSize + padding * 0.3}
              fill="white"
              fontSize={fontSize}
              fontFamily="system-ui, sans-serif"
              fontWeight="600"
            >
              {labelText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Stable color per label, so the same food gets the same box color. */
function colorFor(label: string): string {
  // Palette picked for good contrast on photos.
  const palette = [
    "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
    "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  ];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}
