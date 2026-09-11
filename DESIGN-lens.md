# DESIGN-lens.md — Lens palette contract

This is the single source of truth for Lens colour. It supersedes
`DESIGN-vercel.md` for every token; `DESIGN-cursor.md` remains the reference
for Cursor-sourced values. Tests assert against this file.

Sources: **Cursor** (chrome, ink, light surfaces), **Perplexity** (dark
surfaces, dark secondary text, dark borders), and one bespoke accent.

## Roles

| Role | Light | Dark | Source |
|---|---|---|---|
| Canvas / chrome | `#F7F7F4` | `#141414` | Cursor |
| AI / main panel | `#FDFBFA` | `#181818` | Perplexity / Cursor |
| User bubble / raised / hover | `#F2F1ED` | `#232325` | Cursor / Perplexity |
| Primary text (ink) | `#26251E` | `#F0F0F0` | Cursor |
| Secondary text | `#5A5852` | `#9B9B9B` | Cursor / Perplexity |
| Tertiary text / placeholder | `#A09C92` | `#9B9B9B` | Cursor · *inferred, ratify* |
| Border | `#E6E5E0` | `#2E2E30` | Cursor / Perplexity |
| Accent | `#3183D8` | `#3183D8` | bespoke |
| Accent hover | `#5A9BE0` | `#5A9BE0` | derived |
| Accent active | `#1D62AA` | `#1D62AA` | derived |
| Primary button | bg `#3183D8`, text `#141312` | same | bespoke |
| Neutral button | `#F2F1ED` | `#232325` | Cursor / Perplexity |
| Focus ring | `#3183D8` | `#3183D8` | bespoke |

`#26251E` is ink only — never a button or surface. `#171717` is retired.

## Workbench map (`src/shared/design-system/cursorTokens.ts`)

Light only today; dark values above apply when a dark workbench map is added.

| Token group | Light |
|---|---|
| `sideBarBg`, `activityBarBg`, `panelBg`, `statusBarBg`, `editorGroupHeaderTabsBg`, `tabInactiveBg` | `#F7F7F4` |
| `editorBg`, `titleBar*Bg`, `tabActiveBg` | `#FDFBFA` |
| `inputBg`, `dropdownBg`, `menuBg`, `quickInputBg` | `#FDFBFA` · *inferred: lightest surface reads as raised* |
| every `*Border`, `widgetBorder` | `#E6E5E0` |
| `activityBarActiveBorder`, `panelTitleActiveBorder`, `tabActiveBorderTop`, `focusBorder` | `#3183D8` |
| `foreground`, `editorFg`, `*ActiveFg`, `inputFg` | `#26251E` |
| `sideBarFg`, `statusBarFg`, `descriptionFg` | `#5A5852` |
| `*InactiveFg`, `inputPlaceholder` | `#A09C92` · *inferred* |
| `listHoverBg`, `menuSelectionBg`, `statusBarHoverBg` | `#F2F1ED` |
| `listActiveSelectionBg` | `#E6E5E0` |
| `buttonBg` / `buttonFg` / `buttonHoverBg` | `#3183D8` / `#141312` / `#5A9BE0` |
| `buttonSecondaryBg` | `#F2F1ED` |
| `errorFg` | `#B91C1C` · *matches themeManager danger; ratify* |
| `scrollbarSlider` / `scrollbarSliderHover` | `#A09C92` / `#807D72` · *inferred from DESIGN-cursor.md* |

## In use in `themeManager.ts`, not yet ratified

These appear in the CSS custom-property layer and are not in the role table.
Keep or replace — designer decision pending.

`#818581` `#5F6368` `#8E918F` `#B5CEF5` `#FCFCF9` `#F1F0EC` `#D8D4CD`
`#2A2F37` `#001D3C` `#D9923A` `#F5A623` · danger `#B91C1C` · success `#26D862`

## Accent presets (`ACCENT_COLORS`)

User-selectable alternatives to the default accent. Retained pending review:
amber `#AB570A`, emerald/cyan `#50E3C2`, violet `#7928CA`, rose `#FF0080`.
