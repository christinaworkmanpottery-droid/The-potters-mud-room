# Quantum Leap — approved visual implementation contract

Approved: October 12, 2026. Founder signed off on **Porcelain After Dark — Refined** visuals; production release is separately gated.

## Palette
- Midnight navy `#0C263C`, deep slate `#193B53`, mineral blue `#2F729C`
- Porcelain `#F7FAFC`, mist `#E8F0F5`, charcoal `#203344`, celadon `#A5D3CE`
- Status colors used only for meaningful states. Avoid rainbow navigation.

## Information architecture
- Home: What are you working on? / Talk to Clayton / Manual entry / Use a photo / Continue where you left off / Your studio
- Pieces, Firings, Glazes & Clay, Raw Materials, Studio Notes, Studio Search, remaining existing features in More
- Persistent compact navigation with prominent Clayton entry point
- Preserve existing data and all production feature access

## Home photo mode (member preference)
`studio` = licensed studio imagery on category cards; `mine` = member pottery photo on eligible cards with fallback; `minimal` = slate cards with no decorative photography. Actual piece thumbnails remain visible in record lists regardless of home preference. Settings changes reversible and persistent.

## Accessibility
Respect reduced motion, minimum 44px touch targets, semantic labels, contrast, keyboard/focus support. Clayton animations represent actual listening/thinking/speaking state; never fake recording. Keep a typed fallback.

## Build gates
Work on isolated design branch/staging. Use real scoped APIs for Pieces and Raw Materials. No sample records or fake inventory in production. No changes to current production, native app identity or TestFlight until explicit acceptance.
