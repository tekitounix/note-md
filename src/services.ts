/**
 * Upload service abstraction layer with health-check and ordered fallback.
 *
 * Only services whose file-serving domain returns
 * `access-control-allow-origin: *` are usable — note.com's editor fetches
 * pasted image URLs from the browser (cross-origin), so CORS is required.
 *
 * Supported service:
 *
 *  - litterbox.catbox.moe — CORS: *. 1h–72h retention (selectable).
 *                           Disabled by default. Catbox terms include a
 *                           commercial-use approval clause.
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
const UPLOAD_TIMEOUT = 30000;
const VERIFY_TIMEOUT = 10000;
const MAX_RESPONSE_BYTES = 16 * 1024;
export const DEFAULT_ENABLED_SERVICE_NAMES: string[] = [];
export const SUPPORTED_UPLOAD_SERVICE_NAMES = Object.freeze(['litterbox.catbox.moe']);

export interface UploadService {
  readonly name: string;
  /** Estimated expiry (ms) for a file of the given size. null = permanent. */
  expiryMs(fileSize: number, expiry?: string): number | null;
  /** Lightweight connectivity check. */
  healthCheck(signal?: AbortSignal): Promise<boolean>;
  /** Upload a buffer and return the public URL. */
  upload(data: Buffer, fileName: string, expiry?: string, signal?: AbortSignal): Promise<string>;
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

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (signal.aborted) return signal;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  timeout.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

async function headOk(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      redirect: 'error',
      signal: timeoutSignal(HC_TIMEOUT, signal),
    });
    // 405 = Method Not Allowed — server is alive but doesn't accept HEAD
    return r.ok || r.status === 405;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = UPLOAD_TIMEOUT,
): Promise<Response> {
  return fetch(input, {
    ...init,
    redirect: 'error',
    signal: timeoutSignal(timeoutMs, init.signal ?? undefined),
  });
}

