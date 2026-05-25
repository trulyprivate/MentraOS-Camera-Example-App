interface AudioVisualizerProps {
  level: number;
  isActive: boolean;
}

export default function AudioVisualizer({ level, isActive }: AudioVisualizerProps) {
  const bars = 5;
  return (
    <div className="flex items-center gap-0.5 h-5">
      {Array.from({ length: bars }, (_, i) => {
        const threshold = (i + 1) / bars;
        const lit = isActive && level >= threshold;
        return (
          <div
            key={i}
            className={`w-1 rounded-sm transition-all duration-75 ${
              lit ? "bg-green-500" : "bg-muted-foreground/20"
            }`}
            style={{ height: `${40 + i * 12}%` }}
          />
        );
      })}
    </div>
  );
}
