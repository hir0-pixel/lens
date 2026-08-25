import { useState } from "react";
import { Check, Coins, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    <Modal open={open} onClose={onClose} title="Plans & Credits" subtitle="Usage-based credits. 1 credit is about 1 English word of AI output." size="xl">
      <div className="p-6">
        <Card className="mb-6 bg-primary/10 ring-primary/30">
          <CardContent className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/20"><Coins className="h-5 w-5 text-primary" /></span>
              <span>
                <span className="block text-[13px] font-semibold">Current plan: Pro</span>
                <span className="block text-[12px] text-muted-foreground">{credits.toLocaleString()} credits remaining. Resets in 12 days.</span>
              </span>
            </div>
            <span className="hidden h-2 w-40 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full rounded-full bg-primary" style={{ width: "32%" }} /></span>
          </CardContent>
        </Card>

        <ToggleGroup type="single" value={billing} onValueChange={(value) => value && setBilling(value as "annual" | "monthly")} className="mb-5 justify-center">
          <ToggleGroupItem value="annual" aria-label="Annual billing">Annual</ToggleGroupItem>
          <ToggleGroupItem value="monthly" aria-label="Monthly billing">Monthly</ToggleGroupItem>
        </ToggleGroup>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <Card key={plan.name} className={cn("relative gap-0", plan.highlight && "ring-primary/60 bg-primary/5")}>
              <CardContent className="flex h-full flex-col">
                {plan.highlight && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">POPULAR</span>}
                <div className="text-[13px] font-semibold">{plan.name}</div>
                <div className="mt-2 flex items-baseline gap-1"><span className="text-2xl font-bold">${plan[billing]}</span><span className="text-[11px] text-muted-foreground">/mo</span></div>
                <div className="mt-1 flex items-center gap-1 text-[11.5px] text-muted-foreground"><Zap className="h-3 w-3 text-primary" />{plan.creditsPerMonth} credits</div>
                <Separator className="my-3" />
                <div className="space-y-1.5">
                  {plan.features.map((feature) => <div key={feature} className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Check className="h-3 w-3 text-[var(--success)]" />{feature}</div>)}
                </div>
                <Button type="button" disabled variant={plan.highlight ? "default" : "outline"} className="mt-4 w-full text-[12.5px]">
                  {plan.name === "Pro" ? "Current plan" : `Switch to ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-4 text-center text-[11.5px] text-muted-foreground">Credits are usage-based. Unused credits expire at the end of each billing cycle.</p>
      </div>
    </Modal>
  );
}