async function readTextBounded(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel();
    throw new Error(`応答が上限 ${limit} bytes を超えています`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error(`応答が上限 ${limit} bytes を超えています`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function assertHttps(name: string, body: string, allowedDomains?: string[]): string {
  const url = body.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name}: URL が不正です: ${url.slice(0, 120)}`);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(`${name}: 想定外の HTTPS URL です: ${url.slice(0, 120)}`);
  }
  if (allowedDomains) {
    const hostname = parsed.hostname;
    if (!allowedDomains.some((domain) => hostname === domain)) {
      throw new Error(`${name}: 応答ドメインが想定外です: ${hostname}`);
    }
  }
  return url;
}

async function verifyServedImage(
  name: string,
  url: string,
  allowedDomains: string[],
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Origin: 'https://note.com', Range: 'bytes=0-0' },
    redirect: 'error',
    signal: timeoutSignal(VERIFY_TIMEOUT, signal),
  });
  const finalUrl = response.url || url;
  const acceptedUrl = assertHttps(name, finalUrl, allowedDomains);
  if (acceptedUrl !== url) {
    await response.body?.cancel();
    throw new Error(`${name}: 配信 URL がリダイレクトされました`);
  }
  const verificationError = servedImageVerificationError(name, response);
  await response.body?.cancel();
  if (verificationError) throw verificationError;
}

function servedImageVerificationError(name: string, response: Response): Error | null {
  if (!response.ok && response.status !== 206) {
    return new Error(`${name}: 配信 URL の検証に失敗しました: HTTP ${response.status}`);
  }

  const cors = response.headers.get('access-control-allow-origin') ?? '';
  if (cors.trim() !== '*' && cors.trim() !== 'https://note.com') {
    return new Error(`${name}: 配信 URL が note.com から取得できる CORS を返しません`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return new Error(`${name}: 配信 URL の Content-Type が画像ではありません: ${contentType}`);
  }

  return null;
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

  healthCheck(signal?: AbortSignal): Promise<boolean> {
    return headOk('https://litterbox.catbox.moe/', signal);
  }

  async upload(
    data: Buffer,
    fileName: string,
    expiry = '72h',
    signal?: AbortSignal,
  ): Promise<string> {
    if (!(expiry in LITTERBOX_EXPIRY_MS)) {
      throw new Error(`${this.name}: 保存期間が不正です: ${expiry}`);
    }
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', expiry);
    form.append('fileToUpload', new Blob([new Uint8Array(data)]), fileName);

    const r = await fetchWithTimeout('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: form,
      signal,
    });
    if (!r.ok) throw new Error(`${this.name}: HTTP ${r.status} で失敗しました`);
    return assertHttps(this.name, await readTextBounded(r), ['litter.catbox.moe']);
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
    this.services = [new Litterbox()];
  }

  private configuredServices(resource?: vscode.Uri): UploadService[] {
    const names = configuredServiceNameSet(
      this.services.map((svc) => svc.name),
      resource,
    );
    return this.services.filter((svc) => names.has(svc.name));
  }

  private configKey(resource?: vscode.Uri): string {
    return [...configuredServiceNameSet(undefined, resource)].sort().join('|');
  }

  /**
   * Run health checks on all services in parallel.
   * Should be called once at extension activation; will also be called
   * lazily on first upload if not yet initialized.
   * Safe to call concurrently — the Promise is cached.
   */
  initialize(resource?: vscode.Uri): Promise<void> {
    const configKey = this.configKey(resource);
    if (!this.initPromise || this.initializedConfigKey !== configKey) {
      const configured = this.configuredServices(resource);
      this.initializedConfigKey = configKey;
      this.initPromise = this.doInitialize(configured, configKey, resource);
    }
    const pending = this.initPromise;
    return pending.then(() => {
      if (pending !== this.initPromise || this.initializedConfigKey !== this.configKey(resource)) {
        return this.initialize(resource);
      }
    });
  }

  private async doInitialize(
    configured: UploadService[],
    configKey: string,
    resource?: vscode.Uri,
  ): Promise<void> {
    // Warn about unrecognized service names in settings
    const config = vscode.workspace.getConfiguration('note-md', resource);
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

    if (configured.length === 0) {
      if (this.configKey(resource) === configKey) this.healthy = [];
      return;
    }

    const results = await Promise.allSettled(
      configured.map(async (s) => ({ s, ok: await s.healthCheck() })),
    );

    const healthy = results
      .filter(
        (r): r is PromiseFulfilledResult<{ s: UploadService; ok: boolean }> =>
          r.status === 'fulfilled' && r.value.ok,
      )
      .map((r) => r.value.s);

    // A settings change may have started a newer initialization while these
    // health checks were pending. Never let the stale result overwrite it.
    if (this.configKey(resource) !== configKey) return;
    this.healthy = healthy;

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
  async upload(
    data: Buffer,
    fileName: string,
    expiry = '72h',
    signal?: AbortSignal,
    resource?: vscode.Uri,
  ): Promise<UploadOutcome> {
    signal?.throwIfAborted();
    if (!signal) await this.initialize(resource);
    signal?.throwIfAborted();

    // Prefer healthy services; fall back to trying all if list is empty
    const configured = this.configuredServices(resource);
    const configuredSet = new Set(configured);
    const currentlyHealthy = this.healthy.filter((service) => configuredSet.has(service));
    const candidates = currentlyHealthy.length > 0 ? currentlyHealthy : [...configured];
    const errors: string[] = [];

    if (candidates.length === 0) {
      throw new Error('有効なアップロードサービスが設定されていません');
    }

    for (const svc of candidates) {
      try {
        const url = await svc.upload(data, fileName, expiry, signal);
        await verifyServedImage(svc.name, url, ['litter.catbox.moe'], signal);
        const ms = svc.expiryMs(data.length, expiry);
        return {
          url,
          serviceName: svc.name,
          expiresAt: ms !== null ? Date.now() + ms : null,
        };
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        // Remove from healthy — it just failed
        this.healthy = this.healthy.filter((s) => s !== svc);
      }
    }

    throw new Error(`全サービス失敗:\n${errors.join('\n')}`);
  }

  /** Names of currently healthy services. */
  healthyNames(resource?: vscode.Uri): string[] {
    const configured = new Set(this.configuredServices(resource));
    return this.healthy.filter((service) => configured.has(service)).map((s) => s.name);
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

function configuredServiceNameSet(knownNames?: string[], resource?: vscode.Uri): Set<string> {
  const config = vscode.workspace.getConfiguration('note-md', resource);
  const configured = config.get<string[]>('enabledUploadServices', DEFAULT_ENABLED_SERVICE_NAMES);
  const known = knownNames ? new Set(knownNames) : undefined;
  return new Set((configured ?? []).filter((name) => Boolean(name) && (!known || known.has(name))));
}

export function getEnabledUploadServiceNames(resource?: vscode.Uri): Set<string> {
  return configuredServiceNameSet(undefined, resource);
}
