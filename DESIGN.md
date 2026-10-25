# DESIGN.md — Free Game Hunter

The design contract for the extension's own UI (popup + options). Every UI change must be able
to point back to a line here.

## Concept

**The Hunt.** A quiet reticle on a dark field. The tool does one job — find the deal, take the
deal — so the interface stays matte and precise, and exactly one accent marks what you can act
on. Amber appears only as data (a discount number), never as decoration.

- **Motion verb:** snap. Small, fast, precise movement. Nothing floats, nothing loops.
- **Signature moment:** the scan reveal — results rise in with a 20 ms stagger, once, as
  feedback for the scan action. Not an idle animation.
- **Idle state:** still, by decision. This is a utility popup; hover/press/focus answers are the
  life it needs.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| `--bg0` | `#0c1116` | page ground |
| `--bg1` | `#131a21` | panels (results, history) |
| `--bg2` | `#1b242e` | hover surface |
| `--line` | `#263341` | hairline borders |
| `--ink` | `#e9eef3` | primary text |
| `--ink2` | `#9db0c0` | secondary text |
| `--ink3` | `#74889b` | hints / footnotes (≥ 4.5:1 on bg0) |
| `--green` | `#46c26a` | the accent — primary CTA, checked state, claimable price. Used at the key moment only. |
| `--amber` | `#e5a13c` | discount data badge only |
| `--red` | `#d96a6a` | failure text only |

No gradients, no glass, no glow, no shadows. Elevation is communicated by a single hairline
border between ground and panel.

## Type

System UI stack (`Segoe UI`, system-ui, sans-serif). Reason: extension pages run in Chrome's
sandbox — remote fonts are both a CSP risk and a pointless dependency, and the user base is on
Windows where the system stack renders well. Sentence case everywhere; no letter-spacing games.

Scale: 13.5px body, 12px secondary, 11px hints, 15px h1. Titles are 650 weight, never bold-scream.

## Shape

One radius rule: 6px on controls and rows, 8px on the primary CTA and panels. Nothing pill-shaped.

## States (every interactive element)

- **Hover:** surface or fill shift, 120 ms.
- **Active:** 1px press-down (`translateY(1px)`).
- **Focus-visible:** 2px `--green` outline, 2px offset — on buttons, inputs, links, slider.
- **Disabled:** 0.45 opacity + explanatory hint nearby (auto-checkout below 100% slider).
- **Empty:** status line names the cause and the next action ("No deals ≥ 50% here — lower the
  slider or open a page with discounts").
- **Busy:** scan button disabled + status line says what is running (`aria-live="polite"`).

## Motion budget

1. Scan reveal stagger (one-shot, capped at 12 rows).
2. Hover/press/focus transitions (120 ms).
3. Everything else: `prefers-reduced-motion` respected — the reveal is removed, states remain.
