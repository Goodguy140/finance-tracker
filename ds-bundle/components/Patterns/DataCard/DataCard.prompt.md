# DataCard

Interactive panel containing editable rows and snapshot stats. Used for budget lists, account balances, departure fund checklist, and savings milestone tables.

## Editable list row (budget / fund items)
```html
<div style="display:flex;align-items:center;gap:.625rem;padding:6px 0;border-bottom:1px solid #1e293b">
  <input style="flex:1;font-size:13px;color:#e2e8f0;background:rgb(2 6 23/.5);border:1px solid #334155;border-radius:9px;padding:4px 9px;outline:none" value="Rent">
  <span style="font-size:12px;font-weight:500;color:#94a3b8">$</span>
  <input type="number" style="width:96px;font-size:13px;color:#e2e8f0;background:rgb(2 6 23/.5);border:1px solid #334155;border-radius:9px;padding:4px 9px;outline:none;font-variant-numeric:tabular-nums" value="1350">
  <button style="background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;padding:0 4px;line-height:1">×</button>
</div>
```
On focus: `border-color: #60a5fa; box-shadow: 0 0 0 2px rgb(59 130 246 / .2)`.

## Total / summary row
```html
<div style="display:flex;justify-content:space-between;padding:10px 0 0;font-size:13px;font-weight:600">
  <span>Total outflows</span>
  <span style="font-variant-numeric:tabular-nums">$1,906/mo</span>
</div>
```

## Result banner (success / warning)
```html
<!-- Success (room available) -->
<div style="border-radius:.75rem;border:1px solid rgb(16 185 129/.35);background:rgb(16 185 129/.1);color:#a7f3d0;padding:10px 12px;font-size:12px;line-height:1.7;margin-top:.625rem">
  <span style="font-weight:500">Savings room:</span> $3,294/mo of headroom.
</div>

<!-- Warning (gap) -->
<div style="border-radius:.75rem;border:1px solid rgb(245 158 11/.35);background:rgb(120 53 15/.25);color:#fbbf24;padding:10px 12px;font-size:12px;line-height:1.7;margin-top:.625rem">
  Income gap: spending exceeds income by $300/mo.
</div>
```

## Snapshot KPI card (editable inline value)
```html
<div style="border-radius:.75rem;border:1px solid #1e293b;background:rgb(2 6 23/.5);padding:.625rem">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:2px">Current savings</div>
  <input style="width:100%;font-size:.875rem;font-weight:600;color:#e2e8f0;background:transparent;border:1px solid transparent;border-radius:8px;padding:2px 4px;outline:none" value="$24,500">
</div>
```

## Card header pattern
```html
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
  <span style="font-size:.75rem;color:#94a3b8">Monthly budget</span>
  <button style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:9px;border:1px solid rgb(29 158 117/.4);background:rgb(29 158 117/.1);color:#1D9E75;cursor:pointer">+ Add row</button>
</div>
```
