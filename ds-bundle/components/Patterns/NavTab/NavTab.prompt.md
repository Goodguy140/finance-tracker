# NavTab

## Primary section switcher (pill tabs)
Horizontally scrollable row of pill tabs at the top of the app. Active tab gets blue tint; inactive tabs are transparent.

```html
<!-- Active -->
<button style="padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:500;border:1px solid rgb(59 130 246/.4);background:rgb(59 130 246/.15);color:#93c5fd;cursor:pointer">
  Overview
</button>

<!-- Inactive -->
<button style="padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:400;border:1px solid transparent;background:transparent;color:#94a3b8;cursor:pointer">
  Money
</button>
```

## Segment control (within-section toggle)
Pill-shaped container with a floating active indicator.
```html
<div style="display:flex;gap:4px;background:rgb(30 41 59/.5);border-radius:9999px;padding:3px;border:1px solid #1e293b;width:fit-content">
  <button style="padding:5px 14px;border-radius:9999px;font-size:12px;font-weight:500;background:#0f172a;color:#e2e8f0;border:none;box-shadow:0 1px 3px rgb(0 0 0/.3)">This month</button>
  <button style="padding:5px 14px;border-radius:9999px;font-size:12px;color:#94a3b8;border:none;background:transparent">YTD</button>
  <button style="padding:5px 14px;border-radius:9999px;font-size:12px;color:#94a3b8;border:none;background:transparent">All time</button>
</div>
```

## Dashboard header bar
Sticky, `border-bottom: 1px solid var(--ft-border)`, subtle backdrop blur.
```html
<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b;padding-bottom:1rem;margin-bottom:1.25rem;position:sticky;top:0;z-index:40;background:#020617;backdrop-filter:blur(8px)">
  <div>
    <p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:0 0 2px">Life Dashboard</p>
    <h1 style="font-size:20px;font-weight:700;letter-spacing:-.02em;color:#f1f5f9;margin:0">Christian's future</h1>
  </div>
  <div style="display:flex;gap:8px">
    <!-- icon/text buttons: border:1px solid #334155; background:#0f172a; border-radius:10px; padding:6px 12px; font-size:12px; color:#94a3b8 -->
  </div>
</div>
```
