/**
 * Upload consent management.
 *
 * Displays a modal dialog on first upload explaining data handling,
 * and persists consent only in the current workspace state.
 */

import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { DEFAULT_ENABLED_SERVICE_NAMES, SUPPORTED_UPLOAD_SERVICE_NAMES } from './services';

const CONSENT_VERSION = '2026-07-13-2';
const CONSENT_KEY_PREFIX = 'note-md.uploadConsentAccepted';
const KNOWN_SERVICES = new Set(SUPPORTED_UPLOAD_SERVICE_NAMES);
const pendingConsent = new Map<string, Promise<boolean>>();
let consentGeneration = 0;

function configuredServiceNames(resource?: vscode.Uri): string[] {
  const config = vscode.workspace.getConfiguration('note-md', resource);
  const services = config.get<string[]>('enabledUploadServices', DEFAULT_ENABLED_SERVICE_NAMES);
  return [...new Set(services ?? [])].sort();
}

function configuredServices(resource?: vscode.Uri): string {
  return configuredServiceNames(resource).join(', ') || 'なし';
}

function workspaceScope(resource?: vscode.Uri): string {
  const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
  const identity = folder?.uri.toString() ?? 'workspace';
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

function consentKey(resource?: vscode.Uri): string {
  const services = configuredServiceNames(resource).join('|') || 'none';
  return `${CONSENT_KEY_PREFIX}.${CONSENT_VERSION}.${workspaceScope(resource)}.${services}`;
}

export async function ensureUploadConsent(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri,
  options: { interactive?: boolean } = {},
): Promise<boolean> {
  const interactive = options.interactive ?? true;
  if (vscode.workspace.isTrusted === false) {
    if (interactive) {
      vscode.window.showWarningMessage('note-md: 制限モードでは外部サービスへ画像を送信できません');
    }
    return false;
  }

  if (!resource || !vscode.workspace.getWorkspaceFolder(resource)) {
    if (interactive) {
      vscode.window.showWarningMessage(
        'note-md: ワークスペース外のファイルからは外部サービスへ画像を送信できません',
      );
    }
    return false;
  }

  const serviceNames = configuredServiceNames(resource);
  if (serviceNames.length === 0) {
    if (interactive) {
      vscode.window.showInformationMessage(
        'note-md: 画像アップロードは無効です。利用する場合は設定で送信先を明示してください',
      );
    }
    return false;
  }
  const unknown = serviceNames.filter((name) => !KNOWN_SERVICES.has(name));
  if (unknown.length > 0) {
    if (interactive) {
      vscode.window.showWarningMessage(
        `note-md: 未対応の画像送信先が設定されています: ${unknown.join(', ')}`,
      );
    }
    return false;
  }

  const key = consentKey(resource);
  if (context.workspaceState.get<boolean>(key)) return true;
  if (!interactive) return false;

  const existing = pendingConsent.get(key);
  if (existing) return existing;

  const generation = consentGeneration;
  const prompt = requestConsent(context, resource, key, generation);
  pendingConsent.set(key, prompt);
  try {
    return await prompt;
  } finally {
    if (pendingConsent.get(key) === prompt) pendingConsent.delete(key);
  }
}

async function requestConsent(
  context: vscode.ExtensionContext,
  resource: vscode.Uri | undefined,
  key: string,
  generation: number,
): Promise<boolean> {
  const serviceList = configuredServices(resource);

  const detail = [
    '画像処理では外部の一時ファイルホスティングサービスを使います。',
    '',
    '●  送信するのは記事内で参照しているローカル画像を正規化したデータだけです',
    `●  送信候補: ${serviceList}`,
    '●  元のファイル名は送信せず、画像形式によっては安全に正規化できず処理を拒否します',
    '●  アップロード後に配信 URL の送信先、CORS、Content-Type を確認します',
    '●  公開 URL が発行され、URL を知っている人は保存期間中アクセスできます',
    '●  サービス側で IP アドレス、ファイル名、時刻などが記録される場合があります',
    '●  Catbox 利用規約: https://catbox.moe/legal.php',
    '●  組織利用や収益を伴う利用には、Catbox 経営者の書面による明示的な事前許可が必要です',
    '●  規約、商用条件、保存期間を確認し、必要な許可を得てから続行してください',
    '',
    '詳しくは README の「データの取り扱い」をご確認ください。',
  ].join('\n');

  const choice = await vscode.window.showWarningMessage(
    'note 画像アップロードに関する確認',
    { modal: true, detail },
    '商用条件を含む規約を確認済み',
  );

  if (choice === '商用条件を含む規約を確認済み') {
    if (generation !== consentGeneration || key !== consentKey(resource)) {
      vscode.window.showWarningMessage(
        'note-md: 確認中に画像送信設定が変更されました。もう一度実行してください',
      );
      return false;
    }
    await context.workspaceState.update(key, true);
    return true;
  }
  return false;
}

/** Revoke every upload consent recorded for the current workspace. */
export async function revokeUploadConsent(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri,
): Promise<void> {
  consentGeneration++;
  if (!resource || !vscode.workspace.getWorkspaceFolder(resource)) {
    vscode.window.showInformationMessage(
      'note-md: 同意を撤回するワークスペース内の Markdown を開いてください',
    );
    return;
  }
  const scope = workspaceScope(resource);
  const keys = context.workspaceState
    .keys()
    .filter((key) => key.startsWith(`${CONSENT_KEY_PREFIX}.${CONSENT_VERSION}.${scope}.`));
  await Promise.all(keys.map((key) => context.workspaceState.update(key, undefined)));
  vscode.window.showInformationMessage(
    'note-md: このワークスペースの画像送信同意を撤回しました。既に公開された外部 URL の画像は削除されません',
  );
}
