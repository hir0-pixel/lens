# Control audit checklist (A / B / C)

Outcomes: **A** = wired to real logic · **B** = disabled + reason · **C** = removed

| Control | Location | Outcome | Notes |
|---------|----------|---------|-------|
| Browser Back / Forward | `BrowserView.tsx` | A | History stack for navigated URLs |
| Browser Reload | `BrowserView.tsx` | A | Already worked |
| Browser Bookmark (star) | `BrowserView.tsx` | B | “Bookmarks require a synced account — coming soon” |
| Browser Select to Edit | `BrowserView.tsx` | B | Element picker not ready |
| Browser sr-only placeholder | `BrowserView.tsx` | C | Removed |
| Plans Switch / Current | `PlansDialog.tsx` | B | Billing checkout not connected |
| Import Local folder | `ImportDialog.tsx` | A | Calls `openFolder()` |
| Import GitHub | `ImportDialog.tsx` | A | Opens Clone repo dialog |
| Import v0 / Lovable / Replit / Bolt | `ImportDialog.tsx` | B | “Coming soon” + opacity |
| ProjectToolbar Deploy | `ProjectToolbar.tsx` | B | Needs hosting provider |
| TopBar Deploy | `TopBar.tsx` | B | Same (legacy chrome) |
| TopBar provider rows | `TopBar.tsx` | B | Point users to composer model picker |
| TopBar GitHub sync | `TopBar.tsx` | B | Connect GitHub first |
| Open in file explorer | `EmptySessionView.tsx` | A | `revealInFolder` via opener |
| Cloud Agents menu item | `EmptySessionView.tsx` | B | Needs Orchids account |
| Mic button | `EmptySessionView.tsx` | B | Already disabled |
| Connect GitHub (welcome) | `WelcomeScreen.tsx` | B | Already disabled |
| Explorer “More Actions…” | `ExplorerPanel.tsx` | C | Removed (no menu) |
| Debug Start Debugging | `DebugPanel.tsx` | B | No debug adapter |
| Run → Start Debugging menu | `menuRegistry.ts` | B | Disabled with peers |
| StatusBar Notifications | `StatusBar.tsx` | B | Notification center coming soon |
| Tools Logs / Memory / Database | `ToolsWorkspace.tsx` | B | Stub panes labeled “Coming soon” |
| EmptyState recent rows | `EmptyState.tsx` / `AIPanel` | A | Wired via `onProjectChange` |
| Review Accept / Reject | `ReviewChangesPanel.tsx` | A | Session ledger status (local) |
| Multitask / Plan New Idea | `EmptySessionView.tsx` | A | Already wired |
| New Agent / Open Folder / Terminal / Browser / IDE / Exit | File menu | A | Prior pass |
| Ctrl+N New Agent | shortcuts | A | Bound |
| Ctrl+O Open Folder | shortcuts | A | Bound |
| Ctrl+Shift+N Open IDE | shortcuts | A | Bound this pass |
| Ctrl+Shift+A Agents | shortcuts | A | Bound → new agent |
| Ctrl+Shift+` New Terminal | shortcuts | A | Bound |
| Ctrl+F Find / Ctrl+H Replace | shortcuts | A | Bound |
| F5 Start Debugging | shortcuts | A | Opens debug panel (empty until adapter) |
| Selection multi-cursor menu items | `menuRegistry.ts` | B | Already `disabled: true` |
| SSH / Docker terminal shells | `TerminalToolbar.tsx` | B | Already disabled |
| Branch merge / rebase | `BranchSwitcher.tsx` | B | Already disabled |
| Orchids wordmark | TitleBar + Welcome | A | Space Grotesk `--font-display` |

## Wordmark
- Font: **Space Grotesk** 600 via Google Fonts
- Token: `--font-display` in `index.css`
- Applied only via `OrchidsWordmark` (title bar + welcome lockup)
