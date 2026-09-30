/* BetterZalo Core Framework - vanilla ES6+ IIFE, zero dependencies. */

(() => {
  'use strict';

  const TAG = '[BetterZalo]';
  const VERSION = '0.1.0';
  const CONFIG_KEY = 'better_zalo_config';
  const STYLE_ID = 'betterzalo-styles';
  const CUSTOM_CSS_ID = 'betterzalo-custom-css';
  const DASHBOARD_ID = 'betterzalo-dashboard';
  const SECTION_ID = 'better-zalo-tab'; // legacy AGENTS.md tab id -> section wrapper
  const OVERVIEW_ITEM_ID = 'better-zalo-overview-tab'; // primary sidebar item

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
    refreshPluginsView();
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
    refreshPluginsView();
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
    refreshPluginsView();
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
    style.textContent = `
    #${SECTION_ID} { display: contents; }
    .bz-section-header {
      padding: 12px 16px 4px; font-size: 12px; font-weight: 600;
      letter-spacing: .04em; text-transform: uppercase;
      color: var(--text-secondary, var(--text-primary, GrayText));
      user-select: none;
    }
    .bz-item-active {
      background: var(--background-activeness, var(--layer-background-subtle, Highlight)) !important;
    }
    #${DASHBOARD_ID} {
      box-sizing: border-box; height: 100%; overflow-y: auto; padding: 20px 24px 32px;
      background: var(--layer-background, var(--main-background, Canvas));
      color: var(--text-primary, CanvasText);
      font: inherit;
    }
    .bz-topbar {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding-bottom: 12px; margin-bottom: 16px;
      border-bottom: 1px solid var(--border, var(--border-color, ButtonBorder));
    }
    .bz-title { font-size: 18px; font-weight: 700; margin-right: 8px; }
    .bz-version {
      font-size: 11px; padding: 2px 8px; border-radius: 9999px;
      border: 1px solid var(--border, var(--border-color, ButtonBorder));
      color: var(--text-secondary, var(--text-primary, GrayText));
    }
    .bz-tab {
      border: 1px solid transparent; background: transparent; cursor: pointer;
      color: inherit; font: inherit; font-size: 13px; font-weight: 600;
      padding: 6px 12px; border-radius: 6px;
    }
    .bz-tab:hover { background: var(--background-inactiveness-subtle, var(--layer-background-subtle, ButtonFace)); }
    .bz-tab[aria-selected="true"] {
      border-color: var(--border, var(--border-color, ButtonBorder));
      background: var(--background-activeness, var(--layer-background-subtle, Highlight));
    }
    .bz-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
    @media (min-width: 900px) { .bz-grid.cols-2 { grid-template-columns: 1fr 1fr; } }
    .bz-card {
      border: 1px solid var(--border, var(--border-color, ButtonBorder));
      border-radius: 8px; padding: 16px 18px;
      background: var(--layer-background-subtle, var(--main-background, Canvas));
    }
    .bz-card h3 { margin: 0 0 4px; font-size: 14px; }
    .bz-muted { color: var(--text-secondary, var(--text-primary, GrayText)); font-size: 12px; }
    .bz-plugin-row {
      display: flex; align-items: flex-start; gap: 12px;
      border: 1px solid var(--border, var(--border-color, ButtonBorder));
      border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;
      background: var(--layer-background-subtle, var(--main-background, Canvas));
    }
    .bz-plugin-main { flex: 1; min-width: 0; }
    .bz-plugin-name { font-weight: 600; font-size: 13px; }
    .bz-badge {
      display: inline-block; font-size: 11px; margin-left: 8px; padding: 1px 8px;
      border-radius: 9999px; border: 1px solid var(--border, var(--border-color, ButtonBorder));
      color: var(--text-secondary, var(--text-primary, GrayText));
    }
    .bz-plugin-desc { font-size: 12px; color: var(--text-secondary, var(--text-primary, GrayText)); margin-top: 2px; }
    .bz-switch {
      position: relative; width: 36px; height: 20px; flex: none; cursor: pointer;
      border-radius: 9999px; border: 1px solid var(--border-bold, var(--border, ButtonBorder));
      background: var(--background-inactiveness, var(--layer-background-subtle, ButtonFace));
    }
    .bz-switch::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: var(--text-secondary, GrayText); transition: transform 160ms ease;
    }
    .bz-switch[aria-checked="true"] { background: var(--accent-skyblue-text, Highlight); }
    .bz-switch[aria-checked="true"]::after { transform: translateX(16px); background: var(--text-on-color, HighlightText); }
    .bz-btn {
      font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--border, var(--border-color, ButtonBorder));
      background: var(--layer-background, var(--main-background, ButtonFace));
      color: var(--text-primary, ButtonText); border-radius: 6px; padding: 6px 12px;
    }
    .bz-btn:hover { background: var(--background-inactiveness-subtle, var(--layer-background-subtle, ButtonFace)); }
    .bz-btn:active { transform: scale(.98); }
    .bz-btn.danger { color: var(--accent-red-text, var(--text-errors, ButtonText)); border-color: var(--border-errors, var(--border, ButtonBorder)); }
    .bz-input, .bz-textarea, .bz-select {
      font: inherit; font-size: 12px; width: 100%; box-sizing: border-box;
      color: var(--text-primary, FieldText);
      background: var(--layer-background, var(--main-background, Field));
      border: 1px solid var(--border, var(--border-color, ButtonBorder));
      border-radius: 6px; padding: 8px 10px;
    }
    .bz-textarea { min-height: 140px; font-family: ui-monospace, Consolas, monospace; resize: vertical; }
    .bz-drawer {
      margin-top: 8px; padding-top: 8px;
      border-top: 1px solid var(--divider-bold, var(--border-subtle, var(--border, ButtonBorder)));
    }
    .bz-opt-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; }
    .bz-opt-row label { flex: 1; }
    .bz-opt-row input[type="text"], .bz-opt-row input[type="number"] { width: 160px; }
    .bz-row-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
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

  /* ---------- sidebar injection (settings modal is dynamic) ---------- */

  let currentView = 'overview';
  let observer = null;

  // Reverse-engineered hook: .setting-menu only exists while the settings modal is open.
  function findSettingMenu() {
    return document.querySelector('div.setting-menu');
  }
  function findContentBody() {
    return document.querySelector('div.setting-content-body');
  }

  function pickTemplateItem(menu) {
    return (
      menu.querySelector('[role="menuitem"], [role="tab"], li, div > div') ||
      menu.firstElementChild
    );
  }

  function clearActiveStates(menu) {
    menu.querySelectorAll('.bz-item-active').forEach((el) => el.classList.remove('bz-item-active'));
    // Best-effort: drop native active classes so only BetterZalo looks selected.
    menu.querySelectorAll('[class*="active"], [class*="selected"], [aria-selected="true"]').forEach((el) => {
      el.classList.remove('active', 'selected');
      el.removeAttribute('aria-selected');
    });
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

    // Clone a native item so spacing/typography match Zalo exactly.
    const template = pickTemplateItem(menu);
    let item;
    if (template) {
      item = template.cloneNode(true); // keep native classes
      item.removeAttribute('id');
      item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      // Replace visible label, keep icon nodes intact.
      const labelNode = [...item.querySelectorAll('span, div, p')]
        .find((n) => n.children.length === 0 && n.textContent.trim());
      if (labelNode) labelNode.textContent = 'BetterZalo';
      else item.textContent = 'BetterZalo';
    } else {
      item = document.createElement('div');
      item.textContent = 'BetterZalo';
    }
    item.id = OVERVIEW_ITEM_ID;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.style.cursor = 'pointer';
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      clearActiveStates(menu);
      item.classList.add('bz-item-active');
      openDashboard('overview');
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
    section.appendChild(item);

    menu.appendChild(section);
    log('sidebar injected');

    // Native item clicked -> restore native panels, dim our item.
    menu.addEventListener('click', (e) => {
      const ours = e.target.closest('#' + OVERVIEW_ITEM_ID);
      if (ours) return;
      const bzItem = menu.querySelector('#' + OVERVIEW_ITEM_ID);
      if (bzItem) bzItem.classList.remove('bz-item-active');
      const body = findContentBody();
      if (body) setNativePanelsVisible(body, true);
      const dash = document.getElementById(DASHBOARD_ID);
      if (dash) dash.style.display = 'none';
    });
  }

  function setNativePanelsVisible(body, visible) {
    [...body.children].forEach((child) => {
      if (child.id === DASHBOARD_ID) return;
      if (visible) {
        child.style.display = child.dataset.bzPrevDisplay || '';
        delete child.dataset.bzPrevDisplay;
      } else if (child.style.display !== 'none') {
        child.dataset.bzPrevDisplay = child.style.display;
        child.style.display = 'none';
      }
    });
  }

  /* ---------- dashboard ---------- */

  function openDashboard(view) {
    ensureStyle();
    currentView = view || currentView || 'overview';
    const body = findContentBody();
    if (!body) {
      warn('openDashboard: div.setting-content-body not found');
      return;
    }
    setNativePanelsVisible(body, false);
    let dash = document.getElementById(DASHBOARD_ID);
    if (!dash) {
      dash = document.createElement('div');
      dash.id = DASHBOARD_ID;
      body.appendChild(dash);
    }
    dash.style.display = '';
    renderDashboard(dash, currentView);
    log('dashboard opened:', currentView);
  }

  function renderDashboard(root, view) {
    root.innerHTML = '';
    root.appendChild(buildTopbar(view));
    const content = document.createElement('div');
    content.className = 'bz-content';
    content.dataset.view = view;
    if (view === 'plugins') content.appendChild(renderPlugins());
    else if (view === 'themes') content.appendChild(renderThemes());
    else if (view === 'settings') content.appendChild(renderGeneral());
    else content.appendChild(renderOverview());
    root.appendChild(content);
  }

  function buildTopbar(active) {
    const bar = document.createElement('div');
    bar.className = 'bz-topbar';
    const title = document.createElement('span');
    title.className = 'bz-title';
    title.textContent = 'BetterZalo';
    const ver = document.createElement('span');
    ver.className = 'bz-version';
    ver.textContent = 'v' + VERSION;
    bar.append(title, ver);
    const tabs = [
      ['overview', 'BetterZalo'],
      ['plugins', 'Plugins'],
      ['themes', 'Themes'],
      ['settings', 'General Settings'],
    ];
    for (const [key, label] of tabs) {
      if (key === 'overview') continue; // overview is the sidebar landing item
      const b = document.createElement('button');
      b.className = 'bz-tab';
      b.textContent = label;
      b.setAttribute('aria-selected', String(active === key));
      b.addEventListener('click', () => openDashboard(key));
      bar.appendChild(b);
    }
    // Spec views: Plugins | Themes | General Settings (overview via sidebar).
    if (active === 'overview') {
      const hint = document.createElement('span');
      hint.className = 'bz-muted';
      hint.textContent = 'Main Dashboard';
      bar.appendChild(hint);
    }
    return bar;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function renderOverview() {
    const wrap = el('div', 'bz-grid cols-2');
    const info = el('div', 'bz-card');
    info.appendChild(el('h3', null, 'Client Info'));
    const count = registry.size;
    const enabled = [...registry.values()].filter((p) => p.enabled).length;
    const lines = [
      `BetterZalo v${VERSION}`,
      `Plugins: ${enabled}/${count} enabled`,
      `Theme CSS: ${getStore().settings.cssEnabled ? 'on' : 'off'}`,
      `UA: ${navigator.userAgent.slice(0, 90)}…`,
    ];
    const ul = el('div', 'bz-muted');
    ul.style.whiteSpace = 'pre-line';
    ul.textContent = lines.join('\n');
    info.appendChild(ul);

    const quick = el('div', 'bz-card');
    quick.appendChild(el('h3', null, 'Quick Actions'));
    quick.appendChild(el('div', 'bz-muted', 'Reserved container — future actions plug in here.'));
    const row = el('div', 'bz-row-actions');
    const btnCSS = el('button', 'bz-btn', 'Open QuickCSS');
    btnCSS.addEventListener('click', () => openDashboard('themes'));
    const btnExport = el('button', 'bz-btn', 'Export Config');
    btnExport.addEventListener('click', exportConfig);
    const btnRelaunch = el('button', 'bz-btn', 'Relaunch');
    btnRelaunch.addEventListener('click', () => location.reload());
    const btnFolder = el('button', 'bz-btn', 'Open Folder');
    btnFolder.addEventListener('click', () => log('Open Folder: reserved for native shell hook'));
    row.append(btnCSS, btnExport, btnRelaunch, btnFolder);
    quick.appendChild(row);

    wrap.append(info, quick);
    const host = el('div');
    host.appendChild(wrap);
    return host;
  }

  function toggleSwitch(checked, onFlip, label) {
    const b = document.createElement('button');
    b.className = 'bz-switch';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!checked));
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(next));
      onFlip(next);
    });
    return b;
  }

  function renderPlugins() {
    const host = el('div');
    if (registry.size === 0) {
      const empty = el('div', 'bz-card');
      empty.appendChild(el('h3', null, 'No plugins registered'));
      empty.appendChild(el('div', 'bz-muted', 'Plugins appear here after calling BetterZalo.registerPlugin({...}).'));
      host.appendChild(empty);
      return host;
    }
    for (const rec of registry.values()) {
      const row = el('div', 'bz-plugin-row');
      const main = el('div', 'bz-plugin-main');
      const nameLine = el('div');
      nameLine.appendChild(el('span', 'bz-plugin-name', rec.name));
      const badge = el('span', 'bz-badge', 'v' + rec.version);
      nameLine.appendChild(badge);
      main.appendChild(nameLine);
      if (rec.description) main.appendChild(el('div', 'bz-plugin-desc', rec.description));

      const drawer = el('div', 'bz-drawer');
      drawer.style.display = 'none';
      drawer.appendChild(buildOptionsEditor(rec));

      const actions = el('div', 'bz-row-actions');
      const optBtn = el('button', 'bz-btn', 'Options');
      optBtn.addEventListener('click', () => {
        drawer.style.display = drawer.style.display === 'none' ? '' : 'none';
      });
      actions.appendChild(optBtn);
      main.appendChild(actions);
      main.appendChild(drawer);

      const sw = toggleSwitch(rec.enabled, (next) => setEnabled(rec.id, next), `Enable ${rec.name}`);
      row.append(main, sw);
      host.appendChild(row);
    }
    return host;
  }

  function buildOptionsEditor(rec) {
    const host = el('div');
    const keys = Object.keys(rec.options || {});
    if (keys.length === 0) {
      host.appendChild(el('div', 'bz-muted', 'No options for this plugin.'));
      return host;
    }
    for (const key of keys) {
      const val = rec.options[key];
      const row = el('div', 'bz-opt-row');
      const label = el('label', null, key);
      let input;
      if (typeof val === 'boolean') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = val;
        input.addEventListener('change', () => {
          setPluginOptions(rec.id, { ...rec.options, [key]: input.checked });
        });
      } else if (typeof val === 'number') {
        input = document.createElement('input');
        input.type = 'number';
        input.className = 'bz-input';
        input.value = String(val);
        input.addEventListener('change', () => {
          setPluginOptions(rec.id, { ...rec.options, [key]: Number(input.value) });
        });
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'bz-input';
        input.value = String(val ?? '');
        input.addEventListener('change', () => {
          setPluginOptions(rec.id, { ...rec.options, [key]: input.value });
        });
      }
      row.append(label, input);
      host.appendChild(row);
    }
    return host;
  }

  function refreshPluginsView() {
    const dash = document.getElementById(DASHBOARD_ID);
    if (!dash) return;
    const content = dash.querySelector('.bz-content[data-view="plugins"]');
    if (!content) return;
    content.innerHTML = '';
    content.appendChild(renderPlugins());
  }

  function renderThemes() {
    const host = el('div', 'bz-grid');
    const card = el('div', 'bz-card');
    card.appendChild(el('h3', null, 'Custom CSS'));
    card.appendChild(el('div', 'bz-muted', 'Placeholder for custom CSS injection. Saved to better_zalo_config.'));
    const s = getStore().settings;
    const row = el('div', 'bz-opt-row');
    row.appendChild(el('label', null, 'Enable custom CSS'));
    const sw = toggleSwitch(!!s.cssEnabled, (next) => {
      const st = getStore();
      st.settings.cssEnabled = next;
      putStore(st);
      applyCustomCSS();
      log('custom CSS ' + (next ? 'enabled' : 'disabled'));
    }, 'Enable custom CSS');
    row.appendChild(sw);
    card.appendChild(row);
    const area = el('textarea', 'bz-textarea');
    area.value = s.customCSS || '';
    area.setAttribute('placeholder', '/* BetterZalo QuickCSS — uses Zalo vars, e.g. color: var(--text-primary); */');
    area.setAttribute('spellcheck', 'false');
    card.appendChild(area);
    const actions = el('div', 'bz-row-actions');
    const save = el('button', 'bz-btn', 'Save & Apply');
    save.addEventListener('click', () => {
      const st = getStore();
      st.settings.customCSS = area.value;
      st.settings.cssEnabled = true;
      putStore(st);
      applyCustomCSS();
      log('custom CSS saved (' + area.value.length + ' chars)');
      openDashboard('themes');
    });
    actions.appendChild(save);
    card.appendChild(actions);
    host.appendChild(card);
    return host;
  }

  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
    } catch (e) {
      err('export failed:', e);
    }
  }

  function exportConfig() {
    const json = storage.export();
    downloadText('better-zalo-config.json', json);
    log('config exported');
  }

  function renderGeneral() {
    const host = el('div', 'bz-grid cols-2');
    const fw = el('div', 'bz-card');
    fw.appendChild(el('h3', null, 'Framework'));
    const tRow = el('div', 'bz-opt-row');
    tRow.appendChild(el('label', null, 'Telemetry'));
    const st = getStore().settings;
    tRow.appendChild(toggleSwitch(!!st.telemetry, (next) => {
      const s = getStore();
      s.settings.telemetry = next;
      putStore(s);
      log('telemetry ' + (next ? 'on' : 'off'));
    }, 'Telemetry'));
    fw.appendChild(tRow);
    const actions = el('div', 'bz-row-actions');
    const exp = el('button', 'bz-btn', 'Export Config');
    exp.addEventListener('click', exportConfig);
    const imp = el('button', 'bz-btn', 'Import Config');
    imp.addEventListener('click', () => fileInput.click());
    const reset = el('button', 'bz-btn danger', 'Reset All');
    reset.addEventListener('click', () => {
      if (!window.confirm('Reset BetterZalo config? This disables all plugins.')) return;
      storage.reset();
      applyCustomCSS();
      log('config reset');
      openDashboard('settings');
    });
    actions.append(exp, imp, reset);
    fw.appendChild(actions);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          storage.import(String(reader.result));
          applyCustomCSS();
          log('config imported');
          openDashboard('settings');
        } catch (e) {
          err('import failed:', e);
          window.alert('Import failed: invalid config file.');
        }
      };
      reader.readAsText(f);
      fileInput.value = '';
    });
    fw.appendChild(fileInput);

    const about = el('div', 'bz-card');
    about.appendChild(el('h3', null, 'About'));
    about.appendChild(el('div', 'bz-muted',
      `BetterZalo v${VERSION} — modular settings framework for Zalo PC/Web.\nStorage key: ${CONFIG_KEY}`));
    host.append(fw, about);
    return host;
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
      ui: { openDashboard, refresh: () => openDashboard(currentView) },
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
