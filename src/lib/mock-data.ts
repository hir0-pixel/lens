import type {
  ChatMessage,
  Model,
  Project,
  ProviderState,
} from "./types";

export const MODELS: Model[] = [
  { id: "orchids-default", label: "Orchids Default", provider: "orchids" },
  { id: "claude-opus", label: "Claude Opus 4.5", provider: "claude" },
  { id: "claude-sonnet", label: "Claude Sonnet 4.5", provider: "claude" },
  { id: "gpt-5", label: "GPT-5.1", provider: "chatgpt" },
  { id: "gpt-4o", label: "GPT-4o", provider: "chatgpt" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
  { id: "copilot-omnigrok", label: "Copilot Omnigrok", provider: "copilot" },
];

export const INITIAL_THREAD: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    content:
      "Let's build a personal finance dashboard. I want a dark theme, a sidebar with navigation, and a monthly cash-flow chart.",
    timestamp: "2:14 PM",
    checkpoint: "ckpt-m1",
    attachments: [
      {
        id: "a1",
        name: "finance-mockup.png",
        kind: "image",
        sizeLabel: "1.2 MB",
      },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "Great — I'll scaffold the app with a dark dashboard layout, sidebar nav, and a cash-flow chart. Here's the plan:\n\n1. Vite + React + Tailwind project structure\n2. Sidebar with Overview, Accounts, Budgets, Settings\n3. Cash-flow chart with monthly aggregates\n4. Mock data layer so it runs immediately",
    timestamp: "2:15 PM",
    model: "Claude Sonnet 4.5",
    toolCalls: [
      {
        id: "t1",
        name: "create_project",
        detail: "Scaffolded vite react-ts template",
        status: "done",
        durationMs: 1840,
      },
      {
        id: "t2",
        name: "write_file",
        detail: "src/components/Sidebar.tsx",
        status: "done",
        durationMs: 512,
      },
      {
        id: "t3",
        name: "write_file",
        detail: "src/components/CashFlowChart.tsx",
        status: "done",
        durationMs: 640,
      },
      {
        id: "t4",
        name: "run_command",
        detail: "npm run dev",
        status: "done",
        durationMs: 210,
      },
    ],
    fileEdits: [
      {
        path: "src/App.tsx",
        language: "tsx",
        summary: "Wire up layout shell with sidebar + main",
        additions: 42,
        deletions: 6,
      },
      {
        path: "src/components/Sidebar.tsx",
        language: "tsx",
        summary: "Navigation with active states and icons",
        additions: 88,
        deletions: 0,
      },
      {
        path: "src/components/CashFlowChart.tsx",
        language: "tsx",
        summary: "Monthly cash-flow bar chart",
        additions: 76,
        deletions: 0,
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    content:
      "The chart looks good. Can you make the accent color amber and add a savings goal tracker to the sidebar?",
    timestamp: "2:17 PM",
    checkpoint: "ckpt-m3",
  },
  {
    id: "m4",
    role: "assistant",
    content:
      "Done. The accent is now amber (#FCAA26) across the app, and the sidebar has a new **Savings Goals** entry with a progress tracker. I updated the mock data to include three goals.",
    timestamp: "2:17 PM",
    model: "Claude Sonnet 4.5",
    toolCalls: [
      {
        id: "t5",
        name: "edit_file",
        detail: "src/index.css — accent token swap",
        status: "done",
        durationMs: 130,
      },
      {
        id: "t6",
        name: "write_file",
        detail: "src/components/SavingsGoals.tsx",
        status: "done",
        durationMs: 480,
      },
    ],
    fileEdits: [
      {
        path: "src/index.css",
        language: "css",
        summary: "Swap accent to amber #FCAA26",
        additions: 3,
        deletions: 3,
      },
      {
        path: "src/components/SavingsGoals.tsx",
        language: "tsx",
        summary: "Savings goals tracker with progress bars",
        additions: 64,
        deletions: 0,
      },
    ],
  },
];

export const INITIAL_PROJECTS: Project[] = [
  {
    id: "p1",
    name: "finance-dashboard",
    stack: "React · Vite · Tailwind",
    path: "~/dev/finance-dashboard",
    branch: "main",
    deployStatus: "live",
    deployedUrl: "https://finance-dashboard.orchids.app",
    updatedAt: "2 min ago",
    color: "#FCAA26",
  },
  {
    id: "p2",
    name: "chrome-buddy-extension",
    stack: "TypeScript · Manifest V3",
    path: "~/dev/chrome-buddy",
    branch: "feat/dark-mode",
    deployStatus: "building",
    updatedAt: "18 min ago",
    color: "#34D399",
  },
  {
    id: "p3",
    name: "slack-standup-bot",
    stack: "Python · FastAPI",
    path: "~/dev/slack-standup-bot",
    branch: "main",
    deployStatus: "idle",
    updatedAt: "yesterday",
    color: "#60A5FA",
  },
  {
    id: "p4",
    name: "invoice-pdf-generator",
    stack: "Node · PDFKit",
    path: "~/dev/invoice-pdf",
    branch: "main",
    deployStatus: "failed",
    updatedAt: "3 days ago",
    color: "#F472B6",
  },
  {
    id: "p5",
    name: "landing-copy-site",
    stack: "Next.js · MDX",
    path: "~/dev/landing-copy",
    branch: "main",
    deployStatus: "idle",
    updatedAt: "last week",
    color: "#A78BFA",
  },
];

export const INITIAL_PROVIDERS: ProviderState[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    connected: true,
    via: "subscription",
    defaultModel: "GPT-5.1",
  },
  {
    id: "claude",
    name: "Claude Code",
    connected: true,
    via: "subscription",
    defaultModel: "Claude Sonnet 4.5",
  },
  {
    id: "gemini",
    name: "Gemini",
    connected: false,
    via: "api-key",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    connected: true,
    via: "api-key",
    keyLabel: "github_pat_••••••••8f2",
  },
];

export const PLANS = [
  {
    name: "Pro",
    monthly: 21,
    annual: 21,
    creditsPerMonth: "2M",
    creditsLabel: "2 million credits / month",
    features: ["Standard agent", "Community support"],
    highlight: false,
  },
  {
    name: "Premium",
    monthly: 42,
    annual: 42,
    creditsPerMonth: "4M",
    creditsLabel: "4 million credits / month",
    features: ["Standard agent", "Priority support"],
    highlight: true,
  },
  {
    name: "Ultra",
    monthly: 83,
    annual: 83,
    creditsPerMonth: "12M",
    creditsLabel: "12 million credits / month",
    features: ["Advanced agent", "Priority support"],
    highlight: false,
  },
  {
    name: "Max",
    monthly: 168,
    annual: 168,
    creditsPerMonth: "30M",
    creditsLabel: "30 million credits / month",
    features: ["Advanced agent", "Dedicated support"],
    highlight: false,
  },
];
