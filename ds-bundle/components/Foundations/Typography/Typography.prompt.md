# Typography

## Font stack
- Sans: `"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif` — use for all UI text
- Mono: `"SFMono-Regular", Menlo, Monaco, Consolas, monospace` — dates, code

## Text scale (via CSS utility classes)
| Class | Size / Weight | Use |
|---|---|---|
| `.ft-h1` | 1.5rem / bold / tracking-tight | Page title |
| `.ft-h2` | 1.25rem / bold / tracking-tight | Section heading |
| `.ft-h3` | 1.125rem / semibold | Card heading |
| `.ft-body` | 0.875rem / slate-200 | Default body |
| `.ft-body-sm` | 0.75rem / slate-200 | Secondary body |
| `.ft-caption` | 0.75rem / slate-400 | Metadata, descriptions |
| `.ft-dim` | 0.75rem / slate-500 | Tertiary, counts, hints |
| `.ft-overline` | 10px / semibold / uppercase / tracking-wide / slate-400 | Stat box labels |

## Amount rendering
All monetary values use `font-variant-numeric: tabular-nums` (`.ft-tabular`).
- Income: `.ft-income` → `color: var(--ft-emerald-text)` (#a7f3d0)
- Expenses: `.ft-expense` → `color: #bfdbfe` (blue-100)
- Positive net: `.ft-net-pos` → emerald-text
- Negative net: `.ft-net-neg` → `color: var(--ft-red-text)` (#fecaca)

## Links
`.ft-link` → `color: var(--ft-blue-link)` with `text-underline-offset: 4px`, underline on hover.
