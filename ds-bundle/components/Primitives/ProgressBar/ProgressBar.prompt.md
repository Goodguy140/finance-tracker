# ProgressBar

Used for budget progress. Color changes based on percentage.

## Structure
```html
<div class="ft-progress-track">
  <div class="ft-progress-fill ft-progress-ok" style="width: 60%"></div>
</div>
```

## Fill modifiers
| Class | Color | When |
|---|---|---|
| `.ft-progress-ok` | emerald (#10b981) | < 80% |
| `.ft-progress-warn` | amber (#fbbf24) | 80–99% |
| `.ft-progress-critical` | red (#ef4444) | ≥ 100% |

## Budget progress card (inner stat)
Wrap each category in `.ft-stat`:
```html
<div class="ft-stat">
  <div style="display:flex;justify-content:space-between;font-size:.875rem;margin-bottom:.25rem">
    <span style="font-weight:500;color:#e2e8f0">Groceries</span>
    <span style="color:#cbd5e1;font-variant-numeric:tabular-nums">$240 / $400</span>
  </div>
  <div class="ft-progress-track">
    <div class="ft-progress-fill ft-progress-ok" style="width:60%"></div>
  </div>
</div>
```

## Spend vs budget summary header
Above the list, show a single `.ft-stat` with an overline label and the total `spent / budget` figure.

## Thresholds (match the app exactly)
```
progressPct = spentCents / limitCents * 100, capped at 100
if progressPct >= 100  → ft-progress-critical
if progressPct >= 80   → ft-progress-warn
else                   → ft-progress-ok
```
