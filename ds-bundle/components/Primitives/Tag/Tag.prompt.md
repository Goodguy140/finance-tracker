# Tag

Colored pill label used for status, career-path identity, income ranges, and phase labels on timeline events.

## Structure
```html
<span style="display:inline-flex;align-items:center;border-radius:9999px;border:1px solid <color>35;background:<color>18;color:<color>;padding:2px 10px;font-size:11px;font-weight:600;letter-spacing:.025em;white-space:nowrap">
  On Track
</span>
```

## Accent palette (from `P` in theme.js)
| Name | Hex | Use |
|---|---|---|
| Gold | `#C9A44C` | Path A / mixed/gold path |
| Red | `#D94F3D` | High risk, departure fund |
| Emerald | `#1D9E75` | On track, done, healthy |
| Blue | `#3A82C4` | Remote, info |
| Violet | `#6B5CE7` | Learning, B5 career path |
| Orange | `#F97316` | Hybrid path |

## Status tags (semantic palette)
- Active / done → `color: #a7f3d0` (emerald-200), emerald border/bg tint
- In Progress → `color: #fbbf24` (amber), amber border/bg tint
- Overdue → `color: #fca5a5` (red-300), red border/bg tint
- Paused → `color: #94a3b8`, slate border/bg tint

## Income range tags (on timeline events)
```html
<span style="font-size:10px;font-weight:600;border-radius:9999px;border:1px solid rgb(107 92 231/.3);background:rgb(107 92 231/.15);color:#6B5CE7;padding:1px 8px;margin-left:6px">
  $85K–$110K
</span>
```
