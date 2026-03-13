/**
 * Upload service abstraction layer with health-check and ordered fallback.
 *
 * Only services whose file-serving domain returns
 * `access-control-allow-origin: *` are usable — note.com's editor fetches
 * pasted image URLs from the browser (cross-origin), so CORS is required.
 *
 * Priority order (tested 2026-03):
 *
 *  1. litterbox.catbox.moe  — Fastest (0.63s), Catbox LLC (US). Stable.
 *                             CORS: *. 1h–72h retention (selectable).
 *                             Catbox terms include a commercial-use approval clause.
 *  2. imgbb.com (ibb.co)   — CORS: *. 32 MB limit. Expiration parameter
 *                             supported (seconds). Served from i.ibb.co.
 *                             Uses the non-public /json endpoint (no API key).
 *
 * Excluded (no CORS on served files — note.com cannot fetch):
 *  - x0.at, uguu.se, catbox.moe, tmpfiles.org — all return no
 *    access-control-allow-origin header on file downloads.
 *  - 0x0.st: Prohibits automated uploads.
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

const HC_TIMEOUT = 5000;
export const DEFAULT_ENABLED_SERVICE_NAMES = ['litterbox.catbox.moe', 'imgbb.com'];

export interface UploadService {
  readonly name: string;
  /** Estimated expiry (ms) for a file of the given size. null = permanent. */
  expiryMs(fileSize: number, expiry?: string): number | null;
  /** Lightweight connectivity check. */
  healthCheck(): Promise<boolean>;
  /** Upload a buffer and return the public URL. */
  upload(data: Buffer, fileName: string, expiry?: string): Promise<string>;
}

export interface UploadOutcome {
  url: string;
  serviceName: string;
  /** Epoch ms when the URL is expected to expire. null = permanent. */
  expiresAt: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(HC_TIMEOUT),
    });
    // 405 = Method Not Allowed — server is alive but doesn't accept HEAD
    return r.ok || r.status === 405;
  } catch {
    return false;
  }
}

function assertHttps(name: string, body: string, allowedDomains?: string[]): string {
  const url = body.trim();
  if (!url.startsWith('https://')) {
    throw new Error(`${name}: 想定外の応答です: ${url.slice(0, 120)}`);
  }
  if (allowedDomains) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw new Error(`${name}: URL が不正です: ${url.slice(0, 120)}`);
    }
    if (!allowedDomains.some((d) => hostname === d || hostname.endsWith('.' + d))) {
      throw new Error(`${name}: 応答ドメインが想定外です: ${hostname}`);
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// 1. litterbox.catbox.moe — temporary (1h–72h), CORS: *
// ---------------------------------------------------------------------------

const LITTERBOX_EXPIRY_MS: Record<string, number> = {
  '1h': 3_600_000,
  '12h': 43_200_000,
  '24h': 86_400_000,
  '72h': 259_200_000,
};

class Litterbox implements UploadService {
  readonly name = 'litterbox.catbox.moe';

  expiryMs(_fileSize: number, expiry = '72h'): number {
    return LITTERBOX_EXPIRY_MS[expiry] ?? 259_200_000;
  }

  healthCheck(): Promise<boolean> {
    return headOk('https://litterbox.catbox.moe/');
  }

  async upload(data: Buffer, fileName: string, expiry = '72h'): Promise<string> {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', expiry);
    form.append('fileToUpload', new Blob([data]), fileName);

    const r = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: form,
    });
    if (!r.ok) throw new Error(`${this.name}: HTTP ${r.status} で失敗しました`);
    return assertHttps(this.name, await r.text(), ['catbox.moe']);
  }
}

// ---------------------------------------------------------------------------
// 2. imgbb.com (ibb.co) — CORS: *, 32 MB, expiration supported
//    Uses the non-public /json endpoint (no API key required).
//    Served from i.ibb.co.
// ---------------------------------------------------------------------------

/** Map uploadExpiry config values to seconds for ImgBB. */
const IMGBB_EXPIRY_SEC: Record<string, number> = {
  '1h': 3600,
  '12h': 43200,
  '24h': 86400,
  '72h': 259200,
};

class ImgBB implements UploadService {
  readonly name = 'imgbb.com';

  expiryMs(_fileSize: number, expiry = '72h'): number {
    return (IMGBB_EXPIRY_SEC[expiry] ?? 259200) * 1000;
  }

  healthCheck(): Promise<boolean> {
    return headOk('https://imgbb.com/');
  }

