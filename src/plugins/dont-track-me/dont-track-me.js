(() => {
  'use strict';

  const ID = 'dont-track-me';

  const OPTIONS_SCHEMA = [
    { key: 'sentry', label: 'Crash reporting', description: 'Blocks crash reports sent to sentrypc.api.zalo.me.' },
    { key: 'googleAnalytics', label: 'Usage analytics', description: 'Blocks Google Analytics event collection.' },
    { key: 'qos', label: 'Performance telemetry', description: 'Blocks quality-of-service uploads to qos.talk.zing.vn.' },
    { key: 'actionLog', label: 'Action logging', description: 'Blocks batched interface action log uploads.' },
    { key: 'userlog', label: 'User event logging', description: 'Blocks user event log uploads.' },
  ];

  const BLOCKS = {
    sentry: ['sentrypc.api.zalo.me'],
    googleAnalytics: ['google-analytics.com', 'googletagmanager.com'],
    qos: ['qos.talk.zing.vn', '/api/qos/'],
    actionLog: ['/actionlog'],
    userlog: ['/userlog'],
  };

  const defaultOptions = () => {
    const out = {};
    for (const opt of OPTIONS_SCHEMA) out[opt.key] = true;
    return out;
  };

  let installed = false;
  let activePatterns = [];
  const orig = {};

  function collectPatterns(options) {
    const out = [];
    for (const key of Object.keys(BLOCKS)) {
      if (options && options[key]) out.push(...BLOCKS[key]);
    }
    return out;
  }

  function isBlocked(url) {
    if (typeof url !== 'string') return false;
    for (const p of activePatterns) {
      if (url.indexOf(p) !== -1) return true;
    }
    return false;
  }

  function install(options) {
    activePatterns = collectPatterns(options);
    if (installed || activePatterns.length === 0) return;
    installed = true;
    orig.fetch = window.fetch;
    orig.open = XMLHttpRequest.prototype.open;
    orig.send = XMLHttpRequest.prototype.send;
    orig.beacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;

    window.fetch = function patchedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isBlocked(url)) return Promise.reject(new Error('[BetterZalo] blocked telemetry request'));
      return orig.fetch.apply(this, arguments);
    };

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__bzUrl = url;
      return orig.open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function patchedSend() {
      if (isBlocked(this.__bzUrl)) {
        this.abort();
        return undefined;
      }
      return orig.send.apply(this, arguments);
    };

    if (orig.beacon) {
      navigator.sendBeacon = function patchedBeacon(url) {
        if (isBlocked(String(url))) return false;
        return orig.beacon.apply(navigator, arguments);
      };
    }
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    activePatterns = [];
    if (orig.fetch) window.fetch = orig.fetch;
    if (orig.open) XMLHttpRequest.prototype.open = orig.open;
    if (orig.send) XMLHttpRequest.prototype.send = orig.send;
    if (orig.beacon) navigator.sendBeacon = orig.beacon;
  }

  function refresh(options) {
    uninstall();
    install(options);
  }

  function definition() {
    return {
      id: ID,
      name: "Don't Track Me",
      version: '0.1.0',
      description: "Disable Zalo's telemetry and tracking.",
      author: 'BetterZalo',
      enabled: true,
      requiresRestart: true,
      optionsSchema: OPTIONS_SCHEMA,
      defaultOptions: defaultOptions(),
      onEnable(options) { install(options); },
      onDisable() { uninstall(); },
      onOptionsChange(options) { refresh(options); },
    };
  }

  function tryRegister() {
    if (!window.BetterZalo || typeof window.BetterZalo.registerPlugin !== 'function') return false;
    return window.BetterZalo.registerPlugin(definition());
  }

  if (!tryRegister()) {
    window.addEventListener('betterzalo:ready', tryRegister, { once: true });
  }
})();
