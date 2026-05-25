import { useState } from "react";
import { Zap, Plus, Trash2 } from "lucide-react";
import { Card, Button, Input } from "../../../components/ui";
import type { AgentConfig } from "./VoiceAgentStudio";

interface WakeWordConfigProps {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  isConnected: boolean;
}

export default function WakeWordConfig({
  config,
  onChange,
  isConnected,
}: WakeWordConfigProps) {
  const [newTrigger, setNewTrigger] = useState("");
  const [newResponse, setNewResponse] = useState("");

  const addMapping = () => {
    if (!newTrigger.trim() || !newResponse.trim()) return;
    onChange({
      ...config,
      responseMappings: {
        ...config.responseMappings,
        [newTrigger.trim()]: newResponse.trim(),
      },
    });
    setNewTrigger("");
    setNewResponse("");
  };

  const removeMapping = (key: string) => {
    const { [key]: _, ...rest } = config.responseMappings;
    onChange({ ...config, responseMappings: rest });
  };

  return (
    <Card className="gap-0 p-0">
      <div className="p-3 flex items-center gap-2 border-b">
        <Zap className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Wake Word &amp; Responses</span>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Wake word (spoken name that activates the agent)
          </label>
          <Input
            value={config.hookWord}
            onChange={(e) => onChange({ ...config, hookWord: e.target.value })}
            placeholder="e.g. Jarvis, Computer, Neo"
            className="h-7 text-xs"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            System instruction
          </label>
          <textarea
            value={config.instruction}
            onChange={(e) =>
              onChange({ ...config, instruction: e.target.value })
            }
            rows={2}
            placeholder="Be a helpful voice assistant..."
            className="w-full px-3 py-1.5 text-xs border border-border rounded-md bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Custom responses (trigger → spoken reply)
          </label>
          {Object.entries(config.responseMappings).map(([trigger, response]) => (
            <div key={trigger} className="flex items-start gap-1.5 mb-1.5">
              <div className="flex-1 text-xs p-1.5 bg-muted/50 rounded border border-border">
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                  {trigger}
                </span>
                <span className="text-muted-foreground mx-1">→</span>
                <span>{response}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeMapping(trigger)}
                className="h-6 w-6 p-0 shrink-0"
              >
                <Trash2 className="w-3 h-3 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5 mt-2">
            <Input
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              placeholder="Trigger phrase"
              className="h-7 text-xs flex-1"
            />
            <Input
              value={newResponse}
              onChange={(e) => setNewResponse(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMapping()}
              placeholder="Response text"
              className="h-7 text-xs flex-1"
            />
            <Button
              size="sm"
              onClick={addMapping}
              disabled={!newTrigger.trim() || !newResponse.trim()}
              className="h-7 px-2"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          15-second follow-up window: speech after activation is treated as a
          continuation without repeating the wake word.
        </p>
      </div>
    </Card>
  );
}
