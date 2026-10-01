/* BetterZalo Core Framework - vanilla ES6+ IIFE, zero dependencies. */

(() => {
  'use strict';

  const TAG = '[BetterZalo]';
  const VERSION = '0.1.0';
  const CONFIG_KEY = 'better_zalo_config';
  const STYLE_ID = 'betterzalo-styles';
  const CUSTOM_CSS_ID = 'betterzalo-custom-css';
  const SECTION_ID = 'better-zalo-section'; // sidebar section wrapper

  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  /* ---------- persistent store (localStorage namespaced) ---------- */

  const memFallback = { data: null };

  function defaultStore() {
    return {
      plugins: {}, // id -> { enabled, options }
      settings: { telemetry: true, customCSS: '', cssEnabled: false },
    };
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return defaultStore();
      const parsed = JSON.parse(raw);
      const base = defaultStore();
      return {
        plugins: { ...(parsed.plugins || {}) },
        settings: { ...base.settings, ...(parsed.settings || {}) },
      };
    } catch (e) {
      err('storage read failed, using defaults:', e);
      return memFallback.data || defaultStore();
    }
  }

  function writeStore(data) {
    memFallback.data = data;
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(data));
    } catch (e) {
      err('storage write failed:', e);
    }
  }

  const storage = {
    load: () => readStore(),
    save: (data) => writeStore(data),
    get: (key, fallback) => {
      const s = readStore();
      return s[key] !== undefined ? s[key] : fallback;
    },
    set: (key, value) => {
      const s = readStore();
      s[key] = value;
      writeStore(s);
    },
    export: () => JSON.stringify(readStore(), null, 2),
    import: (json) => {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || typeof data !== 'object') throw new Error('Invalid config');
      writeStore({ ...defaultStore(), ...data });
    },
    reset: () => {
      try { localStorage.removeItem(CONFIG_KEY); } catch (_) { /* noop */ }
      memFallback.data = defaultStore();
    },
  };

  /* ---------- plugin registry with error boundaries ---------- */

  const registry = new Map(); // id -> record
  const getStore = () => readStore();
  const putStore = (s) => writeStore(s);

  // One faulty plugin must never crash core or Zalo.
  function safeInvoke(id, fnName, ...args) {
    const rec = registry.get(id);
    if (!rec) return undefined;
    const fn = rec[fnName];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(rec, args);
    } catch (e) {
      err(`plugin "${id}" ${fnName} threw:`, e);
      return undefined;
    }
  }

  function persistPluginState(rec) {
    const s = getStore();
    s.plugins[rec.id] = { enabled: !!rec.enabled, options: { ...(rec.options || {}) } };
    putStore(s);
  }

  function registerPlugin(pluginObj) {
    if (!pluginObj || typeof pluginObj !== 'object') {
      err('registerPlugin: expected a plugin object');
      return false;
    }
    const { id, name, version, description, author } = pluginObj;
    if (typeof id !== 'string' || !id.trim()) {
      err('registerPlugin: "id" must be a non-empty string');
      return false;
    }
    if (typeof name !== 'string' || !name.trim()) {
      err(`registerPlugin("${id}"): "name" must be a non-empty string`);
      return false;
    }
    // Lifecycle hooks: onEnable/onDisable required, onOptionsChange optional (noop default).
    for (const hook of ['onEnable', 'onDisable']) {
      if (typeof pluginObj[hook] !== 'function') {
        err(`registerPlugin("${id}"): "${hook}" must be a function`);
        return false;
      }
    }
    if (pluginObj.onOptionsChange !== undefined && typeof pluginObj.onOptionsChange !== 'function') {
      err(`registerPlugin("${id}"): "onOptionsChange" must be a function`);
      return false;
    }
    if (registry.has(id)) {
      warn(`registerPlugin: "${id}" already registered, skipping`);
      return false;
    }
    const saved = getStore().plugins[id] || {};
    const rec = {
      id,
      name,
      version: typeof version === 'string' ? version : '0.0.0',
      description: typeof description === 'string' ? description : '',
      author: typeof author === 'string' ? author : '',
      onEnable: pluginObj.onEnable,
      onDisable: pluginObj.onDisable,
      onOptionsChange: pluginObj.onOptionsChange || (() => {}),
      defaultOptions: { ...(pluginObj.defaultOptions || {}) },
      options: { ...(pluginObj.defaultOptions || {}), ...(saved.options || {}) },
      enabled: saved.enabled !== undefined ? !!saved.enabled : !!pluginObj.enabled,
    };
    registry.set(id, rec);
    persistPluginState(rec);
    log(`registered plugin "${id}" v${rec.version}`);
    if (rec.enabled) {
      safeInvoke(id, 'onEnable', { ...rec.options });
      log(`auto-enabled "${id}" from saved config`);
    }
    return true;
  }

  function unregisterPlugin(id) {
    const rec = registry.get(id);
    if (!rec) {
      warn(`unregisterPlugin: unknown id "${id}"`);
      return false;
    }
    if (rec.enabled) safeInvoke(id, 'onDisable');
    registry.delete(id);
    const s = getStore();
    delete s.plugins[id];
    putStore(s);
    log(`unregistered plugin "${id}"`);
    return true;
  }

  function getPlugin(id) {
    return registry.get(id) || null;
  }

  function setEnabled(id, enabled) {
    const rec = registry.get(id);
    if (!rec) return false;
    const next = !!enabled;
    if (rec.enabled === next) return true;
    rec.enabled = next;
    if (next) safeInvoke(id, 'onEnable', { ...rec.options });
    else safeInvoke(id, 'onDisable');
    persistPluginState(rec);
    log(`plugin "${id}" ${next ? 'enabled' : 'disabled'}`);
    return true;
  }

  function setPluginOptions(id, nextOptions) {
    const rec = registry.get(id);
    if (!rec) return false;
    rec.options = { ...(nextOptions || {}) };
    persistPluginState(rec);
    safeInvoke(id, 'onOptionsChange', { ...rec.options });
    return true;
  }

  /* ---------- theme-adaptive styles (Zalo vars, system-color fallback) ---------- */

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // Reverse-engineered: Zalo theme tokens live on themed containers, not :root,
    // so every token chains a real token -> AGENTS.md example -> system color.
    // Verified live: --layer-background, --text-primary, --border exist; --main-background / --border-color do not.
    // Native sidebar type token: --f14 (0.875rem / 14px).
    style.textContent = `
    .bz-section-header {
      padding: 12px 16px 4px; font-size: 12px; font-weight: 600;
      letter-spacing: .04em;
      /* Header keeps its literal capitalization ("BetterZalo Settings"); no case override. */
      color: var(--text-secondary, var(--text-primary, GrayText));
      user-select: none;
    }
    .bz-nav-item {
      /* Confirmed native item geometry, applied identically in both states
         so selecting never moves siblings. The clone carries native classes,
         but the template picker can return a wrapper-level node missing the
         item box; this guarantees the 40px inset highlight box regardless. */
      box-sizing: border-box !important;
      height: 40px !important;
      margin: 4px 8px !important;
      padding: 0 8px !important;
      border-radius: 6px !important;
    }
    /* Hover (paint-only, CSS :hover, no JS handlers). Reverse-engineered:
       Zalo toggles the "dark" class on <body> per theme (verified live:
       removing/adding it flips --layer-background-hover between #f1f2f4 and
       white 5%). #2d3136 is the solid equivalent of the native dark hover
       (white 5% over #22262b sidebar), #f1f2f4 the native light hover. */
    .bz-nav-item:hover {
      background-color: #f1f2f4;
    }
    body.dark .bz-nav-item:hover,
    html.dark .bz-nav-item:hover {
      background-color: #2d3136;
    }
    .bz-item-active,
    .bz-item-active:hover {
      /* Paint-only selected state: background on the existing item itself.
         Geometry lives on .bz-nav-item above (same both states). Never put
         height, margin, padding, line-height, or positioning here.
         !important keeps the selected background winning over :hover. */
      background-color: var(--layer-background-selected, var(--background-activeness, Highlight)) !important;
    }
    .bz-nav-label {
      font-size: var(--f14, 0.875rem) !important;
      font-weight: 400 !important;
      line-height: 1.5 !important;
    }
    .bz-page {
      box-sizing: border-box; height: 100%; overflow-y: auto; padding: 20px 24px 32px;
      background: var(--layer-background, var(--main-background, Canvas));
      color: var(--text-primary, CanvasText);
      font: inherit;
    }
    .bz-page .setting-section { margin-bottom: 20px; }
    `;
    document.head.appendChild(style);
  }

  function applyCustomCSS() {
    const { customCSS, cssEnabled } = getStore().settings;
    let tag = document.getElementById(CUSTOM_CSS_ID);
    if (!cssEnabled || !customCSS) {
      if (tag) tag.remove();
      return;
    }
    if (!tag) {
      tag = document.createElement('style');
      tag.id = CUSTOM_CSS_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = customCSS;
  }

  /* ---------- sidebar navigation: three independent entries ---------- */

  const NAV_ITEMS = [
    // icon: native Zalo glyph name reused 1:1 from the matching settings entry.
    // Reverse-engineered from Zalo's shipped renderer (compact-app-pc bundle):
    // item = .setting-menu__item > .setting-menu__wrapper-content >
    //        Icon[className="<name> setting-menu__icon"] + p.setting-menu__name.
    // Settings list pairs title->icon: STR_GENERAL->Setting_24_Line,
    // STR_UTILITIES->Utility_24_Line, STR_SETTINGS_THEME (Giao diện)->Theme_24_Line.
    { key: 'betterzalo', id: 'better-zalo-tab', label: 'BetterZalo', icon: 'Setting_24_Line' },
    { key: 'plugins', id: 'better-zalo-plugins-tab', label: 'Plugins', icon: 'Utility_24_Line' },
    { key: 'themes', id: 'better-zalo-themes-tab', label: 'Themes Library', icon: 'Theme_24_Line' },
  ];

  let currentView = 'betterzalo';
  let observer = null;
  let nativeActiveClass = ''; // real native selected class, when determinable

  // Reverse-engineered hooks: the settings modal mounts lazily, so
  // div.setting-menu and #setting-right only exist while settings are open.
  function findSettingMenu() {
    return document.querySelector('div.setting-menu');
  }
  function findSettingsContent() {
    // Confirmed main settings content container.
    return document.querySelector('#setting-right');
  }
  function findNativeNav(root) {
    return root.querySelector('.stack-navigation');
  }

  function pickTemplateItem(menu) {
    // A real native item carries the full structure:
    // .setting-menu__wrapper-content > i.fa.*.setting-menu__icon + p.setting-menu__name.
    // Never clone our own section or the header (neither has the icon node).
    const natives = [...menu.querySelectorAll('.setting-menu__item')]
      .filter((n) => !n.closest('#' + SECTION_ID));
    return (
      natives[0] ||
      menu.querySelector('[role="menuitem"], [role="tab"], li, div > div') ||
      menu.firstElementChild
    );
  }

  function clearBzActive(menu) {
    menu.querySelectorAll('.bz-item-active').forEach((el) => {
      el.classList.remove('bz-item-active');
      if (nativeActiveClass) el.classList.remove(nativeActiveClass);
      el.removeAttribute('aria-selected');
    });
  }

  function clearActiveStates(menu) {
    clearBzActive(menu);
    // Best-effort: drop native active classes so only BetterZalo looks selected.
    menu.querySelectorAll('[class*="active"], [class*="selected"], [aria-selected="true"]').forEach((el) => {
      el.classList.remove('active', 'selected');
      el.removeAttribute('aria-selected');
    });
  }

  // Prefer the actual native selected mechanism over recreated styling:
  // Zalo's own stylesheet uses `.setting-menu__item.selected` for it, so the
  // marker is almost always the `selected` class; still detected, not assumed.
  function detectNativeActiveClass(menu, template) {
    const base = new Set(template ? [...template.classList] : []);
    const flagged = menu.querySelector('[aria-selected="true"]');
    const candidates = flagged
      ? [flagged]
      : [...menu.querySelectorAll('[class*="active"], [class*="selected"]')];
    for (const cand of candidates) {
      if (cand.closest('#' + SECTION_ID)) continue; // ignore our own items
      for (const c of [...cand.classList]) {
        // Exact state markers first (template itself may be the selected item,
        // in which case the base-class diff below would find nothing).
        if (/^(selected|active)$/i.test(c)) {
          nativeActiveClass = c;
          log('reusing native selected class:', c);
          return;
        }
      }
      for (const c of [...cand.classList]) {
        if (!base.has(c) && /active|selected/i.test(c)) {
          nativeActiveClass = c;
          log('reusing native selected class:', c);
          return;
        }
      }
    }
  }

  // Native icon mechanism, verified in Zalo's shipped stylesheet
  // (default-login-startup + compact-app-pc bundles):
  //   <i class="fa fa-<Name> setting-menu__icon">
  //   .fa{...font:... zalo-font}            -> icon font (FontAwesome-style)
  //   .fa-<Name>:after{content:"..."}        -> the glyph itself
  //   .setting-menu__icon{18px box, 10px gap} -> size/alignment/spacing
  // Reuse means: keep the cloned <i>, swap only the glyph class (see
  // makeNavItem). No custom drawing, no library, no pseudo-element copy.

  function makeNavItem(menu, template, def) {
    // Clone a native item so structure/classes match Zalo exactly.
    let item;
    let labelNode = null;
    if (template) {
      item = template.cloneNode(true); // keep native classes
      item.removeAttribute('id');
      item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      // Never inherit state from the template: a cloned `selected`/`disabled`
      // would light up (or dim) all three entries at once.
      item.classList.remove('selected', 'disabled');
      item.removeAttribute('aria-selected');
      // Replace visible label, keep icon nodes intact.
      labelNode = [...item.querySelectorAll('span, div, p')]
        .find((n) => n.children.length === 0 && n.textContent.trim());
      if (labelNode) {
        labelNode.textContent = def.label;
        // Zalo re-applies translations via data-translate-* on language change;
        // drop those hooks so our label is never reverted to a native string.
        [...labelNode.attributes].forEach((a) => {
          if (/^data-translate/i.test(a.name)) labelNode.removeAttribute(a.name);
        });
      } else item.textContent = def.label;
      // Per-entry icon: reuse the cloned native <i>, swap only its glyph class
      // to this entry's verified Zalo icon name (def.icon). The element keeps
      // `fa` + `setting-menu__icon`, so Zalo's own font, glyph, size, color
      // and alignment apply untouched.
      const iconEl = item.querySelector('i.fa, i.setting-menu__icon, [class*="setting-menu__icon"]');
      if (iconEl && def.icon) {
        // Array.from: works on array-like classList even where it is not iterable.
        Array.from(iconEl.classList)
          .filter((c) => c !== 'fa' && c !== 'setting-menu__icon' && /^fa-/i.test(c))
          .forEach((c) => iconEl.classList.remove(c));
        iconEl.classList.add('fa-' + def.icon);
      }
    } else {
      item = document.createElement('div');
      item.textContent = def.label;
    }
    item.id = def.id;
    item.classList.add('bz-nav-item');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.style.cursor = 'pointer';
    // Exact native sidebar type: 14px via the --f14 token.
    const label = labelNode || item;
    label.classList.add('bz-nav-label');
    label.style.fontSize = 'var(--f14, 0.875rem)';
    label.style.fontWeight = '400';
    label.style.lineHeight = '1.5';
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNavItem(menu, def);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
    return item;
  }

  function selectNavItem(menu, def) {
    clearActiveStates(menu);
    const item = menu.querySelector('#' + def.id);
    if (item) {
      if (nativeActiveClass) item.classList.add(nativeActiveClass);
      item.classList.add('bz-item-active');
      item.setAttribute('aria-selected', 'true');
    }
    openPage(def.key);
  }

  function injectSidebar(menu) {
    if (menu.dataset.bzInjected === '1') return;
    menu.dataset.bzInjected = '1';
    ensureStyle();

    const section = document.createElement('div');
    section.id = SECTION_ID;

    const header = document.createElement('div');
    header.className = 'bz-section-header';
    header.textContent = 'BetterZalo Settings';
    section.appendChild(header);

    const template = pickTemplateItem(menu);
    detectNativeActiveClass(menu, template);
    for (const def of NAV_ITEMS) section.appendChild(makeNavItem(menu, template, def));

    menu.appendChild(section);
    log('sidebar injected: 3 entries');

    // Native option selected -> restore native content, hide our pages.
    menu.addEventListener('click', (e) => {
      if (e.target.closest('#' + SECTION_ID)) return;
      clearBzActive(menu);
      restoreNative();
    });
  }

  function hideNativeNav(root) {
    const nav = findNativeNav(root);
    if (nav && nav.style.display !== 'none') {
      nav.dataset.bzPrevDisplay = nav.style.display;
      nav.style.display = 'none';
    }
  }

  function restoreNative() {
    const root = findSettingsContent();
    if (!root) return;
    const nav = findNativeNav(root);
    if (nav) {
      nav.style.display = nav.dataset.bzPrevDisplay || '';
      delete nav.dataset.bzPrevDisplay;
    }
    const page = root.querySelector(':scope > .bz-page');
    if (page) page.style.display = 'none';
    log('native settings restored');
  }

  /* ---------- placeholder pages (UI/navigation only) ---------- */

  const PAGE_COPY = {
    betterzalo: { label: 'BetterZalo', body: 'BetterZalo settings will be available here in a future update.' },
    plugins: { label: 'Plugins', body: 'Plugin management will be available here in a future update.' },
    themes: { label: 'Themes Library', body: 'The themes library will be available here in a future update.' },
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function openPage(view) {
    ensureStyle();
    if (!PAGE_COPY[view]) view = 'betterzalo';
    currentView = view;
    const root = findSettingsContent();
    if (!root) {
      warn('openPage: #setting-right not found');
      return;
    }
    hideNativeNav(root);
    let page = root.querySelector(':scope > .bz-page');
    if (!page) {
      page = document.createElement('div');
      page.className = 'bz-page';
      root.appendChild(page);
    }
    page.style.display = '';
    page.dataset.view = view;
    renderPage(page, view);
    log('page opened:', view);
  }

  function renderPage(page, view) {
    page.innerHTML = '';
    const copy = PAGE_COPY[view];
    // Native settings section structure.
    const section = el('div', 'setting-section');
    section.appendChild(el('div', 'setting-section-label', copy.label));
    const content = el('div', 'setting-section-content');
    content.appendChild(el('div', 'setting-section-content__item', copy.body));
    section.appendChild(content);
    page.appendChild(section);
  }

  /* ---------- boot ---------- */

  function boot() {
    if (window.BetterZalo && window.BetterZalo.__booted) {
      warn('already initialized');
      return window.BetterZalo;
    }
    ensureStyle();
    applyCustomCSS();

    const api = {
      version: VERSION,
      configKey: CONFIG_KEY,
      registerPlugin,
      unregisterPlugin,
      getPlugin,
      enablePlugin: (id) => setEnabled(id, true),
      disablePlugin: (id) => setEnabled(id, false),
      setPluginOptions,
      listPlugins: () => [...registry.values()],
      storage,
      ui: { openPage, refresh: () => openPage(currentView) },
      __booted: true,
    };
    window.BetterZalo = api;

    // Settings modal mounts lazily -> watch for it.
    const tryInject = () => {
      const menu = findSettingMenu();
      if (menu) injectSidebar(menu);
    };
    tryInject();
    if (!observer && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(tryInject);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
    log('core v' + VERSION + ' initialized');
    return api;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
