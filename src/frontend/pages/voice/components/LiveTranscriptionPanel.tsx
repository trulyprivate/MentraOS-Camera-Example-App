import { useRef, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { Card, ScrollArea } from "../../../components/ui";
import type { TranscriptEntry, AgentState } from "./VoiceAgentStudio";

interface LiveTranscriptionPanelProps {
  transcripts: TranscriptEntry[];
  hookWord: string;
  agentState: AgentState;
}

function highlightHook(text: string, hookWord: string): React.ReactNode {
  if (!hookWord) return text;
  const escaped = hookWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark
        key={i}
        className="bg-yellow-300 dark:bg-yellow-600 text-foreground rounded px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export default function LiveTranscriptionPanel({
  transcripts,
  hookWord,
  agentState,
}: LiveTranscriptionPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts.length]);

  const stateChipClass: Record<AgentState, string> = {
    idle: "hidden",
    activated:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    generating:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    playing:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };

  return (
    <Card className="gap-0 p-0">
      <div className="p-3 flex items-center gap-2 border-b">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Live Transcription</span>
        {agentState !== "idle" && (
          <span
            className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
              stateChipClass[agentState]
            }`}
          >
            {agentState}
          </span>
        )}
      </div>
      <ScrollArea className="h-52">
        <div className="p-3 space-y-1.5">
          {transcripts.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Connect the agent and start speaking — transcriptions appear here.
            </p>
          )}
          {[...transcripts].map((t) => (
            <div
              key={t.id}
              className={`text-xs py-1 px-2 rounded flex items-start gap-2 transition-colors ${
                t.hookDetected
                  ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800"
                  : t.isActivated
                    ? "bg-blue-50 dark:bg-blue-950/20"
                    : "hover:bg-muted/50"
              }`}
            >
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {t.time}
              </span>
              <span
                className={`flex-1 ${
                  !t.isFinal ? "text-muted-foreground italic" : ""
                }`}
              >
                {highlightHook(t.text, hookWord)}
              </span>
              {t.hookDetected && (
                <span className="shrink-0 text-yellow-600 dark:text-yellow-400 font-bold">
                  ⚡
                </span>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </Card>
  );
}
