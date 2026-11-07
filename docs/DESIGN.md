# Electric Editorial

Chairside's visual system combines an ink-black workspace rail, warm paper surfaces, electric citron actions and condensed display type. The large type is reserved for page introductions and metrics; tables, forms and operational details use a readable sans-serif.

## Foundations

| Token | Value | Use |
|---|---|---|
| Ink | `#171916` | Body text, structural borders, dark surfaces |
| Paper | `#f2f1e9` | Page background |
| Surface | `#fffef8` | Forms, tables and cards |
| Citron | `#dbff00` | Primary actions, active navigation, leading metric |
| Muted | `#62665e` | Secondary information on light surfaces |
| Focus | `#3357da` | Keyboard focus ring |

Citron surfaces always use dark text. Dark surfaces use light text. Success and error states retain their own colors and text labels. Primary buttons have a hard offset shadow; containers use crisp borders and restrained corners. Monospace uppercase labels add hierarchy without making long text harder to read.

`public/style.css` owns layout and component primitives. `public/brand.css` is the explicit visual-system layer, loaded afterward. The icon, browser theme and web manifest share the palette. No external font requests or runtime dependencies are introduced. Display type uses Impact with local fallbacks; exact glyph shapes can vary by OS.

## Responsive and accessibility behavior

- Desktop workspace inspected at 1440 × 1000.
- Customer booking inspected at 390 × 844; document width was 390 px, with no page overflow.
- Existing navigation breakpoints and form behavior retained.
- Visible keyboard focus, text status labels and reduced-motion preference supported.
- Decorative booking motif is hidden on small screens.
- Receipt printing removes decorative shadows.

Screenshots: `screenshots/bold-workspace.jpg` and `screenshots/bold-booking-mobile.jpg`. These use fictional demo data. This visual pass is not a full accessibility audit.
