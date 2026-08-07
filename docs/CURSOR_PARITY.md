# Cursor Pixel Parity — Reconstruction Log

## Spec sources
- VS Code `dark_modern.json`
- ActivitybarPart: 48 / 48 / 24
- Monaco list / explorer row height: **22px**
- Tree indent: **8px**/level
- Quick input bg: `#222222`, selection `#04395E`

## Rebuilt this iteration
| Surface | Cursor behavior matched |
|---------|-------------------------|
| Motion engine | `cursorMotion.ts` — 80/100/120/180/200ms + cubic-bezier |
| Explorer | Full tree, twisties, 22px rows, hover/selection, context menu |
| Editor tabs | Close-on-hover, middle-click close, dirty dot, open-from-explorer |
| Breadcrumbs | 22px strip under tabs |
| Command palette | 22px quick-pick rows, `#04395E` selection, 28px input |
| List CSS | `.cursor-list-row` / `.cursor-quick-item` |

## Animations / transitions
- Hover color 100ms soft ease on explorer, tabs, status, activity
- Tab close opacity 100ms
- Panel/open fade + slide
- Palette scale-in 200ms decelerate
- Context menu fade
- Twistie expand/collapse 120–180ms

## Remaining (must keep iterating)
1. Codicons font (still Lucide)
2. Real File/Edit menu dropdowns
3. Drag-reorder tabs / explorer DnD
4. Inline rename in explorer
5. Agents Window chrome parity
6. Settings UI still Orchids-shaped
7. Full Monaco tab groups + sticky scroll chrome
8. Native scroll inertia (Chromium vs Electron differences)

## Run
```bash
npm run tauri dev
```
Compare side-by-side with Cursor Dark Modern.
