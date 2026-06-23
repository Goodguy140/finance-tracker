# Badge

## MetaChip — inline label + value pill
Compact pill that shows a label key (muted) + a value (bright). Used in transaction rows for account, category, date metadata.

```html
<span class="ft-chip">
  <span class="ft-chip-key">Account</span>
  <span class="ft-chip-val">Visa (Credit Card)</span>
</span>
```
Style: `display: inline-flex; gap: .25rem; border-radius: 9999px; border: 1px solid rgb(51 65 85 / .8); background: rgb(30 41 59 / .5); padding: .25rem .625rem; font-size: 11px`.

## AccountTypePill — colored by account type
```html
<span class="ft-pill ft-pill-chequing">Chequing</span>
<span class="ft-pill ft-pill-credit">Credit Card</span>
```
Available modifiers: `ft-pill-chequing`, `ft-pill-savings`, `ft-pill-credit`, `ft-pill-tfsa`, `ft-pill-cash`, `ft-pill-default`.

## Notification count badge
Positioned absolutely over an icon button. Used on the bell icon to show alert count.
```html
<span class="ft-badge" style="position:absolute;top:-.25rem;right:-.25rem">3</span>
```
Style: `background: var(--ft-amber); color: var(--ft-bg); border-radius: 9999px; min-width: 1rem; height: 1rem; font-size: 10px; font-weight: 700`.

## Status dot
Tiny circle prepended to a status label. Sizes: `width: .5rem; height: .5rem`.
- OK / due soon: `background: var(--ft-emerald)`
- Warning / overdue: `background: var(--ft-amber-bar)`
- Critical: `background: #f87171`
- Disabled: `background: #475569`
