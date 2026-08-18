import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  FileCode2,
  FolderOpen,
  Terminal,
  GitBranch,
  AlertCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { sanitizeUrl } from "@/shared/security/sanitize";

interface MarkdownContentProps {
  content: string;
  streaming?: boolean;
  className?: string;
}

function InlineReference({
  type,
  label,
}: {
  type: "file" | "folder" | "terminal" | "citation";
  label: string;
}) {
  const icons = {
    file: FileCode2,
    folder: FolderOpen,
    terminal: Terminal,
    citation: GitBranch,
  };
  const Icon = icons[type];

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-accent">
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className ?? "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (!match) {
    return (
      <code
        className="mx-0.5 inline-flex translate-y-px items-center rounded-[6px] border border-white/[0.1] bg-[#2a2a2a] px-[6px] py-[1px] font-[inherit] text-[13px] leading-[1.3] text-[#d8d8d8]"
        {...props}
      >
        {children}
      </code>
    );
  }

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-white/10 bg-surface-1">
      <div className="flex items-center justify-between border-b border-white/10 bg-surface-2 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {lang}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-6 gap-1 px-2 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className={cn("font-mono text-[12px] leading-relaxed text-zinc-300", className)}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function MarkdownContent({ content, streaming, className }: MarkdownContentProps) {
  const processed = content.replace(
    /@\[(\w+):([^\]]+)\]/g,
    (_, type, label) => `\`@${type}:${label}\``,
  );

  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none",
        "[&_p]:my-1.5 [&_p]:text-[14.5px] [&_p]:leading-[1.55] [&_p]:text-[#d4d4d4]",
        "[&_strong]:font-semibold [&_strong]:text-zinc-100",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:text-zinc-300",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:text-zinc-300",
        "[&_li]:my-0.5",
        "[&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-[14px] [&_h1,_h2,_h3]:font-semibold [&_h1,_h2,_h3]:text-zinc-100",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px]",
        "[&_th]:border [&_th]:border-white/10 [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-zinc-300",
        "[&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_td]:text-zinc-400",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-accent/50 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-400",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
        "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-white/10",
        "[&_hr]:my-4 [&_hr]:border-white/10",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock as React.ComponentType<React.HTMLAttributes<HTMLElement>>,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children, ...props }) => (
            <a
              href={sanitizeUrl(href ?? "#")}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent" />
      )}
    </div>
  );
}

export function FileReferenceChip({ path }: { path: string }) {
  return <InlineReference type="file" label={path} />;
}

export function CitationChip({ index }: { index: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-white/10 px-1 text-[10px] font-medium text-zinc-400">
      {index}
    </span>
  );
}

export function DiagnosticInline({ count, kind }: { count: number; kind: "error" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
        kind === "error"
          ? "bg-red-500/10 text-red-400"
          : "bg-amber-500/10 text-amber-400",
      )}
    >
      <AlertCircle className="h-3 w-3" />
      {count} {kind}
      {count !== 1 ? "s" : ""}
    </span>
  );
}
