import type { McpDataFlowProfile } from "../../services/mcp-registry/dataFlowProfile";

export const NO_EGRESS_PROFILE: McpDataFlowProfile = Object.freeze({
  egressClass: "none",
  targets: [],
});

export const INTERNAL_EGRESS_PROFILE: McpDataFlowProfile = Object.freeze({
  egressClass: "internal",
  targets: ["retrieval.internal"],
});

export const EXTERNAL_EGRESS_PROFILE: McpDataFlowProfile = Object.freeze({
  egressClass: "external-approved",
  targets: ["api.example.com"],
});
