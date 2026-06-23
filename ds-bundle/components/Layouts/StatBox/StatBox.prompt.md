# StatBox

Small data cells inside a panel. Used for cash flow summaries (income / expenses / net) and the budget spend-vs-total header.

## Single stat box
```html
<div class="ft-stat">
  <p class="ft-overline">Expected income</p>
  <p style="font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums" class="ft-income">$4,250.00</p>
  <p class="ft-dim">3-month average</p>
</div>
```

## Three-column cash flow row
```html
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
  <div class="ft-stat">
    <p class="ft-overline">Expected income</p>
    <p class="ft-income" style="font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums">$4,250.00</p>
    <p class="ft-dim">3-month average</p>
  </div>
  <div class="ft-stat">
    <p class="ft-overline">Expected expenses</p>
    <p class="ft-expense" style="font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums">$1,840.00</p>
  </div>
  <div class="ft-stat">
    <p class="ft-overline">Net cash flow</p>
    <!-- Use ft-net-pos or ft-net-neg depending on sign -->
    <p class="ft-net-pos" style="font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums">$2,410.00</p>
  </div>
</div>
```

## Amount color rules
- Income / positive net → `.ft-income` or `.ft-net-pos` (emerald-text #a7f3d0)
- Expense amounts → `.ft-expense` (blue-100 #bfdbfe)
- Negative net → `.ft-net-neg` (red-text #fecaca)
- Neutral amounts → `color: #f1f5f9` (slate-100)
