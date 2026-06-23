# Colors

Finance Tracker uses a dark-first palette with CSS custom properties prefixed `--ft-`.

## Core surfaces
| Token | Value | Use |
|---|---|---|
| `--ft-bg` | `#020617` | Page background (slate-950) |
| `--ft-surface` | `#0f172a` | Card / panel background (slate-900/80) |
| `--ft-border` | `#1e293b` | Default border (slate-800) |
| `--ft-border-subtle` | `#334155` | Input / button border (slate-700) |

## Foreground
| Token | Value | Use |
|---|---|---|
| `--ft-fg` | `#e2e8f0` | Primary text (slate-200) |
| `--ft-fg-muted` | `#94a3b8` | Secondary / metadata (slate-400) |
| `--ft-fg-dim` | `#64748b` | Tertiary / placeholder (slate-500) |

## Accent — Blue
Used for primary actions, focus rings, links.
- `--ft-blue` `#3b82f6` — button fill
- `--ft-blue-hover` `#60a5fa` — button hover, focus border
- `--ft-blue-link` `#93c5fd` — inline links, manage links

## Semantic
| Token | Meaning |
|---|---|
| `--ft-emerald` / `--ft-emerald-text` | Income amounts, healthy budget progress |
| `--ft-amber` / `--ft-amber-bar` | Warning severity, budget 80–100% bar |
| `--ft-red` / `--ft-red-text` | Critical/over-budget, negative net amounts |

## Account type tones
Each account type has a pill color: Chequing → emerald, Savings → sky, Credit Card → violet, TFSA/RRSP/FHSA → amber, Cash → lime, Other → slate. Use `.ft-pill-{type}` classes.
