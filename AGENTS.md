````markdown
# BetterZalo — Agent Guidelines

## Project Overview

BetterZalo is a **PC-only modding framework for Zalo**.

- Target: Zalo PC/Desktop only
- Language: Vanilla JavaScript (ES6+)
- Styling: Native CSS and Zalo CSS custom properties
- Avoid external runtime dependencies unless explicitly requested.
- Modify existing code instead of rebuilding the project from scratch.
- Preserve native Zalo functionality and UI behavior unless a task explicitly requires changing it.

---

## Platform Scope

BetterZalo currently targets **Zalo PC/Desktop**.

Do not assume support for:

- Zalo Web
- Zalo mobile applications
- Android
- iOS
- Linux-native Zalo

The core framework may use platform-independent JavaScript/CSS, but compatibility should not be advertised unless the corresponding Zalo environment has been verified.

---

## Confirmed Zalo Settings DOM

These selectors and structures have been confirmed through inspection.

### Settings Sidebar

```css
div.setting-menu
````

Native sidebar items can be reused as templates.

When creating BetterZalo sidebar entries, prefer cloning an existing native item:

```js
nativeItem.cloneNode(true)
```

Preserve the native structure and classes whenever possible.

Relevant native classes include:

```css
.setting-menu__item
.setting-menu__wrapper-content
.setting-menu__icon
.setting-menu__name
```

Native icons use Zalo's existing icon/font system.

Do not replace native icons with:

* emoji
* arbitrary Unicode symbols
* external icon libraries
* unnecessary SVG systems

unless explicitly requested.

---

### Main Settings Container

The confirmed main Settings content container is:

```css
#setting-right
```

It also uses:

```css
.setting--content-right
```

Prefer:

```js
document.querySelector("#setting-right")
```

over less-specific selectors.

The native Settings navigation exists inside this container:

```css
.stack-navigation
```

Do not permanently destroy or replace the native Settings navigation.

When BetterZalo displays its own page, temporarily hide or replace the visible native content as necessary, while preserving the original DOM and restoring it when the user returns to native Settings.

---

## BetterZalo Settings Navigation

BetterZalo currently uses three independent Settings sidebar entries:

1. BetterZalo
2. Plugins
3. Themes Library

These are **separate sidebar entries**, not tabs inside a single BetterZalo page.

Each entry displays its own page inside:

```css
#setting-right
```

### BetterZalo

The BetterZalo page may contain framework-level settings and information.

The current implementation should only contain functionality explicitly requested by the task.

### Plugins

The Plugins page is currently a UI foundation.

Do not implement plugin loading, installation, execution, configuration, or lifecycle behavior unless explicitly requested.

### Themes Library

The Themes Library is currently a UI foundation.

Do not implement theme loading, installation, switching, CSS injection, previews, or persistence unless explicitly requested.

---

## Native Zalo UI Styling

BetterZalo Settings should visually integrate with Zalo's existing Settings interface.

Prefer native Zalo classes and CSS custom properties instead of recreating the styling system.

Useful native classes include:

```css
.setting-section
.setting-section-label
.setting-section-content
.setting-section-content__item
.z-toggle
```

### Typography

Native Settings options use approximately:

```css
font-size: 0.875rem;
font-weight: 400;
line-height: 1.5;
```

Prefer Zalo's existing typography variable when available:

```css
var(--f14)
```

Do not arbitrarily change native typography, spacing, or geometry.

---

## Native CSS Variables

Zalo exposes semantic CSS custom properties through its main application containers.

Prefer semantic variables such as:

```css
var(--surface-background)
var(--surface-background-subtle)
var(--surface-alt)
var(--layer-background)
var(--layer-background-hover)
var(--layer-background-selected)
var(--text-primary)
var(--text-secondary)
var(--icon-primary)
var(--icon-secondary)
```

Do not hardcode colors when an appropriate native variable already exists.

If a native variable does not exist for a required visual state, use the smallest possible custom rule and keep it scoped to BetterZalo.

Do not assume a variable belongs specifically to BetterZalo simply because it is accessible from BetterZalo's DOM. Many of these variables originate from Zalo's main/root container and cascade into the Settings UI.

---

## Sidebar Geometry

BetterZalo sidebar entries must not cause existing Zalo Settings items to move.

When adding or modifying sidebar entries:

* Preserve native item height.
* Preserve native margins.
* Preserve native padding.
* Preserve native line-height.
* Preserve native icon alignment.
* Do not add wrappers that alter layout.
* Do not change the height of the sidebar.
* Do not change the positioning model of native sidebar items.

Native selected-state behavior should remain intact.

Do not replace the native selected background with a custom approximation unless explicitly requested.

---

## Plugin Architecture

All plugins use the existing:

```js
window.BetterZalo.registerPlugin(config)
```

architecture.

Supported lifecycle hooks:

```js
onEnable()
onDisable()
onOptionsChange(newOptions)
```

Optional plugin fields: `requiresRestart` (enable/option changes are staged and
applied on restart instead of live) and `optionsSchema` (array of
`{ key, label, description }` rendered generically by the Plugins settings UI).

Plugins live in `src/plugins/<plugin-id>/`, one folder per plugin. The Plugins
page renders one card per registered plugin (name, description, enable toggle,
gear button opening a modal over a dark backdrop). `BetterZalo.restart()`
(`location.reload()`) applies staged `requiresRestart` changes; the Plugins
page shows a single restart banner while any are pending. Toggles reuse Zalo's
native `.z-toggle` + `fa-toggle-*` mechanism; gear/close use native `fa` glyphs.

Configuration persistence uses:

```text
better_zalo_config
```

in `localStorage`.

Do not create a second plugin architecture.

Do not introduce a separate plugin manager API unless explicitly requested.

Plugin functionality should only be implemented when the task explicitly asks for it.

---

## Current vs Planned Functionality

Do not implement planned functionality simply because it is mentioned in documentation.

Potential future functionality includes:

* Plugin installation/loading
* Plugin enable/disable controls
* Plugin options
* Theme installation
* Theme switching
* Custom CSS
* QuickCSS
* Relaunch controls
* Open Folder controls
* Telemetry/Tracking controls
* Configuration import/export/reset

These are **not automatically part of the current implementation**.

Only implement them when explicitly requested.

---

## Code Modification Rules

### Edit Existing Code

When modifying the project:

1. Inspect the existing implementation.
2. Reuse the existing architecture.
3. Make the smallest focused change that satisfies the task.
4. Preserve existing functionality.
5. Do not rebuild working systems from scratch.
6. Do not silently replace confirmed selectors, APIs, or architecture.

If the existing implementation conflicts with a confirmed project fact, inspect the code and resolve the conflict deliberately.

---

## DOM Reverse Engineering

Zalo's internal DOM may change between versions.

When working with reverse-engineered UI:

* Prefer confirmed selectors.
* Reuse native elements/classes when possible.
* Avoid brittle positional selectors when a stable selector exists.
* Do not assume an element's purpose from its appearance alone.
* Verify the actual DOM structure before implementing complicated patches.
* Keep concise comments explaining important reverse-engineered hooks.

For example:

```js
// Zalo's native Settings content container.
const settingRight = document.querySelector("#setting-right");
```

---

## Runtime Safety

BetterZalo must avoid breaking native Zalo functionality.

Prefer:

* scoped DOM changes
* event listeners with cleanup
* idempotent initialization
* existing application APIs when available
* minimal monkey patches
* defensive null checks

Avoid:

* unnecessary global overrides
* destructive DOM replacement
* permanent removal of native Settings elements
* repeated event-listener registration
* uncontrolled MutationObservers
* broad CSS selectors that affect unrelated Zalo UI

---

## Initialization

Framework initialization should be safe to run more than once.

Avoid creating duplicate:

* sidebar entries
* Settings pages
* event listeners
* styles
* plugin registrations
* observers

Use a clear initialization guard when necessary.

---

## CSS Rules

BetterZalo CSS should be scoped to BetterZalo-owned elements whenever possible.

Avoid selectors that unintentionally modify the entire Zalo application.

Prefer:

```css
.betterzalo-...
```

or another clearly scoped BetterZalo namespace for custom elements.

Reuse Zalo's native classes when intentionally matching native UI.

Do not duplicate large portions of Zalo's stylesheet.

---

## External Dependencies

Do not introduce external runtime dependencies unless explicitly requested.

Prefer native browser APIs and the existing BetterZalo architecture.

Do not add a framework such as React, Vue, Svelte, or another UI library merely to implement a Settings UI feature.

---

## Project-Fact Consistency

The following are authoritative project facts:

* BetterZalo is PC-only.
* BetterZalo uses Vanilla JavaScript ES6+.
* The confirmed Settings sidebar is `div.setting-menu`.
* The confirmed main Settings container is `#setting-right`.
* Native Settings navigation uses `.stack-navigation`.
* BetterZalo has three independent Settings entries:

  * BetterZalo
  * Plugins
  * Themes Library
* Plugins use `window.BetterZalo.registerPlugin(config)`.
* Plugin persistence uses `better_zalo_config`.
* Native Zalo Settings styling should be reused whenever possible.

Do not silently replace these facts with guesses or older documentation.

If new inspection proves that a project fact has changed, update the documentation deliberately.

---

## Scope Control

Do not add unrelated improvements while completing a task.

If the task asks for:

* a UI change → do not redesign unrelated UI
* a plugin → do not rewrite the plugin architecture
* a CSS change → do not rewrite the entire stylesheet
* a DOM fix → do not refactor unrelated JavaScript
* a Settings page → do not implement future functionality

Keep changes focused and reviewable.

---

## Comments

Use concise comments for:

* reverse-engineered Zalo DOM behavior
* fragile selectors
* runtime hooks
* monkey patches
* compatibility workarounds

Avoid comments that merely restate obvious code.

---

## Maintenance

Update this file when a project-wide fact changes, such as:

* architecture
* supported platforms
* confirmed Zalo DOM selectors
* plugin API
* styling conventions
* build/runtime conventions
* development workflow

Do not add temporary task-specific instructions to this file.

Keep `AGENTS.md` concise enough that coding agents can reliably follow it.