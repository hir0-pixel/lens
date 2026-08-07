import AIPanel, { type AIPanelProps } from "../ai/AIPanel";

export type AgentChatProps = AIPanelProps;

export default function AgentChat(props: AgentChatProps) {
  return <AIPanel {...props} />;
}
