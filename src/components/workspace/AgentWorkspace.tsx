import AIPanel, { type AIPanelProps } from "@/components/ai/AIPanel";

export type AgentWorkspaceProps = AIPanelProps;

/**
 * Primary center surface — agent conversation owns the viewport.
 */
export function AgentWorkspace(props: AgentWorkspaceProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-canvas)]">
      <AIPanel {...props} />
    </div>
  );
}

export default AgentWorkspace;
