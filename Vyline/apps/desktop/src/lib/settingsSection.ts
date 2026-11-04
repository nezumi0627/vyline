/**
 * lib/settingsSection.ts
 *
 * 設定画面を特定の項目で開くための受け渡し。SettingsSections は遅延読み込みなので、
 * 呼び出し側から直接 import せず、ここに置いた値を設定画面の初期化時に受け取る。
 */

let pendingSection: string | null = null;

/** 次に設定画面を開くときの項目を指定する（例: "profile"） */
export function requestSettingsSection(section: string): void {
  pendingSection = section;
}

/** 指定された項目を一度だけ受け取る */
export function takeSettingsSection(): string | null {
  const section = pendingSection;
  pendingSection = null;
  return section;
}
