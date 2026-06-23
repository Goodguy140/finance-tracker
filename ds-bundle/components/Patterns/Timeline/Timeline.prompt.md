# Timeline

Vertical step-by-step timeline used for career roadmaps and goal sequences. Each event has a dot, connector line, phase label, title, and note. Steps can be checkable.

## Structure
```html
<div style="position:relative;padding-left:8px">
  <!-- Item (not last) -->
  <div style="display:flex;gap:14px;padding-bottom:18px;position:relative">
    <!-- Connector line (hidden on last item) -->
    <div style="position:absolute;left:7px;top:16px;width:2px;height:calc(100% - 8px);background:rgb(<accent> / .3)"></div>

    <!-- Dot -->
    <div style="width:16px;height:16px;border-radius:50%;border:2px solid <accent>;background:<accent>;flex-shrink:0;margin-top:2px;position:relative;z-index:1"></div>

    <!-- Body -->
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
        <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:<accent>">Phase 1</span>
        <!-- optional income tag -->
        <span style="font-size:10px;font-weight:600;border-radius:9999px;border:1px solid <accent>30;background:<accent>18;color:<accent>;padding:1px 8px">$85K–$110K</span>
      </div>
      <p style="font-size:13px;font-weight:500;color:#e2e8f0;margin:0 0 2px;line-height:1.35">Senior Engineer role</p>
      <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.65">Land a senior IC role at a FAANG-adjacent company.</p>
    </div>

    <!-- Checkbox (optional) -->
    <div style="width:18px;height:18px;border-radius:5px;border:1.5px solid #334155;background:transparent;flex-shrink:0;margin-top:2px"></div>
  </div>
</div>
```

## Dot variants
- **Filled** (`background: <accent>`) — current or solid step
- **Empty** (`background: #020617`) — future unfilled step
- **Fork** — empty dot with a center inner circle `6×6px background: <accent>` — for DECISION points
- **Done** — filled with check icon; set body `opacity: .5` and title `text-decoration: line-through`

## Accent colors
Use the path/section's primary accent consistently for all dots, connector lines, and phase labels:
- Career B5 path: `#6B5CE7` violet
- Career B3 path: `#1D9E75` emerald
- Career B4 path: `#3A82C4` blue
- Goals: `#1D9E75` emerald
- Skills: `#6B5CE7` violet

## Connector line
`position:absolute; left:7px; top:16px; width:2px; height:calc(100% - 8px); background: rgb(<accent> / .3)` — omit on the last item.
