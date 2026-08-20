# CRM Pro brand guidelines

Version 1.0 · August 2026

CRM Pro is a focused revenue workspace for teams that need customer context and
next actions in one place. The product voice is calm, direct, and operational.
The product tagline is **Revenue in motion.**

## Logo system

The logo is a connected pathway: four points joined by an upward route and
finished with an open arrow. It represents movement from relationship to
opportunity to revenue.

The code-native logo is available through the `BrandLogo` component:

```jsx
<BrandLogo variant="lockup" size="md" />
<BrandLogo variant="mark" size="sm" showWordmark={false} />
<BrandLogo variant="lockup" inverse />
<BrandLogo variant="lockup" monochrome />
```

Supported presentation variants are:

- **Full lockup:** mark, CRM Pro wordmark, and tagline. Use in the expanded
  desktop sidebar, product surfaces, and customer-facing collateral.
- **Collapsed/sidebar mark:** mark only. Use when the desktop navigation is
  collapsed or horizontal space is constrained.
- **Mobile mark:** mark only at a touch-friendly size. Keep the active product
  navigation visible alongside it.
- **Monochrome:** one current-color mark for black-and-white documents,
  print, and contexts where color reproduction is uncertain.
- **Inverse:** light wordmark and mint accent for the deep navy sidebar,
  overlays, and dark branded headers.

Keep clear space around the mark equal to the radius of its outer node. Do not
rotate, stretch, recolor individual pathway segments, add effects, or place the
logo on a busy image. The product name is written as **CRM Pro** with a space
and title case.

## Color palette

| Token | Hex | Use |
| --- | --- | --- |
| Deep navy | `#0B1F33` | Sidebar, dark brand surfaces, primary ink |
| Navy strong | `#071521` | Hover and high-contrast navy surfaces |
| Accessible teal | `#0F766E` | Primary actions, links, chart emphasis |
| Teal dark | `#0B5F59` | Primary hover states |
| Mint | `#5EEAD4` | Active indicators, pathway highlight, accents |
| Mint strong | `#2DD4BF` | Data accents and gradient endpoints |
| Page background | `#F4F8FB` | Application canvas |
| Surface | `#FFFFFF` | Cards, forms, modals, document bodies |
| Border | `#D9E5EC` | Dividers and control boundaries |
| Text | `#0F2438` | Main content and headings |
| Muted text | `#627D98` | Supporting copy and metadata |

Use teal or navy for interactive controls; do not use mint as small body text
or as the only status signal. Preserve semantic colors for success, warning,
danger, pipeline stages, and financial states. Every status must include text,
an icon, or another non-color cue.

The primary teal is intended for white text and white surfaces. Check contrast
when introducing a new combination, especially for small text and disabled
controls. Focus indicators use a visible mint/teal ring and must not be removed.

## Typography and hierarchy

CRM Pro uses Plus Jakarta Sans. Keep the existing font stack and use weight and
spacing to create hierarchy:

- Page title: bold or extra-bold, compact tracking, high-contrast navy text.
- Section title: bold, clear sentence case.
- Body copy: regular, comfortable line height, `#0F2438` or muted text.
- Labels and overlines: semibold, uppercase only for short navigational or
  status labels, with generous letter spacing.
- Numbers and financial totals: bold with enough surrounding space to scan.

Avoid all-caps paragraphs, excessive gradients, and more than three competing
text sizes in a single card.

## Interface conventions

### Buttons

Primary actions use the shared `crm-btn crm-btn-primary` treatment: teal-to-
navy emphasis, white text, rounded corners, a clear hover state, and a visible
focus ring. Use one primary action per card or modal. Secondary actions are
white, bordered, and visually quieter. Destructive actions retain the semantic
danger palette and require a confirmation step where data can be lost.

Buttons must expose a useful label, remain usable while loading, and keep a
minimum touch target of approximately 44 by 44 CSS pixels. Never leave a user
without feedback after a click: show a loading state for network work and an
inline or toast error when it fails.

### Cards and forms

Cards use a white surface, a light blue-gray border, modest shadow, and a
consistent large radius. Use spacing to group related controls instead of
stacking borders. Form labels remain visible, required fields are explicit,
and validation messages appear next to the relevant field. Preserve entered
values after recoverable request errors.

### Navigation

The desktop sidebar is deep navy. The current route has a translucent mint
surface, a mint leading indicator, and white text. The collapsed sidebar keeps
the mark and tooltips/accessible labels. On mobile, the bottom navigation keeps
the most-used destinations visible and reserves space for safe-area insets.

Do not hide navigation, dialogs, or primary actions behind fixed elements at
390px or 414px widths. Overlays must remain scrollable and dismissible.

### Data and status

Use teal/navy for brand emphasis and reserve semantic colors for meaning:
green for successful/paid/won states, amber for attention or pending work, red
for errors or overdue items, and blue for informational states. Charts should
use the brand palette for primary series and readable legends for every series.

## PDFs and email

Quotes and invoices use the workspace financial settings as the canonical legal
identity: legal name, address, contact details, tax details, and payment terms
come from workspace configuration. If a product label is needed and no legal
name is available, use **CRM Pro** rather than a fabricated company name.

PDF headers use deep navy/teal accents, white document surfaces, and readable
black/navy body text. Keep totals and payment instructions prominent. Avoid
placeholder addresses, invented legal entities, and low-contrast decorative
text.

CRM Pro email HTML uses a restrained navy header, mint accent, white content
surface, and a plain-text-compatible body. Sender identity, delivery provider,
reply behavior, and workspace legal details remain configuration concerns; the
brand layer changes presentation only. Email content must remain readable when
styles are stripped.

## Responsive and accessibility guidance

Design and verify at approximately 390px, 414px, 1280px, and 1440px widths.
At narrow widths:

- Keep primary actions visible without horizontal scrolling.
- Let tables become cards or scroll intentionally rather than clipping columns.
- Keep modals within the viewport with internal scrolling.
- Preserve readable line lengths and do not overlap fixed bottom navigation.
- Keep touch targets at least 44px and maintain visible focus states.

Use semantic headings, labels, button names, `aria-current` for navigation, and
meaningful empty/loading/error states. Respect reduced-motion preferences. The
Clerk development-mode warning is an environment notice and is not part of the
CRM Pro visual identity.

## Implementation reference

Shared brand constants live in `brand.js`. Global tokens and compatibility
styles live in `src/index.css`. The reusable SVG logo lives in
`src/components/brand/BrandLogo.jsx`. Customer-facing document and email
renderers should import the same constants rather than defining a second color
or product-name system.
