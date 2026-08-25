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
    <div className="border-b border-[var(--border-subtle)] p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="type-caption-uppercase text-[var(--text-tertiary)]">
          Message
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 type-caption text-[var(--text-tertiary)]">
              Templates
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="type-caption">Conventional commits</DropdownMenuLabel>
            {COMMIT_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => applyTemplate(t.message)}>
                <span className="type-code text-accent">{t.label}</span>
                <span className="ml-2 type-caption text-[var(--text-tertiary)]">{t.description}</span>
              </DropdownMenuItem>
            ))}
            {recentMessages.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="type-caption">Recent</DropdownMenuLabel>
                {recentMessages.slice(0, 5).map((m) => (
                  <DropdownMenuItem key={m} onClick={() => applyTemplate(m)}>
                    <span className="truncate type-caption">{m}</span>
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
        className="min-h-[52px] resize-none border-[var(--border-default)] bg-surface-2 type-caption leading-relaxed placeholder:text-[var(--text-tertiary)]"
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
        className="mt-1.5 min-h-[40px] resize-none border-[var(--border-default)] bg-surface-2 type-caption placeholder:text-[var(--text-tertiary)]"
        aria-label="Commit description"
      />

      <div className="mt-1.5 flex items-center justify-between type-caption">
        <span
          className={cn(
            "tabular-nums text-[var(--text-tertiary)]",
            subjectWarn && "text-[var(--warning)]",
            subjectError && "text-[var(--error)]",
          )}
        >
          {subjectLen}/72
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <Checkbox
              checked={amend}
              onCheckedChange={(v) => setAmend(v === true)}
              className="h-3.5 w-3.5"
            />
            <Label className="type-caption font-normal text-[var(--text-tertiary)]">Amend</Label>
          </label>
          <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <Checkbox
              checked={signOff}
              onCheckedChange={(v) => setSignOff(v === true)}
              className="h-3.5 w-3.5"
            />
            <Label className="type-caption font-normal text-[var(--text-tertiary)]">Sign-off</Label>
          </label>
        </div>
      </div>

      <Button
        className="mt-2 h-8 w-full gap-1.5 type-caption"
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
