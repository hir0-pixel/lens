import { useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MOCK_OUTPUT_CHANNELS } from "./mock-data";

export function OutputPanel() {
  const [activeChannel, setActiveChannel] = useState(MOCK_OUTPUT_CHANNELS[0].id);
  const channel = MOCK_OUTPUT_CHANNELS.find((c) => c.id === activeChannel) ?? MOCK_OUTPUT_CHANNELS[0];

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/5 px-1"
        role="tablist"
        aria-label="Output channels"
      >
        {MOCK_OUTPUT_CHANNELS.map((ch) => (
          <button
            key={ch.id}
            role="tab"
            aria-selected={ch.id === activeChannel}
            onClick={() => setActiveChannel(ch.id)}
            className={cn(
              "h-7 shrink-0 px-2.5 text-[11px] transition-colors",
              ch.id === activeChannel
                ? "border-b-2 border-accent text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {ch.name}
          </button>
        ))}
      </div>
      <ScrollArea className="flex-1">
        <pre
          className="whitespace-pre-wrap p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400"
          role="log"
          aria-label={`${channel.name} output`}
        >
          {channel.lines.join("\n")}
        </pre>
      </ScrollArea>
    </div>
  );
}
