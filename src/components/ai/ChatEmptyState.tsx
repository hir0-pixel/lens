import * as React from "react";
import { ChevronDown, Folder, Menu, Settings, User } from "lucide-react";
import { useAutoGrowTextarea } from "@/components/ai/hooks/useAutoGrowTextarea";
import { cn } from "@/lib/utils";

/**
 * DropdownPill component — icon + label + small chevron.
 * Used for project/branch selectors in the input card.
 */
export function DropdownPill({
  icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-400 bg-white/5 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
      )}
    >
      <icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <ChevronDown className="h-3 w-3 text-gray-300" />
    </button>
  );
}

/**
 * ProjectItem component — folder icon + name.
 * Used within the Projects section of the sidebar.
 */
export function ProjectItem({ name }: { name: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <Folder className="h-3 w-3 text-gray-500" />
      <span className="text-gray-400 truncate">{name}</span>
    </div>
  );
}

/**
 * TaskItem component — colored status dot, truncated title, relative time.
 * Used within the Projects section nested task rows.
 */
export function TaskItem({
  title,
  statusColor = "red",
  time = "7m",
}: { title: string; statusColor?: string; time?: string }) {
  const statusColors = {
    red: "bg-red-500",
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    blue: "bg-blue-500",
  };

  return (
    <div className="flex items-baseline gap-2">
      <span className={statusColors[statusColor] || "bg-red-500"} h-1 w-1 rounded-full />
      <span className="text-gray-500 text-truncate">{title}</span>
      <span className="text-xs text-gray-500 opacity-60">{time}</span>
    </div>
  );
}

/**
 * Sidebar component for the chat empty/landing state.
 * Fixed-width (~260px when md) left sidebar with nav, toggles, and user profile.
 * Sticky to layout flow, not position: fixed.
 */
export function Sidebar() {
  return (
    <div
      className="w-24 md:w-64 h-full flex-shrink-0 bg-[--bg-surface] border-r border-border-subtle flex-col"
    >
      {/* App logo + nav arrows top-left */}
      <div className="flex flex-col items-start pt-4 gap-2">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-gray-400" />
          <span className="text-xs font-medium text-gray-200">Lens</span>
        </div>
        <div className="flex items-center gap-2 text-xs opacity-60">
          {/* Back arrow */}
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="Back"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
          {/* Forward arrow */}
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="Forward"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Nav list */}
      <nav className="flex-1 flex flex-col gap-1 px-2">
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-400 hover:bg-white/5 transition-colors",
          )}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="New task"
          >
            <path d="M13 2L3 14h9l-1 8 8-2v8l-8-2 1-8L13 2zM3 14h6l8 8V7L3 7v7z" />
          </svg>
          New task
          <span className="ml-auto text-xs opacity-50">Ctrl+N</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-400 hover:bg-white/5 transition-colors",
          )}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="Search"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Search
          <span className="ml-auto text-xs opacity-50">Ctrl+K</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-400 hover:bg-white/5 transition-colors",
          )}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="Automations"
          >
            <path d="M12 3v8l6 4-6 4v-8c-4.4-3.6-10-3.6-14 0v8l-6-4 2-6h14l2 6v8l6-4-6 4v-8zM2 12l3.29 6.43L17 12l-3.71 5.03" />
          </svg>
          Automations
        </button>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-400 hover:bg-white/5 transition-colors",
          )}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="Skills"
          >
            <path d="M12 2v20M8.59 8.59a2 2 0 0 1 0 2.83l1.42 1.42a2 2 0 0 1-2.83 0L5.29 15H1v2h10.59a2 2 0 0 1 1.96 1.83l1.41 1.41a2 2 0 0 1-2.83 0L11 16.59a2 2 0 0 1-2.83-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.59l1.13-1.13a2 2 0 0 1 0-2.83z" />
          </svg>
          Skills
        </button>
      </nav>

      {/* Segmented toggle row: Group | Project pills + filter + trash */}
      <div className="flex flex-col pt-2">
        <div className="flex gap-2 border-b border-border-subtle pb-2 mb-2">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-gray-400 bg-white/5 hover:text-gray-200 transition-colors",
            )}
          >
            Group
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-gray-400 bg-white/5 hover:text-gray-200 transition-colors bg-gray-600/50 text-gray-200",
            )}
          >
            Project
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs opacity-60">
          <Menu className="h-3.5 w-3.5" />
          <span>Filter</span>
          <Trash className="h-3.5 w-3.5" />
        </div>
      </div>

      {/* "Projects" section: label + nested project rows */}
      <div className="mt-auto flex flex-col gap-2 px-2 text-xs">
        <span className="text-gray-500 uppercase tracking-wider">Projects</span>

        <div className="flex items-baseline gap-2 my-1">
          <Folder className="h-3 w-3 text-gray-500" />
          <span className="text-gray-400">project-name</span>
        </div>

        <div className="flex items-baseline gap-2 my-2">
          <span className="h-1 w-1 rounded-full bg-red-500" />
          <span className="text-gray-500 text-truncate">Submit PR</span>
          <span className="text-xs text-gray-500 opacity-60">2m</span>
        </div>
      </div>

      {/* "Tasks" section: label + empty state */}
      <div className="mt-2 flex-1 text-xs opacity-60">
        Tasks
        <span className="ml-auto">No tasks yet</span>
      </div>

      {/* Bottom: sticky user profile row within sidebar layout */}
      <div className="mt-auto flex items-center gap-3 px-2 py-2 border-t border-border-subtle">
        <div className="relative">
          <User
            className="h-6 w-6 rounded-full bg-gray-800 text-gray-400 flex items-center justify-center text-xs font-medium"
          >
            HR
          </User>
        </div>
        <span className="text-gray-400 text-sm">Harper Lee</span>
        <div className="flex items-center gap-1.5 text-xs opacity-60">
          <Settings className="h-3.5 w-3.5" />
          <Help className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

