(() => {
  'use strict';

  const TAG = '[BetterZalo]';
  const VERSION = '0.1.0';
  const CONFIG_KEY = 'better_zalo_config';
  const STYLE_ID = 'betterzalo-styles';
  const CUSTOM_CSS_ID = 'betterzalo-custom-css';
  const SECTION_ID = 'better-zalo-section';

  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  const memFallback = { data: null };

  function defaultStore() {
    return {
      plugins: {},
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

  const registry = new Map();
  const getStore = () => readStore();
  const putStore = (s) => writeStore(s);

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
    const { id, name, version, description, author, requiresRestart, optionsSchema } = pluginObj;
    if (typeof id !== 'string' || !id.trim()) {
      err('registerPlugin: "id" must be a non-empty string');
      return false;
    }
    if (typeof name !== 'string' || !name.trim()) {
      err(`registerPlugin("${id}"): "name" must be a non-empty string`);
      return false;
    }
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
    if (pluginObj.optionsSchema !== undefined && !Array.isArray(pluginObj.optionsSchema)) {
      err(`registerPlugin("${id}"): "optionsSchema" must be an array`);
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
      requiresRestart: !!requiresRestart,
      optionsSchema: Array.isArray(optionsSchema)
        ? optionsSchema.filter((o) => o && typeof o.key === 'string' && typeof o.label === 'string')
        : [],
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

  const pendingRestart = new Set();

  function setEnabled(id, enabled) {
    const rec = registry.get(id);
    if (!rec) return false;
    const next = !!enabled;
    if (rec.enabled === next) return true;
    rec.enabled = next;
    persistPluginState(rec);
    if (rec.requiresRestart) {
      pendingRestart.add(id);
      log(`plugin "${id}" ${next ? 'enabled' : 'disabled'} (pending restart)`);
      return true;
    }
    if (next) safeInvoke(id, 'onEnable', { ...rec.options });
    else safeInvoke(id, 'onDisable');
    log(`plugin "${id}" ${next ? 'enabled' : 'disabled'}`);
    return true;
  }

  function setPluginOptions(id, nextOptions) {
    const rec = registry.get(id);
    if (!rec) return false;
    rec.options = { ...(nextOptions || {}) };
    persistPluginState(rec);
    if (rec.requiresRestart) {
      pendingRestart.add(id);
      log(`plugin "${id}" options staged (pending restart)`);
      return true;
    }
    safeInvoke(id, 'onOptionsChange', { ...rec.options });
    return true;
  }

  function isRestartPending() {
    return pendingRestart.size > 0;
  }

  function restart() {
    log('restarting to apply plugin changes');
    location.reload();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
    .bz-section-header {
      padding: 12px 16px 4px; font-size: var(--f18, 1.125rem); font-weight: 500;
      line-height: 1.5;
      color: var(--text-primary, black);
      user-select: none;
    }
    body.dark .bz-section-header,
    html.dark .bz-section-header {
      color: var(--text-on-color, white);
    }
    .bz-nav-item {
      box-sizing: border-box !important;
      height: 40px !important;
      margin: 4px 8px !important;
      padding: 0 8px !important;
      border-radius: 6px !important;
    }
    .bz-nav-item:hover {
      background-color: #f1f2f4;
    }
    body.dark .bz-nav-item:hover,
    html.dark .bz-nav-item:hover {
      background-color: #2d3136;
    }
    .bz-item-active,
    .bz-item-active:hover {
      background-color: var(--layer-background-selected, var(--background-activeness, Highlight)) !important;
    }
    .bz-nav-label {
      font-size: var(--f14, 0.875rem) !important;
      font-weight: 400 !important;
      line-height: 1.5 !important;
    }
    .bz-page {
      box-sizing: border-box; height: 100%; overflow-y: auto; padding: 20px 24px 32px;
      background-color: var(--surface-background-subtle);
      color: var(--text-primary, CanvasText);
      font: inherit;
    }
    .bz-page .setting-section { margin-bottom: 20px; }
    .bz-page .bz-placeholder { background-color: transparent; }
    .bz-plugin-card {
      display: flex; flex-direction: column; gap: 8px;
      background-color: var(--layer-background);
      border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
      border-radius: 8px; padding: 12px 16px; margin: 0;
    }
    .bz-plugin-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;
    }
    .bz-plugin-card__header { display: flex; align-items: center; gap: 4px; }
    .bz-plugin-card__name {
      flex: 1 1 auto; min-width: 0; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
      color: var(--text-primary);
      font-size: var(--f14, 0.875rem); font-weight: 500; line-height: 1.5;
    }
    .bz-plugin-card__desc {
      color: var(--text-secondary);
      font-size: var(--f13, 0.8125rem); font-weight: 400; line-height: 1.5;
    }
    .bz-plugin-card__controls { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; }
    .bz-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border: 0; border-radius: 6px;
      background: transparent; cursor: pointer;
      color: var(--icon-secondary, var(--text-secondary));
      font-size: 1.125rem;
      transition: background-color 150ms ease, color 150ms ease;
    }
    .bz-icon-btn:hover { background-color: var(--layer-background-hover); color: var(--icon-primary, var(--text-primary)); }
    .bz-icon-btn:active { transform: scale(0.95); }
    .bz-icon-btn:focus-visible, .bz-restart-btn:focus-visible, .z-toggle[role="switch"]:focus-visible {
      outline: 2px solid var(--button-primary-normal); outline-offset: 2px;
    }
    .bz-restart-banner {
      background-color: rgba(0, 104, 255, 0.08);
      background-color: color-mix(in srgb, var(--button-primary-normal) 12%, transparent);
      border: 1px solid var(--button-primary-normal);
      border-radius: 8px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      padding: 12px 16px; margin: 0 0 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .bz-restart-banner__text { min-width: 0; }
    .bz-restart-banner__title {
      color: var(--text-primary);
      font-size: var(--f14, 0.875rem); font-weight: 500; line-height: 1.5;
    }
    .bz-restart-banner__sub {
      color: var(--text-secondary);
      font-size: var(--f13, 0.8125rem); font-weight: 400; line-height: 1.5;
    }
    .bz-restart-btn {
      width: 100%; cursor: pointer;
      border: 1px solid var(--button-primary-normal); border-radius: 6px;
      background: transparent; color: var(--button-primary-normal);
      font-size: var(--f14, 0.875rem); font-weight: 500; line-height: 1.5;
      padding: 6px 16px;
      transition: background-color 150ms ease, color 150ms ease;
    }
    .bz-restart-btn:hover {
      background-color: var(--button-primary-normal); color: var(--button-primary-text);
    }
    .bz-restart-btn:active { transform: scale(0.97); }
    .bz-modal-backdrop {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      animation: bz-fade-in 160ms ease-out;
    }
    .bz-modal {
      width: min(440px, calc(100% - 48px)); max-height: calc(100% - 64px);
      overflow-y: auto;
      background-color: var(--layer-background);
      border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
      border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      padding: 16px;
      animation: bz-pop-in 180ms ease-out;
    }
    @keyframes bz-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bz-pop-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .bz-modal-backdrop, .bz-modal { animation: none; }
      .bz-icon-btn, .bz-restart-btn { transition: none; }
    }
    .bz-modal__header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
    .bz-modal__title {
      flex: 1 1 auto; color: var(--text-primary);
      font-size: var(--f16, 1rem); font-weight: 500; line-height: 1.5;
    }
    .bz-modal__desc {
      color: var(--text-secondary);
      font-size: var(--f13, 0.8125rem); font-weight: 400; line-height: 1.5;
      margin-bottom: 12px;
    }
    .bz-modal__section {
      color: var(--text-primary);
      font-size: var(--f16, 1rem); font-weight: 500; line-height: 1.5;
      margin-bottom: 4px;
    }
    .bz-option-row {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 0; border-top: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
    }
    .bz-option-row__text { flex: 1 1 auto; min-width: 0; }
    .bz-option-row__label {
      color: var(--text-primary);
      font-size: var(--f14, 0.875rem); font-weight: 400; line-height: 1.5;
    }
    .bz-option-row__hint {
      color: var(--text-secondary);
      font-size: var(--f13, 0.8125rem); font-weight: 400; line-height: 1.5;
    }
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

  const NAV_ITEMS = [
    // Native Zalo glyph per entry (verified in Zalo's stylesheet).
    { key: 'betterzalo', id: 'better-zalo-tab', label: 'BetterZalo', icon: 'Setting_24_Line' },
    { key: 'plugins', id: 'better-zalo-plugins-tab', label: 'Plugins', icon: 'Utility_24_Line' },
    { key: 'themes', id: 'better-zalo-themes-tab', label: 'Themes Library', icon: 'Theme_24_Line' },
  ];

  let currentView = 'betterzalo';
  let observer = null;
  let nativeActiveClass = '';

  // Settings modal mounts lazily; hooks exist only while it is open.
  function findSettingMenu() {
    return document.querySelector('div.setting-menu');
  }
  function findSettingsContent() {
    return document.querySelector('#setting-right');
  }
  function findNativeNav(root) {
    return root.querySelector('.stack-navigation');
  }

  function pickTemplateItem(menu) {
    // Clone a real item (never our section or the header: no icon node there).
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
    menu.querySelectorAll('[class*="active"], [class*="selected"], [aria-selected="true"]').forEach((el) => {
      el.classList.remove('active', 'selected');
      el.removeAttribute('aria-selected');
    });
  }

  // Reuses Zalo's `.setting-menu__item.selected` mechanism when detected.
  function detectNativeActiveClass(menu, template) {
    const base = new Set(template ? [...template.classList] : []);
    const flagged = menu.querySelector('[aria-selected="true"]');
    const candidates = flagged
      ? [flagged]
      : [...menu.querySelectorAll('[class*="active"], [class*="selected"]')];
    for (const cand of candidates) {
      if (cand.closest('#' + SECTION_ID)) continue;
      for (const c of [...cand.classList]) {
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

  // Native icon: <i class="fa fa-<Name> setting-menu__icon">, rendered by Zalo's own CSS.
  function makeNavItem(menu, template, def) {
    let item;
    let labelNode = null;
    if (template) {
      item = template.cloneNode(true);
      item.removeAttribute('id');
      item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      // Never inherit template state.
      item.classList.remove('selected', 'disabled');
      item.removeAttribute('aria-selected');
      labelNode = [...item.querySelectorAll('span, div, p')]
        .find((n) => n.children.length === 0 && n.textContent.trim());
      if (labelNode) {
        labelNode.textContent = def.label;
        // Drop i18n hooks so Zalo never reverts our labels.
        [...labelNode.attributes].forEach((a) => {
          if (/^data-translate/i.test(a.name)) labelNode.removeAttribute(a.name);
        });
      } else item.textContent = def.label;
      // Keep the cloned <i>; swap only the glyph class.
      const iconEl = item.querySelector('i.fa, i.setting-menu__icon, [class*="setting-menu__icon"]');
      if (iconEl && def.icon) {
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
    if (view === 'plugins') {
      renderPluginsPage(page);
      return;
    }
    const copy = PAGE_COPY[view];
    const section = el('div', 'setting-section');
    section.appendChild(el('div', 'setting-section-label', copy.label));
    const content = el('div', 'setting-section-content');
    content.appendChild(el('div', 'setting-section-content__item bz-placeholder', copy.body));
    section.appendChild(content);
    page.appendChild(section);
  }

  // Native switch: .z-toggle track + fa-toggle-* knob glyph, state via .z-toggle--active.
  function makeToggle(checked, onFlip) {
    const t = document.createElement('div');
    t.className = 'z-toggle --m' + (checked ? ' z-toggle--active' : '');
    t.setAttribute('role', 'switch');
    t.setAttribute('tabindex', '0');
    t.setAttribute('aria-checked', checked ? 'true' : 'false');
    t.style.cursor = 'pointer';
    const track = document.createElement('div');
    t.appendChild(track);
    const knob = document.createElement('i');
    knob.className = 'fa ' + (checked ? 'fa-toggle-checked-24' : 'fa-toggle-unchecked-24');
    t.appendChild(knob);
    const flip = (e) => {
      if (e) e.stopPropagation();
      onFlip(!t.classList.contains('z-toggle--active'));
    };
    t.addEventListener('click', flip);
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flip(e);
      }
    });
    return t;
  }

  function fullOptions(rec) {
    const out = {};
    for (const opt of rec.optionsSchema) out[opt.key] = rec.options[opt.key] !== false;
    return out;
  }

  function renderPluginsPage(page) {
    page.innerHTML = '';
    const section = el('div', 'setting-section');
    section.appendChild(el('div', 'setting-section-label', 'Plugins'));

    if (pendingRestart.size > 0) {
      const banner = el('div', 'bz-restart-banner');
      const text = el('div', 'bz-restart-banner__text');
      text.appendChild(el('div', 'bz-restart-banner__title', 'Restart required!'));
      text.appendChild(el('div', 'bz-restart-banner__sub', 'Restart now to apply new plugins and their settings'));
      banner.appendChild(text);
      const btn = el('button', 'bz-restart-btn', 'Restart');
      btn.setAttribute('type', 'button');
      btn.addEventListener('click', () => restart());
      banner.appendChild(btn);
      section.appendChild(banner);
    }

    const plugins = [...registry.values()];
    if (plugins.length === 0) {
      const content = el('div', 'setting-section-content');
      content.appendChild(el('div', 'setting-section-content__item bz-placeholder', PAGE_COPY.plugins.body));
      section.appendChild(content);
    }
    const grid = el('div', 'bz-plugin-grid');
    for (const rec of plugins) {
      const card = el('div', 'bz-plugin-card');
      const header = el('div', 'bz-plugin-card__header');
      header.appendChild(el('div', 'bz-plugin-card__name', rec.name));
      const controls = el('div', 'bz-plugin-card__controls');
      const gear = document.createElement('button');
      gear.className = 'bz-icon-btn';
      gear.setAttribute('type', 'button');
      gear.setAttribute('aria-label', rec.name + ' settings');
      const gearIcon = document.createElement('i');
      gearIcon.className = 'fa fa-gear';
      gear.appendChild(gearIcon);
      gear.addEventListener('click', (e) => {
        e.stopPropagation();
        openPluginSettings(rec, page);
      });
      controls.appendChild(gear);
      controls.appendChild(makeToggle(rec.enabled, (next) => {
        setEnabled(rec.id, next);
        renderPluginsPage(page);
      }));
      header.appendChild(controls);
      card.appendChild(header);
      card.appendChild(el('div', 'bz-plugin-card__desc', rec.description));
      grid.appendChild(card);
    }
    section.appendChild(grid);
    page.appendChild(section);
  }

  function openPluginSettings(rec, page) {
    closePluginSettings();
    const backdrop = el('div', 'bz-modal-backdrop');
    const modal = el('div', 'bz-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', rec.name + ' settings');
    backdrop.appendChild(modal);

    const header = el('div', 'bz-modal__header');
    header.appendChild(el('div', 'bz-modal__title', rec.name));
    const closeBtn = document.createElement('button');
    closeBtn.className = 'bz-icon-btn';
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('aria-label', 'Close settings');
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa fa-Close_24_Line';
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener('click', () => closePluginSettings());
    header.appendChild(closeBtn);
    modal.appendChild(header);
    modal.appendChild(el('div', 'bz-modal__desc', rec.description));

    const renderOptions = () => {
      modal.querySelectorAll('.bz-option-row, .bz-modal__section').forEach((n) => n.remove());
      const current = fullOptions(rec);
      if (rec.optionsSchema.length === 0) {
        modal.appendChild(el('div', 'bz-modal__desc', 'No settings available.'));
        return;
      }
      modal.appendChild(el('div', 'bz-modal__section', 'Settings'));
      for (const opt of rec.optionsSchema) {
        const row = el('div', 'bz-option-row');
        const text = el('div', 'bz-option-row__text');
        text.appendChild(el('div', 'bz-option-row__label', opt.label));
        if (opt.description) text.appendChild(el('div', 'bz-option-row__hint', opt.description));
        row.appendChild(text);
        row.appendChild(makeToggle(!!current[opt.key], (next) => {
          setPluginOptions(rec.id, { ...fullOptions(rec), [opt.key]: next });
          renderOptions();
          if (page && page.isConnected) renderPluginsPage(page);
        }));
        modal.appendChild(row);
      }
    };
    renderOptions();

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePluginSettings();
    });
    backdrop.__bzEsc = (e) => {
      if (e.key === 'Escape') closePluginSettings();
    };
    document.addEventListener('keydown', backdrop.__bzEsc);
    document.body.appendChild(backdrop);
  }

  function closePluginSettings() {
    document.querySelectorAll('.bz-modal-backdrop').forEach((b) => {
      if (b.__bzEsc) document.removeEventListener('keydown', b.__bzEsc);
      b.remove();
    });
  }

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
      restart,
      isRestartPending,
      storage,
      ui: { openPage, refresh: () => openPage(currentView) },
      __booted: true,
    };
    window.BetterZalo = api;

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
    window.dispatchEvent(new Event('betterzalo:ready'));
    return api;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
