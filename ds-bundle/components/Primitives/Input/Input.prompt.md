# Input

## Base classes
| Element | Class |
|---|---|
| Text / number / date input | `.ft-input` |
| `<select>` | `.ft-select` |
| `<textarea>` | `.ft-textarea` |

All share: `border-radius: .75rem; border: 1px solid #334155; background: rgb(2 6 23 / .7); padding: .625rem .75rem; font-size: .875rem; color: #f1f5f9; min-height: 2.75rem`.

Focus ring: `border-color: #60a5fa; box-shadow: 0 0 0 2px rgb(59 130 246 / .2)`.

## Label pattern
```html
<div class="ft-field-label">
  <span>Transaction title</span>
  <input class="ft-input" placeholder="e.g. Groceries">
</div>
```
Label text style: `font-size: .875rem; font-weight: 500; color: #e2e8f0`.

## Currency amount input
Wrap in `position: relative`. Add a `<span>` prefix (absolute, left .75rem, vertically centered) with `font-size: .75rem; font-weight: 500; letter-spacing: .025em; color: #93c5fd` containing "CAD $". Then add `padding-left: 4rem` to the input.

## Floating label variant
Inside a `position: relative` wrapper, add:
```html
<span style="position:absolute;left:.75rem;top:-.5rem;z-index:10;background:#0f172a;padding:0 .25rem;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8">
  Category
</span>
```

## Two-column form grid
`display: grid; grid-template-columns: 1fr 1fr; gap: .75rem` — used for amount + date side by side.
