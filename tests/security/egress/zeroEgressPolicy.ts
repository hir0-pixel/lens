export type EgressTarget =
  | { kind: "service"; name: string }
  | { kind: "dns"; host: string }
  | { kind: "ip"; address: string }
  | { kind: "proxy"; url: string }
  | { kind: "webhook"; url: string };

export class EgressDeniedError extends Error {
  readonly name = "EgressDeniedError";
}

/** Default-deny policy used by local and integration egress probes. */
export class ZeroEgressPolicy {
  constructor(private readonly approvedServices: ReadonlySet<string>) {}

  assertAllowed(target: EgressTarget): void {
    if (target.kind === "service" && this.approvedServices.has(target.name)) {
      return;
    }
    throw new EgressDeniedError("The destination is not an approved internal service.");
  }
}

export async function guardedDial<T>(
  policy: ZeroEgressPolicy,
  target: EgressTarget,
  dial: () => Promise<T>,
): Promise<T> {
  policy.assertAllowed(target);
  return dial();
}
