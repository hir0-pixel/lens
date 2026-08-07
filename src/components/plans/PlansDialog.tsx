import { useState } from "react";
import { Check, Coins, Zap } from "lucide-react";
import { cn } from "../../lib/utils";
import { PLANS } from "../../lib/mock-data";
import Modal from "../ui/Modal";

interface PlansDialogProps {
  open: boolean;
  onClose: () => void;
  credits: number;
}

export default function PlansDialog({ open, onClose, credits }: PlansDialogProps) {
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Plans & Credits"
      subtitle="Usage-based credits · 1 credit ≈ 1 English word of AI output"
      size="xl"
    >
      <div className="p-6">
        {/* Current usage */}
        <div className="mb-6 flex items-center justify-between rounded-lg border border-accent/30 bg-accent/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
              <Coins className="h-5 w-5 text-accent" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-zinc-100">
                Current plan: Pro
              </div>
              <div className="text-[12px] text-zinc-400">
                {credits.toLocaleString()} credits remaining · resets in 12 days
              </div>
            </div>
          </div>
          <div className="hidden h-2 w-40 overflow-hidden rounded-full bg-white/10 sm:block">
            <div className="h-full rounded-full bg-[var(--accent-primary)]" style={{ width: "32%" }} />
          </div>
        </div>

        {/* Billing toggle */}
        <div className="mb-5 flex items-center justify-center gap-2">
          <button
            onClick={() => setBilling("annual")}
            className={cn(
              "rounded-l-lg border border-white/10 px-4 py-1.5 text-[12.5px] font-medium transition-colors",
              billing === "annual"
                ? "bg-accent text-surface-0"
                : "bg-white/5 text-zinc-400 hover:text-zinc-200",
            )}
          >
            Annual
          </button>
          <button
            onClick={() => setBilling("monthly")}
            className={cn(
              "rounded-r-lg border border-white/10 px-4 py-1.5 text-[12.5px] font-medium transition-colors",
              billing === "monthly"
                ? "bg-accent text-surface-0"
                : "bg-white/5 text-zinc-400 hover:text-zinc-200",
            )}
          >
            Monthly
          </button>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-lg border p-4 transition-colors",
                plan.highlight
                  ? "border-accent/60 bg-accent/5"
                  : "border-white/10 bg-white/5",
              )}
            >
              {plan.highlight && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-surface-0">
                  POPULAR
                </span>
              )}
              <div className="text-[13px] font-semibold text-zinc-100">
                {plan.name}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-zinc-50">
                  ${plan[billing]}
                </span>
                <span className="text-[11px] text-zinc-500">/mo</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11.5px] text-zinc-400">
                <Zap className="h-3 w-3 text-accent" />
                {plan.creditsPerMonth} credits
              </div>
              <div className="my-3 h-px bg-white/10" />
              <div className="space-y-1.5">
                {plan.features.map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-1.5 text-[12px] text-zinc-400"
                  >
                    <Check className="h-3 w-3 text-emerald-400" />
                    {f}
                  </div>
                ))}
              </div>
              <button
                type="button"
                disabled
                title={
                  plan.name === "Pro"
                    ? "You are already on Pro"
                    : "Billing checkout is not connected yet"
                }
                className={cn(
                  "mt-4 w-full cursor-not-allowed rounded-lg py-1.5 text-[12.5px] font-semibold opacity-50",
                  plan.highlight
                    ? "bg-accent text-surface-0"
                    : "border border-white/10 bg-white/5 text-zinc-200",
                )}
              >
                {plan.name === "Pro" ? "Current plan" : "Switch to " + plan.name}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[11.5px] text-zinc-500">
          Credits are usage-based. 1 credit ≈ 1 English word of AI output.
          Unused credits expire at the end of each billing cycle.
        </p>
      </div>
    </Modal>
  );
}