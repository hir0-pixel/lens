import {
  Activity,
  ArrowLeft,
  Eye,
  MousePointerClick,
  Globe,
  Rocket,
  Users,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { Project } from "../../lib/types";

interface AnalyticsViewProps {
  project: Project;
  onBack: () => void;
}

export default function AnalyticsView({ project, onBack }: AnalyticsViewProps) {
  const stats = [
    { label: "Visitors", value: "18,402", delta: "+12.4%", icon: Users },
    { label: "Page views", value: "43,110", delta: "+8.1%", icon: Eye },
    { label: "Clicks", value: "9,876", delta: "-2.1%", icon: MousePointerClick },
    { label: "Avg. visit", value: "2m 41s", delta: "+0.8%", icon: Activity },
  ];

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-zinc-100">
              {project.name}
            </h1>
            <div className="flex items-center gap-2 text-[12px] text-zinc-500">
              <Globe className="h-3 w-3" />
              {project.deployedUrl}
              <span className="flex items-center gap-1 text-emerald-400">
                <Rocket className="h-3 w-3" /> Live
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px]">
          <span className="text-zinc-500">Last</span>
          <select className="bg-transparent text-zinc-200 outline-none">
            <option>7 days</option>
            <option>30 days</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-zinc-500">{s.label}</span>
                  <s.icon className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="mt-1.5 text-xl font-bold text-zinc-100">
                  {s.value}
                </div>
                <span
                  className={cn(
                    "text-[12px] font-medium",
                    s.delta.startsWith("+")
                      ? "text-emerald-400"
                      : "text-red-400",
                  )}
                >
                  {s.delta}
                </span>
                <span className="text-[11px] text-zinc-600"> vs prev</span>
              </div>
            ))}
          </div>

          {/* Traffic chart */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-zinc-100">
                Visitors
              </h2>
              <div className="flex gap-1.5">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                      d === 14
                        ? "bg-accent text-surface-0"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="flex h-44 items-end gap-1.5">
              {[
                30, 55, 42, 70, 48, 62, 80, 52, 40, 66, 58, 75, 49, 60, 72,
                54, 38, 63, 69, 47, 57, 78, 50, 68, 44, 61, 74, 56,
              ].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-[var(--accent-primary-muted)] transition-colors duration-[var(--duration-instant)] hover:bg-[var(--accent-primary)]/40"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          {/* Top pages */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <h2 className="mb-3 text-[13px] font-semibold text-zinc-100">
              Top pages
            </h2>
            <div className="space-y-2">
              {[
                { path: "/", views: "12,410", pct: 29 },
                { path: "/accounts", views: "8,230", pct: 19 },
                { path: "/budgets", views: "6,102", pct: 14 },
                { path: "/savings-goals", views: "4,980", pct: 12 },
              ].map((row) => (
                <div key={row.path} className="flex items-center gap-3">
                  <span className="w-40 truncate font-mono text-[12px] text-zinc-300">
                    {row.path}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[12px] text-zinc-500">
                    {row.views}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}