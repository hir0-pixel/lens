export type BudgetState = "RESERVED" | "FINALIZED" | "CANCELLED" | "EXPIRED";
export class BudgetError extends Error { constructor(readonly code: "CONFLICT" | "FORBIDDEN" | "STALE_AUTHORITY") { super(code); } }
export interface BudgetReservation { reservationRef: string; requestId: string; estimateDigest: string; maximumCost: number; remainingCost: number; expiresAt: number; state: BudgetState; }

/** Engineer B consumer-side ledger simulator. Finance policy remains an external authority. */
export class CostController {
  private readonly reservations = new Map<string, BudgetReservation>();
  constructor(private availableCost: number, private readonly now = () => Date.now()) {}
  reserve(input: { reservationRef: string; requestId: string; estimateDigest: string; maximumCost: number; expiresAt: number }): BudgetReservation {
    const existing = this.reservations.get(input.reservationRef);
    if (existing) { if (existing.requestId !== input.requestId || existing.estimateDigest !== input.estimateDigest || existing.maximumCost !== input.maximumCost) throw new BudgetError("CONFLICT"); return { ...existing }; }
    if (!input.reservationRef || !input.requestId || input.maximumCost <= 0 || input.expiresAt <= this.now()) throw new BudgetError("STALE_AUTHORITY");
    if (input.maximumCost > this.availableCost) throw new BudgetError("FORBIDDEN");
    this.availableCost -= input.maximumCost;
    const reservation = { ...input, remainingCost: input.maximumCost, state: "RESERVED" as const };
    this.reservations.set(input.reservationRef, reservation); return { ...reservation };
  }
  finalize(reservationRef: string, usageEventId: string, measuredCost: number): BudgetReservation {
    const reservation = this.reservations.get(reservationRef);
    if (!reservation || reservation.expiresAt <= this.now()) throw new BudgetError("STALE_AUTHORITY");
    if (!usageEventId || measuredCost < 0 || measuredCost > reservation.maximumCost) throw new BudgetError("CONFLICT");
    if (reservation.state === "FINALIZED") return { ...reservation };
    this.availableCost += reservation.maximumCost - measuredCost;
    reservation.remainingCost = measuredCost; reservation.state = "FINALIZED"; return { ...reservation };
  }
}
