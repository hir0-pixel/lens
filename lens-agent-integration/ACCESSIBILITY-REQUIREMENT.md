# Accessibility — text for Doc 001 §10

Add the following row to **Doc 001 §10 Cross-Cutting Requirements (binding on every subsystem document)**. It is binding on every subsystem with a user interface, the same way audit logging and zero-egress are binding today.

---

## Row to insert

| ID | Requirement | Gate |
|---|---|---|
| **Perceivability and operability (accessibility)** | Every subsystem with a user interface conforms to **WCAG 2.2 Level AA** as a binding non-functional requirement. Sub-requirements: **(1) keyboard** — every interactive control is reachable and operable from the keyboard without a pointing device; **(2) focus** — keyboard focus is always visible and meets WCAG 2.4.7 / 2.4.11; **(3) contrast** — text and icons that convey information meet WCAG 1.4.3 (4.5:1 normal text, 3:1 large text) against their effective background; **(4) assistive-technology announcement of state changes** — dynamic status transitions (loading, progress, completion, denial, error) are exposed to assistive technology via live regions or equivalent semantics so users are not required to infer state from visual cues alone. | Automated contrast test over `DESIGN-lens.md` foreground/background pairs that carry real text (not purely decorative chrome). Hold: `a11y.palette-contrast-aa` in `tests/unit/paletteContrast.test.ts`. Seeded from design-review finding F-A2: `#A09C92` on `#F7F7F4` = **2.55:1** (fails AA); ratified tertiary replacement `#6E6A62` on `#F7F7F4` passes. Every ratified informational pair in the palette contract must meet 4.5:1 before merge. |

---

## Notes for document owner

- This closes design-review finding **F-A1** (no accessibility requirement in the baseline).
- Detailed UI contracts (focus-ring coverage, `aria-live` for agent progress) land in follow-on modules F-A3/F-A4; this row makes the NFR binding and seeds the first automated gate (F-A5).
- Change control: Doc 001 §12 governs edits to §10's binding list.
