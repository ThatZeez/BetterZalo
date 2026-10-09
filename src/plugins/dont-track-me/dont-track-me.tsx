// Minimal plugin-side view of the window.BetterZalo contract.
// The framework owns this API; plugins only consume it.
// (Top-level so Window merges globally; types erase at compile time.)
interface BetterZaloOptionSchemaEntry {
  key: string;
  label: string;
  description?: string;
}

interface BetterZaloPlugin<TOptions extends Record<string, boolean> = Record<string, boolean>> {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  requiresRestart?: boolean;
  optionsSchema?: BetterZaloOptionSchemaEntry[];
  defaultOptions?: TOptions;
  onEnable(options: TOptions): void;
  onDisable(): void;
  onOptionsChange(options: TOptions): void;
}

interface BetterZaloApi {
  registerPlugin(plugin: BetterZaloPlugin<DontTrackMeOptions>): boolean;
}

interface Window {
  BetterZalo?: BetterZaloApi;
}

// ON means the corresponding Zalo tracking/telemetry component is disabled.
type TelemetryKey = 'sentry' | 'googleAnalytics' | 'qos' | 'actionLog' | 'userlog';
type DontTrackMeOptions = Record<TelemetryKey, boolean>;

(() => {
  'use strict';

  const ID = 'dont-track-me';

  const OPTIONS_SCHEMA: Array<{ key: TelemetryKey; label: string; description: string }> = [
    { key: 'sentry', label: 'Crash reporting', description: 'Blocks crash reports sent to sentrypc.api.zalo.me.' },
    { key: 'googleAnalytics', label: 'Usage analytics', description: 'Blocks Google Analytics event collection.' },
    { key: 'qos', label: 'Performance telemetry', description: 'Blocks quality-of-service uploads to qos.talk.zing.vn.' },
    { key: 'actionLog', label: 'Action logging', description: 'Blocks batched interface action log uploads.' },
    { key: 'userlog', label: 'User event logging', description: 'Blocks user event log uploads.' },
  ];

  const BLOCKS: Record<TelemetryKey, string[]> = {
    sentry: ['sentrypc.api.zalo.me'],
    googleAnalytics: ['google-analytics.com', 'googletagmanager.com'],
    qos: ['qos.talk.zing.vn', '/api/qos/'],
    actionLog: ['/actionlog'],
    userlog: ['/userlog'],
  };

  const defaultOptions = (): DontTrackMeOptions => {
    const out = {} as DontTrackMeOptions;
    for (const opt of OPTIONS_SCHEMA) out[opt.key] = true;
    return out;
  };

  let installed = false;
  let activePatterns: string[] = [];
  const orig: {
    fetch?: typeof window.fetch;
    open?: typeof XMLHttpRequest.prototype.open;
    send?: typeof XMLHttpRequest.prototype.send;
    beacon?: typeof navigator.sendBeacon | null;
  } = {};
  const xhrUrls = new WeakMap<XMLHttpRequest, unknown>();

  function collectPatterns(options: DontTrackMeOptions): string[] {
    const out: string[] = [];
    for (const key of Object.keys(BLOCKS) as TelemetryKey[]) {
      if (options && options[key]) out.push(...BLOCKS[key]);
    }
    return out;
  }

  function urlOf(input: unknown): string {
    if (typeof input === 'string') return input;
    if (input && typeof (input as { url?: unknown }).url === 'string') {
      return (input as { url: string }).url;
    }
    return '';
  }

  function isBlocked(url: unknown): boolean {
    if (typeof url !== 'string') return false;
    for (const p of activePatterns) {
      if (url.indexOf(p) !== -1) return true;
    }
    return false;
  }

  function install(options: DontTrackMeOptions): void {
    activePatterns = collectPatterns(options);
    if (installed || activePatterns.length === 0) return;
    installed = true;
    orig.fetch = window.fetch;
    orig.open = XMLHttpRequest.prototype.open;
    orig.send = XMLHttpRequest.prototype.send;
    orig.beacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;

    const savedFetch = orig.fetch;
    window.fetch = function patchedFetch(...args: Parameters<typeof fetch>): Promise<Response> {
      if (isBlocked(urlOf(args[0]))) return Promise.reject(new Error('[BetterZalo] blocked telemetry request'));
      return savedFetch.apply(window, args);
    };

    const savedOpen = orig.open;
    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      xhrUrls.set(this, url);
      (savedOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    };
    const savedSend = orig.send;
    XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]): void {
      if (isBlocked(xhrUrls.get(this))) {
        this.abort();
        return undefined;
      }
      (savedSend as (...a: unknown[]) => void).apply(this, args);
    };

    if (orig.beacon) {
      const savedBeacon = orig.beacon;
      navigator.sendBeacon = function patchedBeacon(url: string | URL, ...args: unknown[]): boolean {
        if (isBlocked(String(url))) return false;
        return (savedBeacon as (...a: unknown[]) => boolean).apply(navigator, [url, ...args]);
      };
    }
  }

  function uninstall(): void {
    if (!installed) return;
    installed = false;
    activePatterns = [];
    if (orig.fetch) window.fetch = orig.fetch;
    if (orig.open) XMLHttpRequest.prototype.open = orig.open;
    if (orig.send) XMLHttpRequest.prototype.send = orig.send;
    if (orig.beacon) navigator.sendBeacon = orig.beacon;
  }

  function refresh(options: DontTrackMeOptions): void {
    uninstall();
    install(options);
  }

  function definition(): BetterZaloPlugin<DontTrackMeOptions> {
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

  function tryRegister(): boolean {
    if (!window.BetterZalo || typeof window.BetterZalo.registerPlugin !== 'function') return false;
    return window.BetterZalo.registerPlugin(definition());
  }

  if (!tryRegister()) {
    window.addEventListener('betterzalo:ready', tryRegister, { once: true });
  }
})();
