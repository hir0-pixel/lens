import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Loader2,
  Lock,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface BrowserViewProps {
  selectMode: boolean;
  onToggleSelectMode: () => void;
}

export default function BrowserView({
  selectMode,
  onToggleSelectMode,
}: BrowserViewProps) {
  const [url, setUrl] = useState("https://localhost:5173");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function navigate() {
    setLoading(true);
    setTimeout(() => setLoading(false), 1200);
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Address bar */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 bg-zinc-100 px-2 py-1.5">
        <button className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-200">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-200">
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => (loading ? setLoading(false) : navigate())}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-200"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200">
          <Lock className="h-3 w-3 shrink-0 text-zinc-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate()}
            className="w-full bg-transparent font-mono text-[12px] text-zinc-700 outline-none"
          />
        </div>

        <button className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-200">
          <Star className="h-3.5 w-3.5" />
        </button>

        {/* Element-grab toggle */}
        <button
          onClick={onToggleSelectMode}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
            selectMode
              ? "bg-[#FCAA26] text-white ring-2 ring-[#FCAA26]/30"
              : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300",
          )}
          title="Select to Edit"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Select to Edit
          {selectMode && <X className="h-3 w-3" />}
        </button>
      </div>

      {/* Page (mock preview with selectable elements) */}
      <div className="relative flex-1 overflow-hidden bg-zinc-50">
        {selectMode && (
          <div className="pointer-events-none absolute inset-0 z-20 animate-fade-in bg-[#FCAA26]/10">
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-[#FCAA26] px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
              Click any element to edit it
            </div>
          </div>
        )}

        <div className="mx-auto h-full max-w-4xl overflow-y-auto px-12 py-10">
          <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-900 text-white">
                  FD
                </div>
                <div>
                  <div className="text-[15px] font-bold text-zinc-800">
                    Finance Dashboard
                  </div>
                  <div className="text-[12px] text-zinc-500">
                    Personal money overview
                  </div>
                </div>
              </div>
              <div
                data-selectable
                className={cn(
                  "rounded-lg px-4 py-2 text-[13px] font-semibold transition-all",
                  selected === "cta"
                    ? "bg-[#FCAA26] text-white ring-4 ring-[#FCAA26]/30"
                    : "bg-[#FCAA26] text-white hover:opacity-90",
                )}
                onClick={() => selectMode && setSelected("cta")}
              >
                Add account
              </div>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-4">
              {[
                { label: "Balance", value: "$12,480", delta: "+4.2%" },
                { label: "Income", value: "$6,900", delta: "+8.1%" },
                { label: "Spending", value: "$4,210", delta: "-2.4%" },
              ].map((stat, i) => (
                <div
                  key={i}
                  data-selectable
                  onClick={() => selectMode && setSelected(`stat-${i}`)}
                  className={cn(
                    "rounded-lg border border-zinc-200 p-4 transition-all",
                    selected === `stat-${i}` &&
                      "ring-2 ring-[#FCAA26]/40 border-[#FCAA26]",
                  )}
                >
                  <div className="text-[12px] text-zinc-500">{stat.label}</div>
                  <div className="mt-1 text-xl font-bold text-zinc-800">
                    {stat.value}
                  </div>
                  <div
                    className={cn(
                      "text-[12px] font-medium",
                      stat.delta.startsWith("+")
                        ? "text-emerald-600"
                        : "text-red-500",
                    )}
                  >
                    {stat.delta} this month
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-zinc-700">
                  Cash flow
                </span>
                <select className="rounded-md border border-zinc-200 text-[12px] text-zinc-600">
                  <option>Last 6 months</option>
                </select>
              </div>
              <div className="flex h-32 items-end gap-2">
                {[40, 65, 45, 80, 55, 90].map((h, i) => (
                  <div key={i} className="flex-1">
                    <div
                      className="max-w-10 rounded-t bg-[#FCAA26]/20 transition-all hover:bg-[#FCAA26]/40"
                      style={{ height: `${h}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Select-to-Edit floating input */}
        {selectMode && selected && (
          <div className="absolute bottom-4 left-1/2 z-30 w-[420px] -translate-x-1/2 animate-fade-up">
            <div className="flex items-center gap-2 rounded-xl border-2 border-[#FCAA26] bg-white p-1.5 shadow-float-pop">
              <Crosshair className="ml-1.5 h-4 w-4 shrink-0 text-[#FCAA26]" />
              <input
                autoFocus
                placeholder="Describe the change to this element…"
                className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-zinc-800 outline-none placeholder-zinc-400"
              />
              <button className="rounded-lg bg-[#FCAA26] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
                Apply
              </button>
              <button
                onClick={() => setSelected(null)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 animate-scale-in">
          <div className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 shadow-float-pop">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            <span className="text-[13px] text-zinc-600">Loading webpage…</span>
          </div>
        </div>
      )}
    </div>
  );
}