/**
 * ChatInputCard component — the centered card in the empty state.
 * Contains dropdown pills, textarea, and bottom action row.
 * This is a centered card (max-width ~700px) with dark surface, subtle border, rounded-2xl.
 */
export function ChatInputCard() {
  const { ref: taRef, adjust } = useAutoGrowTextarea(300);
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    adjust();
  }, [text]);

  return (
    <div className="bg-[--bg-surface] border border-border-subtle rounded-2xl p-6 max-w-[700px] w-full">
      {/* Top row: two dropdown pills */}
      <div className="flex gap-2 mb-4">
        <DropdownPill icon={Folder} label="project-name ⌄" />
        <DropdownPill icon={User} label="branch-name ⌄" />
      </div>

{/* Large borderless auto-growing textarea */}
          <textarea
            ref={taRef}
            className="w-full rounded-xl px-4 py-3 bg-transparent border-0 resize-none text-lg text-gray-200 placeholder-gray-500 focus-visible:outline-none focus-visible:ring-0"
            placeholder="Ask anything, @ to add context, / for commands or capabilities"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />

      {/* Bottom row: + button, toggle pill, model/priority dropdowns, submit */}
      <div className="flex items-center gap-2 mt-4">
        {/* + icon button with toggle pill look */}
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-gray-300 bg-white/5 hover:bg-white/10 transition-colors",
          )}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Ask before changes</span>
        </button>

        {/* Model dropdown */}
        <div className="relative flex items-center gap-2">
          <svg
            className="h-4 w-4 text-gray-400"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="text-gray-400 text-sm">GPT-4o</span>
        </div>

        {/* Priority dropdown */}
        <div className="relative flex items-center gap-2">
          <svg
            className="h-4 w-4 text-gray-400"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9 5H7a2 2 0 0 1-2 2v8a2 2 0 0 1 2 2h2a2 2 0 0 1 2 2v-2h2v-8h2v8h2V7h2V5h-2V3h-2z" />
          </svg>
          <span className="text-gray-400 text-sm">High</span>
        </div>

        {/* Circular submit button */}
        <button
          type="button"
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-50 disabled:pointer-events-none",
          )}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M7.7 1.4c-.977.697-1.577 1.897-1.577 3.073 0 2.401.978 3.858 2.33 4.653a3.74 3.74 0 0 0 2.457-1.308c-.941.177-1.954.228-3.025.128A11.775 11.775 0 0 1 12 2.5c-5.948 0-11 3.766-11 8.407 0 1.493.21 2.888.568 4.233a3.793 3.793 0 0 0 1.582 1.105c.378.088.763.137 1.157.137.388 0 .773-.05 1.157-.137a3.774 3.774 0 0 0 1.582-1.105c.752-.512.938-1.336.98-2.553.026-1.083.02-2.208.017-3.254 0-.094-.002-.273-.013-.406-.037a13.247 13.247 0 0 0 .568-1.087m-.51 5.52c.663-.568 1.24-.935 1.897-1.223 1.117-.457 1.828-.763 2.465-.883a7.025 7.025 0 0 1 2.527 1.293c-.35 1.06-.78 2.036-1.345 2.837a9.05 9.05 0 0 1-2.638 1.085m-.485-5.52c.689.768 1.28 1.696 1.694 2.717a4.978 4.978 0 0 1 1.085 2.282c.095.928.1 1.9.017 2.932a7.027 7.027 0 0 1-2.526 1.293c.071-.653.107-1.33.135-2.037a9.028 9.028 0 0 1-2.641-1.085m-.505 5.52a13.067 13.067 0 0 1-.612 2.075c.77.343 1.606.535 2.513.558a4.959 4.959 0 0 1 2.318 1.067c-.638.195-1.318.253-2.034.17a13.265 13.265 0 0 1-1.097-.531m-.51-5.52Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Main ChatEmptyState component — two-column layout with sidebar + content.
 * Shows a friendly landing state when no messages exist.
 * Sidebar: fixed ~260px (md: w-64), Main content: flexible with centered card.
 */
export function ChatEmptyState() {
  return (
    <div className="min-h-screen flex flex-col bg-[--bg-canvas] text-gray-200">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Vertically centered content when no messages */}
        <div className="flex-1 flex flex-col items-center justify-center py-12">
          <h1 className="text-3xl font-medium text-gray-200 mb-4">
            Good morning
            <span className="text-gray-400">Welcome back</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-md mb-8 text-center">
            Ask me anything about your codebase, or start with a suggested prompt below.
          </p>
          <ChatInputCard />
        </div>
      </div>
    </div>
  );
}