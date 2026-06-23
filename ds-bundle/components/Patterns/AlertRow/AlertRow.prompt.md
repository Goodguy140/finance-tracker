# AlertRow

Alert rows appear inside the budget alerts panel (bell icon dropdown).

## Severities
| Class | Use |
|---|---|
| `.ft-alert-critical` | Over-budget (≥ 100%) |
| `.ft-alert-warning` | Near budget (80–99%) |
| `.ft-alert-pace` | On pace to exceed budget |
| `.ft-alert-neutral` | Month-over-month trend |

## Structure with dismiss button
```html
<div class="ft-alert ft-alert-critical">
  <div style="display:flex;align-items:flex-start;gap:.5rem">
    <span class="ft-alert-dot ft-dot-critical"></span>
    <div style="flex:1;min-width:0">
      <p style="font-size:.875rem;font-weight:500;color:#f1f5f9">Entertainment is over budget</p>
      <p style="font-size:.75rem;color:#94a3b8;font-variant-numeric:tabular-nums">$150.00 / $100.00</p>
    </div>
    <button style="flex-shrink:0;border-radius:.5rem;border:1px solid rgb(51 65 85/.8);padding:.25rem .5rem;font-size:.75rem;font-weight:500;color:#cbd5e1;background:none;cursor:pointer">
      Dismiss
    </button>
  </div>
</div>
```

## Pace / trend rows (no dot, no dismiss)
```html
<div class="ft-alert ft-alert-pace">
  <p style="font-size:.875rem;color:#e2e8f0">Groceries is on pace to exceed budget by month-end</p>
</div>
```

## Section headers inside the panel
```html
<h3 style="font-size:.625rem;font-weight:500;text-transform:uppercase;letter-spacing:.1em;color:#64748b;margin-bottom:.5rem">Warnings</h3>
```

## Full panel shell
The panel itself: `border-radius: 1rem; border: 1px solid #334155; background: rgb(2 6 23 / .98); padding: 1rem; backdrop-filter: blur(8px); box-shadow: 0 20px 25px -5px rgb(0 0 0 / .5); max-width: 22rem`.
