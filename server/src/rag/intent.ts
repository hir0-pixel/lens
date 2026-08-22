export type PolicyIntent =
  | { kind: "conversation"; response: string }
  | { kind: "policy_overview" }
  | { kind: "policy_question" };

const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[!?.,]+$/g, "").trim();

/**
 * Deliberately narrow router. It handles only content-free social turns and
 * obvious product-help requests locally; substantive questions still pass
 * through grounded retrieval and therefore cannot become a general chatbot.
 */
export function classifyPolicyIntent(prompt: string): PolicyIntent {
  const value = normalized(prompt);
  if (/^(hi|hello|hey|hiya|greetings|good morning|good afternoon|good evening)$/.test(value)) {
    return { kind: "conversation", response: "Hello! I can help you find information in the approved company policy documents. What policy would you like to ask about?" };
  }
  if (/^(thanks|thank you|thankyou|thx)$/.test(value)) {
    return { kind: "conversation", response: "You’re welcome! Ask me anytime about the approved company policies." };
  }
  if (/^(bye|goodbye|see you|see ya)$/.test(value)) {
    return { kind: "conversation", response: "Goodbye! I’ll be here when you need help with company policies." };
  }
  if (/^(how are you|how's it going|how is it going)$/.test(value)) {
    return { kind: "conversation", response: "I’m ready to help you with the approved company policy documents. What would you like to know?" };
  }
  if (/^(who are you|what are you|what can you do|help|help me)$/.test(value)) {
    return { kind: "conversation", response: "I’m the company policy assistant. I answer questions using approved policy documents, provide citations for grounded answers, and decline unrelated substantive questions." };
  }
  if (/^(tell me|show me|give me|what are|summarize|summarise)?\s*(about\s+)?(the\s+|company\s+|our\s+)?polic(y|ies)$/.test(value)
    || /^(policy|policies|company policy|company policies|policy overview|policies overview)$/.test(value)) {
    return { kind: "policy_overview" };
  }
  return { kind: "policy_question" };
}
