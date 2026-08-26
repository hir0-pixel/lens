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
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-1.5 py-0.5 type-code text-[var(--accent-primary)]">
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
        className="mx-0.5 inline-flex translate-y-px items-center rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-[6px] py-[1px] font-[inherit] type-caption leading-[1.3] text-[var(--text-primary)]"
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
    <div className="group relative my-2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3 py-1.5">
        <span className="type-code-uppercase text-[var(--text-tertiary)]">
          {lang}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-6 gap-1 px-2 type-caption text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[var(--success)]" />
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
        <code className={cn("type-code leading-relaxed text-[var(--text-primary)]", className)}>
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
        "prose prose-sm max-w-none text-[var(--text-primary)]",
        "[&_p]:my-1.5 [&_p]:type-body-sm [&_p]:leading-[1.55] [&_p]:text-[var(--text-primary)]",
        "[&_strong]:font-semibold [&_strong]:text-[var(--text-primary)]",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:text-[var(--text-primary)]",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:text-[var(--text-primary)]",
        "[&_li]:my-0.5",
        "[&_h1]:text-base [&_h2]:type-title-sm [&_h3]:type-body-sm [&_h1,_h2,_h3]:font-semibold [&_h1,_h2,_h3]:text-[var(--text-primary)]",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:type-caption",
        "[&_th]:border [&_th]:border-[var(--border-default)] [&_th]:bg-[var(--bg-surface-raised)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[var(--text-primary)]",
        "[&_td]:border [&_td]:border-[var(--border-default)] [&_td]:px-2 [&_td]:py-1 [&_td]:text-[var(--text-secondary)]",
        "[&_blockquote]:border-l [&_blockquote]:border-[var(--accent-primary)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-secondary)]",
        "[&_a]:text-[var(--accent-primary)] [&_a]:underline [&_a]:underline-offset-2",
        "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-[var(--border-default)]",
        "[&_hr]:my-4 [&_hr]:border-[var(--border-subtle)]",
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
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-[var(--bg-hover)] px-1 type-caption font-medium text-[var(--text-secondary)]">
      {index}
    </span>
  );
}

export function DiagnosticInline({ count, kind }: { count: number; kind: "error" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 type-caption",
        kind === "error"
          ? "bg-[var(--error-muted)] text-[var(--error)]"
          : "bg-[var(--warning)]/10 text-[var(--warning)]",
      )}
    >
      <AlertCircle className="h-3 w-3" />
      {count} {kind}
      {count !== 1 ? "s" : ""}
    </span>
  );
}
