# Button

## Variants
| Class | Use |
|---|---|
| `.ft-btn-primary` | Blue filled — primary CTA (Add, Save, Submit) |
| `.ft-btn-secondary` | Slate bordered — cancel, settings, dismiss |
| `.ft-btn-icon` | Square icon-only (bell, plus, menu) |

All buttons have `touch-action: manipulation` and a `min-height: 2.75rem` (44px touch target on mobile). On desktop the height can reduce; use `sm:min-h-0 sm:py-2` equivalents.

## Usage
```html
<button class="ft-btn-primary">Add expense</button>
<button class="ft-btn-secondary">Cancel</button>
<button class="ft-btn-icon" aria-label="Open alerts">
  <!-- svg icon 20×20 -->
</button>
```

## Pill tabs (carousel nav)
Active: `background: rgb(59 130 246 / .2); color: #93c5fd; border: 1px solid rgb(59 130 246 / .4); border-radius: 9999px; padding: .375rem .75rem; font-size: .75rem; font-weight: 500`
Inactive: same container, `color: #94a3b8`, transparent background and border.

## Danger
`background: rgb(239 68 68 / .15); border: 1px solid rgb(239 68 68 / .35); color: #fca5a5`

## Disabled
`background: #1e293b; color: #475569; opacity: .6; cursor: not-allowed`

## Link-style button
`background: none; border: none; color: var(--ft-blue-link); font-size: .875rem; font-weight: 500` — used for "Manage budgets", "Show dismissed".