  async upload(data: Buffer, fileName: string, expiry = '72h'): Promise<string> {
    const form = new FormData();
    form.append('source', new Blob([data]), fileName);
    form.append('type', 'file');
    form.append('action', 'upload');
    const sec = IMGBB_EXPIRY_SEC[expiry] ?? 259200;
    form.append('expiration', String(sec));

    const r = await fetch('https://imgbb.com/json', {
      method: 'POST',
      body: form,
    });
    if (!r.ok) throw new Error(`${this.name}: HTTP ${r.status} で失敗しました`);

    const json = (await r.json()) as {
      status_code?: number;
      image?: { image?: { url?: string }; url?: string };
    };
    if (json?.status_code !== 200) {
      throw new Error(
        `${this.name}: status_code ${json?.status_code ?? 'なし'}: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }
    const url = json?.image?.image?.url ?? json?.image?.url;
    if (!url) {
      throw new Error(
        `${this.name}: 応答に画像URLがありません: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }
    return assertHttps(this.name, url, ['ibb.co']);
  }
}

// ---------------------------------------------------------------------------
// ServiceManager — health check + ordered fallback
// ---------------------------------------------------------------------------

export class ServiceManager {
  private readonly services: UploadService[];
  private healthy: UploadService[] = [];
  private initPromise: Promise<void> | undefined;
  private initializedConfigKey = '';

  constructor() {
    this.services = [
      new Litterbox(), // 1. CORS: *, fastest (0.63s), temporary hosting
      new ImgBB(), // 2. CORS: *, 32 MB, fallback
    ];
  }

  private configuredServices(): UploadService[] {
    const config = vscode.workspace.getConfiguration('note-md');
    const configured = config.get<string[]>('enabledUploadServices', DEFAULT_ENABLED_SERVICE_NAMES);
    const names = new Set((configured ?? []).filter(Boolean));
    return this.services.filter((svc) => names.has(svc.name));
  }

  private configKey(): string {
    return this.configuredServices()
      .map((svc) => svc.name)
      .join('|');
  }

  /**
   * Run health checks on all services in parallel.
   * Should be called once at extension activation; will also be called
   * lazily on first upload if not yet initialized.
   * Safe to call concurrently — the Promise is cached.
   */
  initialize(): Promise<void> {
    const configKey = this.configKey();
    if (!this.initPromise || this.initializedConfigKey !== configKey) {
      this.initializedConfigKey = configKey;
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    // Warn about unrecognized service names in settings
    const config = vscode.workspace.getConfiguration('note-md');
    const settingNames =
      config.get<string[]>('enabledUploadServices', DEFAULT_ENABLED_SERVICE_NAMES) ?? [];
    const knownNames = new Set(this.services.map((s) => s.name));
    const unknown = settingNames.filter((n) => n && !knownNames.has(n));
    if (unknown.length > 0) {
      vscode.window.showWarningMessage(
        `note-md: 不明なアップロードサービス名が設定されています: ${unknown.join(', ')}。` +
          ` 有効な値: ${[...knownNames].join(', ')}`,
      );
    }

    const configured = this.configuredServices();
    if (configured.length === 0) {
      this.healthy = [];
      return;
    }

    const results = await Promise.allSettled(
      configured.map(async (s) => ({ s, ok: await s.healthCheck() })),
    );

    this.healthy = results
      .filter(
        (r): r is PromiseFulfilledResult<{ s: UploadService; ok: boolean }> =>
          r.status === 'fulfilled' && r.value.ok,
      )
      .map((r) => r.value.s);

    if (this.healthy.length === 0) {
      vscode.window.showWarningMessage('note 用に有効化されたアップロードサービスへ接続できません');
    } else {
      const down = configured.filter((s) => !this.healthy.includes(s));
      if (down.length > 0) {
        vscode.window.showInformationMessage(
          `note で利用可能 [${this.healthy.map((s) => s.name).join(', ')}]` +
            ` / 応答なし [${down.map((s) => s.name).join(', ')}]`,
        );
      }
    }
  }

  /**
   * Upload a buffer, trying healthy services in priority order.
   * Falls back to all services if none are marked healthy.
   */
  async upload(data: Buffer, fileName: string, expiry = '72h'): Promise<UploadOutcome> {
    await this.initialize();

    // Prefer healthy services; fall back to trying all if list is empty
    const configured = this.configuredServices();
    const candidates = this.healthy.length > 0 ? [...this.healthy] : [...configured];
    const errors: string[] = [];

    if (candidates.length === 0) {
      throw new Error('有効なアップロードサービスが設定されていません');
    }

    for (const svc of candidates) {
      try {
        const url = await svc.upload(data, fileName, expiry);
        const ms = svc.expiryMs(data.length, expiry);
        return {
          url,
          serviceName: svc.name,
          expiresAt: ms !== null ? Date.now() + ms : null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        // Remove from healthy — it just failed
        this.healthy = this.healthy.filter((s) => s !== svc);
      }
    }

    throw new Error(`全サービス失敗:\n${errors.join('\n')}`);
  }

  /** Names of currently healthy services. */
  get healthyNames(): string[] {
    return this.healthy.map((s) => s.name);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _mgr: ServiceManager | undefined;

export function getServiceManager(): ServiceManager {
  if (!_mgr) _mgr = new ServiceManager();
  return _mgr;
}

/** Reset the singleton — call from extension deactivate(). */
export function resetServiceManager(): void {
  _mgr = undefined;
}
