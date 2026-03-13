/**
 * Upload consent management.
 *
 * Displays a modal dialog on first upload explaining data handling,
 * and persists the user's consent in globalState.
 */

import * as vscode from 'vscode';
import { DEFAULT_ENABLED_SERVICE_NAMES } from './services';

const CONSENT_KEY = 'note-md.uploadConsentAccepted';

function configuredServices(): string {
  const config = vscode.workspace.getConfiguration('note-md');
  const services = config.get<string[]>('enabledUploadServices', DEFAULT_ENABLED_SERVICE_NAMES);
  return (services ?? []).join(', ') || 'なし';
}

export async function ensureUploadConsent(context: vscode.ExtensionContext): Promise<boolean> {
  if (context.globalState.get<boolean>(CONSENT_KEY)) return true;

  const serviceList = configuredServices();

  const detail = [
    '画像処理では外部の一時ファイルホスティングサービスを使います。',
    '',
    '●  送信するのは記事内で参照しているローカル画像ファイルだけです',
    `●  送信候補: ${serviceList}`,
    '●  公開 URL が発行され、URL を知っている人は保存期間中アクセスできます',
    '●  サービス側で IP アドレス、ファイル名、時刻などが記録される場合があります',
    '●  利用規約や保存期間の確認は利用者側で行ってください',
    '',
    '詳しくは README の「データの取り扱い」をご確認ください。',
  ].join('\n');

  const choice = await vscode.window.showWarningMessage(
    'note 画像アップロードに関する確認',
    { modal: true, detail },
    '同意して続行',
  );

  if (choice === '同意して続行') {
    await context.globalState.update(CONSENT_KEY, true);
    return true;
  }
  return false;
}
