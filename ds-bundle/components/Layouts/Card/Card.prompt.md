# Card

## Standard panel shell
The primary content container. Use for every major section (Expense Log, Budgets, Income, Recurring).
```html
<div class="ft-panel">
  <h2 class="ft-h3">Expense Log</h2>
  <!-- content -->
</div>
```
CSS: `border-radius: 1rem; border: 1px solid var(--ft-border); background: rgb(15 23 42 / .8); padding: 1rem; box-shadow: large dark drop shadow`.

## Panel with header summary row
Used for Income card: header contains title + period on the left, a large amount on the right; separated from body by a `border-bottom`.
```html
<div class="ft-panel">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid rgb(30 41 59/.8);padding-bottom:1rem;margin-bottom:1rem">
    <div>
      <h2 class="ft-h3">Income</h2>
      <p class="ft-caption">June 2026</p>
    </div>
    <p class="ft-h1 ft-income">$8,500.00</p>
  </div>
  <!-- transaction list -->
</div>
```

## Dashboard header / nav bar (glassmorphism)
Used as the sticky top header. Stands alone, not inside a `.ft-panel`.
```css
background: linear-gradient(to bottom, rgb(15 23 42 / .95), rgb(15 23 42 / .8));
border-bottom: 1px solid rgb(30 41 59 / .9);
backdrop-filter: blur(8px);
box-shadow: 0 10px 15px -3px rgb(0 0 0 / .3);
```
On desktop: `border-radius: 1rem; border: 1px solid rgb(30 41 59 / .9)`.

## Inner stat card
Used inside panels for dense data cells. Lighter bg, smaller padding.
```html
<div class="ft-stat">
  <p class="ft-overline">Expected income</p>
  <p class="ft-income" style="font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums">$4,250.00</p>
</div>
```
CSS: `border-radius: .75rem; border: 1px solid var(--ft-border); background: rgb(2 6 23 / .5); padding: .625rem`.
