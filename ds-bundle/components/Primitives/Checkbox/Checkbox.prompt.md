# Checkbox

## Single checklist item
```html
<div style="display:flex;align-items:center;gap:.625rem;padding:.375rem 0">
  <!-- unchecked -->
  <button style="width:18px;height:18px;border-radius:5px;border:1.5px solid #334155;background:transparent;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer"></button>
  <span style="font-size:13px;color:#e2e8f0">Complete driving lesson 14</span>
</div>

<!-- checked + strikethrough -->
<div style="display:flex;align-items:center;gap:.625rem;padding:.375rem 0">
  <button style="width:18px;height:18px;border-radius:5px;border:1.5px solid #1D9E75;background:#1D9E75;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#020617" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <span style="font-size:13px;color:#94a3b8;text-decoration:line-through;opacity:.55">Research TFSA contribution room</span>
</div>
```

## Habit grid cell (compact)
```html
<button style="width:20px;height:20px;border-radius:5px;border:1px solid #1D9E75;background:#1D9E75;cursor:pointer"></button>
<!-- empty -->
<button style="width:20px;height:20px;border-radius:5px;border:1px solid #334155;background:transparent;cursor:pointer"></button>
```

## Accent colors by context
- Career / goals (checkable steps): use path accent color (e.g. `#6B5CE7` violet)
- Habits: use `#1D9E75` emerald
- Departure fund items: use `#D94F3D` red
- General tasks: use `#3A82C4` blue

## Done state
Apply `opacity: .55` and `text-decoration: line-through` to the label text when checked.
