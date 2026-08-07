import { useRef } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGitStore } from "@/stores/gitStore";
import { COMMIT_TEMPLATES } from "./mock-data";
import { cn } from "@/lib/utils";

export function CommitEditor() {
  const commitMessage = useGitStore((s) => s.commitMessage);
  const commitDescription = useGitStore((s) => s.commitDescription);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const setCommitDescription = useGitStore((s) => s.setCommitDescription);
  const amend = useGitStore((s) => s.amend);
  const setAmend = useGitStore((s) => s.setAmend);
  const signOff = useGitStore((s) => s.signOff);
  const setSignOff = useGitStore((s) => s.setSignOff);
  const commit = useGitStore((s) => s.commit);
  const operation = useGitStore((s) => s.operation);
  const recentMessages = useGitStore((s) => s.recentMessages);
  const applyTemplate = useGitStore((s) => s.applyTemplate);
  const stagedCount = useGitStore((s) => s.getStaged().length);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const canCommit =
    commitMessage.trim().length > 0 &&
    (stagedCount > 0 || amend) &&
    operation !== "committing";

  const subjectLen = commitMessage.split("\n")[0]?.length ?? 0;
  const subjectWarn = subjectLen > 50;
  const subjectError = subjectLen > 72;

  async function handleCommit() {
    await commit();
  }

  return (
    <div className="border-b border-white/5 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Message
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px] text-zinc-500">
              Templates
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[10px]">Conventional commits</DropdownMenuLabel>
            {COMMIT_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => applyTemplate(t.message)}>
                <span className="font-mono text-[11px] text-accent">{t.label}</span>
                <span className="ml-2 text-[11px] text-zinc-500">{t.description}</span>
              </DropdownMenuItem>
            ))}
            {recentMessages.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px]">Recent</DropdownMenuLabel>
                {recentMessages.slice(0, 5).map((m) => (
                  <DropdownMenuItem key={m} onClick={() => applyTemplate(m)}>
                    <span className="truncate text-[11px]">{m}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Textarea
        ref={messageRef}
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        placeholder="Message (Ctrl+Enter to commit)"
        rows={2}
        className="min-h-[52px] resize-none border-white/10 bg-surface-2 text-[12px] leading-relaxed placeholder:text-zinc-600"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canCommit) {
            e.preventDefault();
            void handleCommit();
          }
        }}
        aria-label="Commit message"
      />

      <Textarea
        value={commitDescription}
        onChange={(e) => setCommitDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="mt-1.5 min-h-[40px] resize-none border-white/10 bg-surface-2 text-[12px] placeholder:text-zinc-600"
        aria-label="Commit description"
      />

      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span
          className={cn(
            "tabular-nums text-zinc-600",
            subjectWarn && "text-amber-400",
            subjectError && "text-red-400",
          )}
        >
          {subjectLen}/72
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-zinc-500">
            <Checkbox
              checked={amend}
              onCheckedChange={(v) => setAmend(v === true)}
              className="h-3.5 w-3.5"
            />
            <Label className="text-[10px] font-normal text-zinc-500">Amend</Label>
          </label>
          <label className="flex items-center gap-1.5 text-zinc-500">
            <Checkbox
              checked={signOff}
              onCheckedChange={(v) => setSignOff(v === true)}
              className="h-3.5 w-3.5"
            />
            <Label className="text-[10px] font-normal text-zinc-500">Sign-off</Label>
          </label>
        </div>
      </div>

      <Button
        className="mt-2 h-8 w-full gap-1.5 text-[12px]"
        disabled={!canCommit}
        onClick={() => void handleCommit()}
      >
        {operation === "committing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        {amend ? "Amend Commit" : `Commit${stagedCount ? ` (${stagedCount})` : ""}`}
      </Button>
    </div>
  );
}
