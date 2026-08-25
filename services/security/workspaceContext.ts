/**
 * Server-owned workspace/request-class context for the current deployment.
 *
 * This is a single-tenant deployment: there is no multi-workspace concept
 * anywhere else in the codebase (no workspace table, no org/tenant model).
 * These constants are the one place that fact is asserted. They are NEVER
 * read from request bodies or browser input — the BFF binds them into the
 * signed delegated session assertion it issues (see
 * `DelegatedSessionAssertionBindings.workspaceRef`/`requestClass`), and the
 * Orchestrator verifies the assertion against these same constants before
 * trusting the claim, so a forged/replayed assertion cannot supply a
 * different workspace or request class than the one this process actually
 * serves. If a future deployment needs real multi-workspace routing, this is
 * the one place that resolution needs to become dynamic and authenticated.
 */
export const LENS_WORKSPACE_REF = "default-workspace";
export const LENS_REQUEST_CLASS = "enterprise-grounded";
/**
 * `purpose_ref` is a route-policy lookup key (Doc 004 §23) exactly like
 * workspace_ref and request_class above: two manifest scopes can differ only
 * by purpose_ref, so an attacker-supplied value could select a scope with a
 * weaker `grounding_required` than the one this deployment actually serves
 * for this client. Same trust model as the two constants above — bound into
 * the signed assertion, never read from the request body.
 */
export const LENS_PURPOSE_REF = "assistant";
