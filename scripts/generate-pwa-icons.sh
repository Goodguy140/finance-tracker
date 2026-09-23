#!/usr/bin/env bash
# Renders the PNG icons the PWA needs from the same glyph as src/app/icon.svg.
#
# SVG alone is not enough: iOS ignores an SVG apple-touch-icon (it falls back to a page
# screenshot), and Android's install flow wants 192/512 PNGs plus a maskable variant.
# The outputs are committed; rerun this after changing the glyph. Needs rsvg-convert.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/public/icons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

# The glyph from src/app/icon.svg, on a 32x32 grid.
glyph='
  <path d="M7 24V18M12 24V14M17 24V10M22 24V16" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M6 24h20" stroke="#334155" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M20 9.5 22.5 12 20 14.5M22.5 12h-6" stroke="#3b82f6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>'

# "any" purpose: rounded tile, shown as-is by Android and desktop Chrome.
cat >"$tmp/any.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#0f172a"/>$glyph
</svg>
SVG

# Full-bleed square: iOS applies its own corner mask, and transparent corners render black.
cat >"$tmp/square.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#0f172a"/>$glyph
</svg>
SVG

# Maskable: full bleed, glyph shrunk into the central safe zone (a circle of 80% diameter),
# since launchers may crop to a circle, squircle or teardrop.
cat >"$tmp/maskable.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#0f172a"/>
  <g transform="translate(16 16.5) scale(0.72) translate(-16 -16.5)">$glyph
  </g>
</svg>
SVG

rsvg-convert -w 192 -h 192 "$tmp/any.svg" -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 "$tmp/any.svg" -o "$out/icon-512.png"
rsvg-convert -w 512 -h 512 "$tmp/maskable.svg" -o "$out/maskable-512.png"
rsvg-convert -w 180 -h 180 "$tmp/square.svg" -o "$root/src/app/apple-icon.png"

echo "Wrote $out/{icon-192,icon-512,maskable-512}.png and src/app/apple-icon.png"
