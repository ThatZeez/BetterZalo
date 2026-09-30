# BetterZalo - Agent Guidelines & Project Context

## Project Overview
BetterZalo is a modular, persistent modding framework for Zalo PC and Zalo Web. It injects custom UI options, manages user plugins, and allows custom CSS themes without breaking native features.

## Technical Requirements
- **Language**: Vanilla JavaScript (ES6+), CSS-in-JS / native CSS variables.
- **No External Libraries**: All plugins and core framework scripts must be self-contained IIFEs without external runtime dependencies.
- **Theme Support**: Never hardcode colors. Always adapt dynamically using Zalo's native CSS custom properties (e.g., `var(--main-background)`, `var(--text-primary)`, `var(--border-color)`).

## Key DOM Selectors & Injection Points
- Sidebar Target: `div.setting-menu` (Clone items using `.cloneNode(true)`)
- Panel Content Area: `#setting-right` (hide native `.stack-navigation` without destroying it; restore on native select)
- BetterZalo Tab IDs: `#better-zalo-tab` (BetterZalo), `#better-zalo-plugins-tab` (Plugins), `#better-zalo-themes-tab` (Themes Library)
- Sidebar labels use native type token `var(--f14, 0.875rem)` (exactly 14px, weight 400, line-height 1.5)
- Selected sidebar item reuses the native selected class when detected; fallback geometry: 40px height, `4px 8px` margin, `0 8px` padding, 6px radius, `var(--layer-background-selected)` (no overlay, no custom blue)

## Plugin Manager Architecture
- All plugins register through `window.BetterZalo.registerPlugin(config)`
- Persistence is handled via `localStorage` under the key `better_zalo_config`
- Each plugin module must export lifecycle hooks: `onEnable()`, `onDisable()`, and `onOptionsChange(newOptions)`

## Code Output Rules
- Write clean, production-ready, modular JavaScript.
- Include concise line comments for reverse-engineered DOM hooks or monkey-patched runtime APIs.

## Maintenance
- Update this file in the same session whenever tooling, structure, or conventions change.
