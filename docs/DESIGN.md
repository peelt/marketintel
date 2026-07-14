# Investorlogical — Design & Brand

Investorlogical is a member of MXMG's **"-logical" family** (Sealogical,
Properlogical, …) and uses the shared **Manifesto-White CLI** design
language. The authoritative family spec is the Properlogical Design
Specification (supplied by Peel, 14 Jul 2026); this file records how it
applies here. **Do not drift the family constants** — differences between
sibling sites come only from the brand variables below.

## Family constants (identical across every brand)

- White canvas; navy `#034566` primary text; `#f9fafb` alternating section
  tint; `#e5e7eb` borders; `#6b7280` body grey.
- **Orange `#F6881C`** is the single action colour: hover states, `[*]`
  markers, blinking cursor. Never a large fill; never a second action colour.
- **Ubuntu** (sans, prose) + **Ubuntu Mono** (anything "machine": CLI lines,
  labels, buttons, tags). Never body copy in mono.
- The `.card-cli` / `.btn-cli` / `.tag-cli` / `.divider-cli` /
  `.cli-title-bar` / `.input-cli` / `.label-cli` component set — implemented
  verbatim in `app/globals.css`.
- CLI motifs: `~ command… [OK]` eyebrows (`CliTyping` animates them),
  orange `[*]` list markers, blinking cursor, traffic-light dots,
  `guest@investorlogical:~` prompt.
- Layout: `max-w-7xl` containers, alternating white/`#f9fafb` sections,
  self-framing navy line-art illustrations.
- Tone: calm, factual, no hype; CLI captions lowercase and terse; sentence
  case headings; never brand deterministic logic as "AI".
- Success ✓ `#22a87b`; alert red/green `#EE1D23` / `#8DC73F` (small glyphs
  only — e.g. the price-change figure on charts, whose line stays navy).

## Brand variables (Investorlogical's own)

| Variable | Value |
|---|---|
| Wordmark | Official logo asset (`public/brand/investorlogical-logo*.{svg,png}`): gradient logomark + `investor` cyan `#00B5E2` · `logical` deep navy `#08325a`. Rendered by `Wordmark` in `components/cli.tsx` — sized by height, `w-auto`, never squashed. |
| Secondary accent | **Cyan `#00B5E2`** (`--brand-accent` in `globals.css`) — taken from the official logo (supersedes the interim indigo pick). Card hovers, pills, focus rings, button borders. |
| Icon / favicon | `public/brand/investorlogical-icon*.{svg,png}` — navy `#034566` rounded square, white trend-tick mark. Wired as `app/icon.png` + `app/apple-icon.png` (Next convention). |
| Module accents | One hue per agent pole — `MODULE_COLORS` in `components/cli.tsx`: reaction `#E2282C`, dividend `#6DCA9B`, ipo `#69C6F6`, metals `#E7D149`, geopolitical `#B161CF`, energy `#2D5AC7`. Top-stripes/hover borders/glyphs only, never fills. |
| Domain vocabulary | securities · frameworks · reports · evidence · verdicts · coverage |

## Where things live

- Brand assets (logo, icon, favicon sources): `public/brand/`
- Tokens + full family component CSS: `app/globals.css`
- Fonts (next/font Ubuntu + Ubuntu Mono): `app/layout.tsx`
- Wordmark, header, title bar, `[*]`, module colours: `components/cli.tsx`
- Animated eyebrow: `components/cli-typing.tsx`

## Do / Don't (short form)

**Do** keep white/navy/orange untouched; use mono for machine text; let
indigo be the only thing that says "Investorlogical"; state features
plainly.

**Don't** introduce a second action colour; use orange as a fill; set prose
in mono; add dark mode (white canvas is a family constant); drift component
CSS from the family spec.
