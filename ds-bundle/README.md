# Finance Tracker — Design System

Dark-first, Tailwind-inspired design language extracted from the Finance Tracker Next.js application. All tokens ship as CSS custom properties; all component styles ship as CSS utility classes in `_ds_bundle.css`.

---

## Setup

Include `styles.css` (which imports `_ds_bundle.css`) in the page `<head>`. No JavaScript bundle is required for static HTML usage.

```html
<link rel="stylesheet" href="styles.css">
```

The body needs a dark background: `background: var(--ft-bg); color: var(--ft-fg); font-family: var(--ft-font)`.

---

## Styling idiom — CSS utility classes

This is a **class-based** design system. Style every element with `ft-*` CSS classes from `_ds_bundle.css`. Do **not** write inline `background-color: #020617` or hardcoded colors — use `var(--ft-*)` tokens or the pre-built classes.

### Surfaces
```html
<!-- Panel shell -->
<div class="ft-panel"> … </div>

<!-- Inner stat cell -->
<div class="ft-stat"> … </div>
```

### Typography
```html
<h1 class="ft-h1">Finance Tracker</h1>
<h2 class="ft-h3">Expense Log</h2>
<p class="ft-caption">June 2026</p>
<p class="ft-overline">Expected income</p>
<p class="ft-income ft-tabular">$4,250.00</p>
```

### Buttons
```html
<button class="ft-btn-primary">Add expense</button>
<button class="ft-btn-secondary">Cancel</button>
<button class="ft-btn-icon" aria-label="Alerts"><!-- svg --></button>
```

### Inputs
```html
<div class="ft-field-label">
  <span>Amount</span>
  <div style="position:relative">
    <span style="position:absolute;inset-y:0;left:.75rem;display:flex;align-items:center;font-size:.75rem;font-weight:500;color:#93c5fd">CAD $</span>
    <input class="ft-input" style="padding-left:4rem" type="number" step="0.01">
  </div>
</div>
```

### Badges
```html
<span class="ft-chip"><span class="ft-chip-key">Account</span><span class="ft-chip-val">Visa</span></span>
<span class="ft-pill ft-pill-chequing">Chequing</span>
<span class="ft-badge">3</span>
```

### Progress bar (budget)
```html
<div class="ft-progress-track">
  <div class="ft-progress-fill ft-progress-warn" style="width:85%"></div>
</div>
```
Threshold: `< 80%` → `ft-progress-ok`; `80–99%` → `ft-progress-warn`; `≥ 100%` → `ft-progress-critical`.

### Alert rows
```html
<div class="ft-alert ft-alert-critical">
  <div style="display:flex;align-items:flex-start;gap:.5rem">
    <span class="ft-alert-dot ft-dot-critical"></span>
    <div>
      <p style="font-size:.875rem;font-weight:500;color:#f1f5f9">Entertainment is over budget</p>
      <p style="font-size:.75rem;color:#94a3b8">$150.00 / $100.00</p>
    </div>
    <button class="ft-btn-secondary" style="min-height:0;padding:.25rem .5rem;font-size:.75rem">Dismiss</button>
  </div>
</div>
```

---

## Amount color rules
| Situation | Class |
|---|---|
| Income / receipts | `.ft-income` |
| Expense amounts | `.ft-expense` |
| Positive net cash flow | `.ft-net-pos` |
| Negative net cash flow | `.ft-net-neg` |

All monetary values must use `.ft-tabular` (`font-variant-numeric: tabular-nums`).

---

## Layout
- Max content width: `max-width: 80rem` (1280px)
- Main breakpoint: `1024px` (desktop sidebar grid kicks in)
- Card spacing: `gap: 1rem` between panels
- Main grid on desktop: `grid-template-columns: repeat(12, 1fr)` — left column 7 spans, right column 5 spans

---

## Where to look
- Design tokens: `tokens/design-tokens.json`
- CSS classes: `_ds_bundle.css`
- Per-component usage: `components/<Group>/<Name>/<Name>.prompt.md`
- Visual previews: `components/<Group>/<Name>/index.html`
