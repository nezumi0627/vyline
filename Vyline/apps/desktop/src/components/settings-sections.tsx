import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { startSerialPoll } from "@/lib/serialPoll";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import type { AnimationMode } from "@/lib/store-types";
import { checkForUpdates, type UpdateInfo } from "@/lib/updater";
import { cn } from "@/lib/utils";
import { BetaSection } from "@/components/beta-consent";
import { AgentIBetaPanel } from "@/components/agent-i-beta-panel";
import { AccountSwitcher } from "@/components/sidebar";
import { IosBackupBetaPanel } from "@/components/ios-backup-beta-panel";
import { AndroidBackupPanel } from "@/components/android-backup-panel";
import { AccountBackupStorage } from "@/components/account-backup-storage";
import { emitAppEvent, onAppEvent } from "@/lib/appEvents";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";
import { QRCodeSVG } from "qrcode.react";
import type { AccountSettings, SavedSession } from "@vyline/types";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 10_000) return "数秒前";
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  if (diff < 31 * 86_400_000) return `${Math.floor(diff / 86_400_000)}日前`;
  if (diff < 365 * 86_400_000) return `${Math.floor(diff / (31 * 86_400_000))}か月前`;
  return `${Math.floor(diff / (365 * 86_400_000))}年前`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)}%`;
}

import { Toggle, Avatar } from "@/components/vy-ui";
import { PremiumBadge } from "@/components/premium-badge";
import { VyThemePanel } from "@/components/vy-theme-panel";
import {
  IconArrowLeft,
  IconEye,
  IconPalette,
  IconShield,
  IconSettings,
  IconEdit,
  IconChevron,
  IconSpark,
  IconBell,
  IconHardDrive,
  IconTrash,
  IconDownload,
} from "@/components/icons";

type Section =
  | "profile"
  | "read"
  | "display"
  | "theme"
  | "privacy"
  | "session"
  | "notifications"
  | "advanced"
  | "subdevices"
  | "storage"
  | "plugins"
  | "info"
  | "beta"
  | "handoff";

const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: "profile", label: "プロフィール", icon: <IconEdit size={18} /> },
  { key: "read", label: "既読", icon: <IconEye size={18} /> },
  { key: "display", label: "表示", icon: <IconSettings size={18} /> },
  { key: "theme", label: "NezuTheme", icon: <IconPalette size={18} /> },
  { key: "notifications", label: "通知", icon: <IconBell size={18} /> },
  { key: "privacy", label: "プライバシー", icon: <IconShield size={18} /> },
  { key: "session", label: "ログイン・セッション", icon: <IconShield size={18} /> },
  { key: "advanced", label: "詳細・復元", icon: <IconChevron size={18} /> },
  { key: "subdevices", label: "サブデバイス", icon: <IconSettings size={18} /> },
  { key: "storage", label: "ストレージ", icon: <IconHardDrive size={18} /> },
  { key: "plugins", label: "プラグイン", icon: <IconSpark size={18} /> },
  { key: "beta", label: "ベータ機能", icon: <IconSpark size={18} /> },
  { key: "handoff", label: "引継ぎ・診断", icon: <IconDownload size={18} /> },
  { key: "info", label: "情報", icon: <IconSpark size={18} /> },
];

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-[var(--vy-text-dim)]">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 divide-y divide-[var(--vy-border)]">
      {children}
    </div>
  );
}

export function SettingsSections() {
  const desktopInteraction = isDesktopInteraction();
  const setScreen = useStore((s) => s.setScreen);
  const settings = useStore((s) => s.settings);
  const animationMode = settings.animationMode ?? "vyline";
  const updateSetting = useStore((s) => s.updateSetting);
  const self = useStore((s) => s.self);
  const updateSelf = useStore((s) => s.updateSelf);
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const [section, setSection] = useState<Section>("read");
  const [nameDraft, setNameDraft] = useState(self.name);
  const [statusDraft, setStatusDraft] = useState(self.status);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const saveLineProfile = async () => {
    if (demoMode) {
      updateSelf({
        name: nameDraft.trim() || "デモユーザー",
        status: statusDraft,
      });
      setProfileMsg("デモプロフィールを更新しました");
      return;
    }
    if (!accountId) {
      setProfileMsg("ログインが必要です");
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const body: {
        displayName?: string;
        statusMessage?: string;
      } = {
        displayName: nameDraft.trim(),
        statusMessage: statusDraft,
      };
      const res = await api.line.updateProfileAttributes(accountId, body);
      if (!res.ok || !res.profile) {
        setProfileMsg(
          res.ok === false ? ((res as { error?: string }).error ?? "更新失敗") : "更新失敗",
        );
        return;
      }
      updateSelf({
        name: res.profile.displayName || nameDraft,
        status: res.profile.statusMessage ?? statusDraft,
        birthday: res.profile.birthday?.display,
        avatarUrl: res.profile.thumbnailUrl || self.avatarUrl,
        mid: res.profile.mid,
        phoneticName: res.profile.phoneticName || self.phoneticName,
        backgroundUrl: res.profile.backgroundUrl || self.backgroundUrl,
        pictureStatus: res.profile.pictureStatus || self.pictureStatus,
        profileId: res.profile.profileId || self.profileId,
        premium: res.profile.premium ?? self.premium,
      });
      setProfileMsg("LINE プロフィールを更新しました");
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileSaving(false);
    }
  };

  const onPickAvatar = async (file: File | null) => {
    if (!file || (!accountId && !demoMode)) return;
    if (demoMode) {
      updateSelf({ avatarUrl: URL.createObjectURL(file) });
      setProfileMsg("デモアイコンを更新しました");
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await api.line.updateProfileImage(accountId!, file, file.type || "image/jpeg");
      if (res.ok && res.profile?.thumbnailUrl) {
        updateSelf({ avatarUrl: `${res.profile.thumbnailUrl}?t=${Date.now()}` });
        setProfileMsg("アイコンを更新しました");
      } else {
        setProfileMsg("アイコン更新に失敗しました");
      }
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileSaving(false);
    }
  };

  const onPickBackground = async (file: File | null) => {
    if (!file || (!accountId && !demoMode)) return;
    if (demoMode) {
      updateSelf({ backgroundUrl: URL.createObjectURL(file) });
      setProfileMsg("デモ背景を更新しました");
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await api.line.updateProfileBackground(
        accountId!,
        file,
        file.type || "image/jpeg",
      );
      if (res.ok) {
        setProfileMsg("背景画像をアップロードしました");
        // カバー URL は直後に取れないことがあるのでタイムスタンプ付きヒント
        updateSelf({
          backgroundUrl: res.backgroundUrl
            ? `${res.backgroundUrl.split("?")[0]}?t=${Date.now()}`
            : self.backgroundUrl
              ? `${self.backgroundUrl.split("?")[0]}?t=${Date.now()}`
              : self.backgroundUrl,
        });
      } else {
        setProfileMsg(res.error ?? "背景更新に失敗しました");
      }
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="vy-viewport-root flex flex-col bg-[var(--vy-bg)]">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3">
        <button
          type="button"
          onClick={() => setScreen("chat")}
          aria-label="チャットに戻る"
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
        >
          <IconArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-semibold">設定</h1>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 overflow-hidden">
        {/* nav */}
        <nav className="vy-scroll hidden w-56 shrink-0 overflow-y-auto border-r border-[var(--vy-border)] p-3 md:block">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setSection(n.key)}
              className={cn(
                "mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
                section === n.key
                  ? "text-[var(--vy-accent-contrast)]"
                  : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
              )}
              style={section === n.key ? { background: "var(--vy-accent)" } : undefined}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
          <div className="mt-3 border-t border-[var(--vy-border)] pt-2">
            <AccountSwitcher context="settings" />
          </div>
        </nav>

        {/* mobile section chips */}
        <div className="flex w-full flex-col overflow-hidden">
          <div className="vy-scroll flex gap-2 overflow-x-auto border-b border-[var(--vy-border)] px-4 py-2 md:hidden">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => setSection(n.key)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  section === n.key
                    ? "text-[var(--vy-accent-contrast)]"
                    : "bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]",
                )}
                style={section === n.key ? { background: "var(--vy-accent)" } : undefined}
              >
                {n.label}
              </button>
            ))}
          </div>
          <div className="border-b border-[var(--vy-border)] px-3 md:hidden">
            <AccountSwitcher context="settings" />
          </div>

          <div className="vy-scroll flex-1 overflow-y-auto px-4 py-6 md:px-8">
            <div key={section} className="vy-section-enter mx-auto max-w-2xl">
              {section === "profile" && (
                <Section title="プロフィール" desc="アイコン・背景・表示名・ステータスを編集">
                  <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)]">
                    <div
                      className="relative h-28 bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]"
                      style={
                        self.backgroundUrl
                          ? {
                              backgroundImage: `url(${self.backgroundUrl})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      <label className="absolute right-3 bottom-3 cursor-pointer rounded-lg bg-black/45 px-2.5 py-1 text-[0.7rem] font-medium text-white backdrop-blur hover:bg-black/60">
                        背景を変更
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={profileSaving}
                          onChange={(e) => void onPickBackground(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                    <div className="-mt-10 flex items-end gap-4 px-4 pb-4">
                      <div className="relative">
                        <Avatar
                          glyph={self.avatar}
                          color="var(--vy-accent)"
                          size={72}
                          imageUrl={self.avatarUrl}
                        />
                        <label className="absolute -right-1 -bottom-1 cursor-pointer rounded-full bg-[var(--vy-accent)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--vy-accent-contrast)] shadow">
                          変更
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={profileSaving}
                            onChange={(e) => void onPickAvatar(e.target.files?.[0] ?? null)}
                          />
                        </label>
                      </div>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-base font-semibold">{self.name}</p>
                          {self.premium?.active && <PremiumBadge size={14} compact />}
                        </div>
                        <p className="text-xs text-[var(--vy-text-dim)]">
                          下の欄で表示名・ステメを編集
                        </p>
                      </div>
                    </div>
                  </div>
                  <Card>
                    <div className="py-3">
                      <label className="text-sm font-medium">表示名</label>
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
                      />
                    </div>
                    <div className="py-3">
                      <label className="text-sm font-medium">ステータスメッセージ</label>
                      <input
                        value={statusDraft}
                        onChange={(e) => setStatusDraft(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
                      />
                    </div>
                  </Card>
                  <button
                    type="button"
                    disabled={profileSaving}
                    onClick={() => void saveLineProfile()}
                    className="mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
                    style={{ background: "var(--vy-accent)" }}
                  >
                    {profileSaving ? "保存中…" : "LINE に保存"}
                  </button>
                  {profileMsg && (
                    <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{profileMsg}</p>
                  )}
                </Section>
              )}

              {section === "read" && (
                <Section title="既読" desc="既読の送信と表示をコントロールします">
                  <Card>
                    <Row title="既読を送る" desc="OFF にすると相手に既読が表示されません">
                      <Toggle
                        checked={settings.readReceipts}
                        onChange={(v) => updateSetting("readReceipts", v)}
                        label="既読を送る"
                      />
                    </Row>
                    <Row
                      title="既読者一覧を表示"
                      desc="グループで、自分のメッセージを読んだ人を折りたたみで表示します"
                    >
                      <Toggle
                        checked={settings.showReaderList}
                        onChange={(v) => updateSetting("showReaderList", v)}
                        label="既読者一覧を表示"
                      />
                    </Row>
                  </Card>
                  <ReadDisabledChatList />
                  <p className="mt-3 px-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                    DM
                    では「既読」の文字のみを表示します（チェックマークは使いません）。グループでは
                    「既読 3」のように人数を表示します。
                  </p>
                </Section>
              )}

              {section === "display" && (
                <Section title="表示" desc="レイアウトの密度や入力挙動を調整します">
                  <Card>
                    <div className="py-3.5">
                      <p className="text-sm font-medium">アニメーション</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                        画面切替やプロフィール表示の動きを調整します。通信量や同期頻度は変わりません。
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {(
                          [
                            ["vyline", "Vyline", "軽量な動きと滑らかな表示"],
                            ["feather", "フェザー", "低スペック端末向け"],
                            ["none", "オフ", "アニメーションを停止"],
                          ] as const
                        ).map(([mode, label, desc]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => updateSetting("animationMode", mode as AnimationMode)}
                            aria-pressed={animationMode === mode}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-left transition-colors",
                              animationMode === mode
                                ? "border-transparent text-[var(--vy-accent-contrast)]"
                                : "border-[var(--vy-border)] bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]",
                            )}
                            style={
                              animationMode === mode
                                ? { background: "var(--vy-accent)" }
                                : undefined
                            }
                          >
                            <span className="block text-xs font-semibold">{label}</span>
                            <span className="mt-1 block text-[0.65rem] leading-relaxed opacity-80">
                              {desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <Row title="コンパクト表示" desc="吹き出しの余白を狭くして情報量を増やします">
                      <Toggle
                        checked={settings.compactDensity}
                        onChange={(v) => updateSetting("compactDensity", v)}
                        label="コンパクト表示"
                      />
                    </Row>
                    <Row
                      title="ステータスメッセージ表示"
                      desc="トークヘッダーに相手のステータスメッセージを表示します"
                    >
                      <Toggle
                        checked={settings.showStatusMessage}
                        onChange={(v) => updateSetting("showStatusMessage", v)}
                        label="ステータスメッセージ表示"
                      />
                    </Row>
                    <Row title="背景表示" desc="トーク背景に相手のプロフィール背景画像を表示します">
                      <Toggle
                        checked={settings.showBackground}
                        onChange={(v) => updateSetting("showBackground", v)}
                        label="背景表示"
                      />
                    </Row>
                    <Row
                      title="吹き出しのしっぽ"
                      desc="メッセージの吹き出しに三角形のしっぽを付けます"
                    >
                      <Toggle
                        checked={settings.bubbleTail}
                        onChange={(v) => updateSetting("bubbleTail", v)}
                        label="吹き出しのしっぽ"
                      />
                    </Row>
                    <div className="py-3.5">
                      <p className="mb-2 text-sm font-medium">トークリストの並び順</p>
                      <div className="flex gap-2">
                        {(["recent", "unread", "custom"] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => updateSetting("chatSort", opt)}
                            className={cn(
                              "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                              settings.chatSort === opt
                                ? "border-transparent text-[var(--vy-accent-contrast)]"
                                : "border-[var(--vy-border)] bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]",
                            )}
                            style={
                              settings.chatSort === opt
                                ? { background: "var(--vy-accent)" }
                                : undefined
                            }
                          >
                            {opt === "recent"
                              ? "最新順"
                              : opt === "unread"
                                ? "未読順"
                                : "カスタム順"}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                        {desktopInteraction
                          ? "カスタム順ではトークをドラッグして並べ替えできます。"
                          : "カスタム順ではトークを長押しし、メニューから順序を変更できます。"}
                      </p>
                    </div>
                    <div className="py-3.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">文字サイズ</p>
                        <span className="text-xs text-[var(--vy-text-dim)]">
                          {Math.round(settings.fontScale * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.85}
                        max={1.25}
                        step={0.05}
                        value={settings.fontScale}
                        onChange={(e) => updateSetting("fontScale", Number(e.target.value))}
                        aria-label="文字サイズ"
                        className="mt-2 w-full accent-[var(--vy-accent)]"
                      />
                    </div>
                  </Card>
                </Section>
              )}

              {section === "theme" && <ThemeSectionWithPreview />}

              {section === "notifications" && <NotificationsSection />}

              {section === "privacy" && <PrivacySection />}

              {section === "session" && <SessionSection />}

              {section === "advanced" && <AdvancedSection />}

              {section === "subdevices" && <SubdevicesSection />}

              {section === "storage" && <StorageSection />}

              {section === "plugins" && <PluginsSection />}

              {section === "info" && <InfoSection />}

              {section === "handoff" && <HandoffSection />}

              {section === "beta" && (
                <>
                  <BetaSection />
                  {settings.betaAgentI && <AgentIBetaPanel />}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PluginsSection() {
  const accountId = useStore((s) => s.accountId);
  const [plugins, setPlugins] = useState<
    Array<{
      id: string;
      name: string;
      version: string;
      description?: string;
      permissions?: string[];
      loadable: boolean;
      enabled: boolean;
      active: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!accountId) {
      setPlugins([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.line.plugins(accountId);
      setPlugins(result.plugins ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "プラグイン一覧を取得できませんでした");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accountId]);

  const toggle = async (plugin: (typeof plugins)[number]) => {
    if (!accountId || busyId) return;
    setBusyId(plugin.id);
    setMessage(null);
    try {
      const result = await api.line.setPluginEnabled(accountId, plugin.id, !plugin.enabled);
      if (!result.ok) throw new Error(result.error ?? "プラグインの切替に失敗しました");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "プラグインの切替に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title="プラグイン" desc="この PC に置いた信頼できるローカルプラグインを管理します">
      <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
        プラグインは Vyline
        の権限でローカルコードを実行します。内容と要求権限を確認したものだけを有効にしてください。
      </p>
      <Card>
        {loading ? (
          <p className="py-4 text-sm text-[var(--vy-text-dim)]">読み込み中…</p>
        ) : plugins.length === 0 ? (
          <p className="py-4 text-sm leading-relaxed text-[var(--vy-text-dim)]">
            プラグインはまだありません。`backend/data/plugins` に `manifest.json`
            を含むフォルダを置くと表示されます。
          </p>
        ) : (
          plugins.map((plugin) => (
            <Row
              key={plugin.id}
              title={`${plugin.name} v${plugin.version}`}
              desc={`${plugin.description ?? plugin.id}${plugin.permissions?.length ? ` · ${plugin.permissions.join(", ")}` : " · 権限なし"}${!plugin.loadable ? " · 実行ファイルがありません" : plugin.enabled && !plugin.active ? " · 起動に失敗しました。バックエンドログを確認してください" : ""}`}
            >
              <Toggle
                checked={plugin.enabled}
                onChange={() => void toggle(plugin)}
                disabled={!accountId || !plugin.loadable || busyId === plugin.id}
                label={`${plugin.name}を有効にする`}
              />
            </Row>
          ))
        )}
      </Card>
      {message && <p className="mt-3 text-xs text-red-300">{message}</p>}
      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="mt-4 rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
      >
        再読み込み
      </button>
    </Section>
  );
}

function HandoffSection() {
  const mid = useStore((s) => s.self.mid);
  const accountId = useStore((s) => s.accountId);
  const updateSelf = useStore((s) => s.updateSelf);
  const [resolvedMid, setResolvedMid] = useState<string | undefined>(mid);
  const [message, setMessage] = useState<string | null>(null);
  const [entries, setEntries] = useState<unknown[]>([]);
  const [debugSettings, setDebugSettings] = useState<AccountSettings["debug"] | null>(null);
  const [issuePreview, setIssuePreview] = useState<{
    title: string;
    report: string;
    occurredAt: string;
    delivery: "github" | "copy";
    issueUrl?: string;
  } | null>(null);
  useEffect(() => {
    if (mid) {
      setResolvedMid(mid);
      return;
    }
    if (!accountId) return;
    let cancelled = false;
    void api.line
      .getProfile(accountId)
      .then((result) => {
        if (cancelled || !result.ok || !result.profile?.mid) return;
        setResolvedMid(result.profile.mid);
        updateSelf({ mid: result.profile.mid });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId, mid, updateSelf]);
  const diagnosticMid = resolvedMid ?? mid;
  useEffect(() => {
    setDebugSettings(null);
    if (!diagnosticMid) return;
    let cancelled = false;
    void api.settings
      .account(diagnosticMid)
      .then((result) => {
        if (!cancelled && result.ok) setDebugSettings(result.settings.debug);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [diagnosticMid]);
  const toggleLogs = async (enabled: boolean) => {
    if (!diagnosticMid || !debugSettings) return;
    try {
      const result = await api.settings.saveAccount(diagnosticMid, {
        debug: { ...debugSettings, enabled },
      });
      if (!result.ok) throw new Error("ログ収集設定を保存できませんでした");
      setDebugSettings(result.settings.debug);
      setMessage(
        enabled
          ? "これからの通信結果を記録します。問題の操作を再実行してください"
          : "ログ収集を停止しました",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログ収集設定を保存できませんでした");
    }
  };
  const download = (name: string, content: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportHandoff = async () => {
    if (!diagnosticMid)
      return setMessage("MIDを取得できていません。同期完了後に再試行してください");
    try {
      const result = await api.handoff.export(diagnosticMid);
      const bytes = Uint8Array.from(atob(result.archiveBase64), (char) => char.charCodeAt(0));
      download(result.filename, bytes, "application/zip");
      setMessage("引継ぎZIPを作成しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "引継ぎZIPの作成に失敗しました");
    }
  };
  const importHandoff = () => {
    if (!diagnosticMid)
      return setMessage("MIDを取得できていません。同期完了後に再試行してください");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!window.confirm("現在の設定をバックアップして、この引継ぎZIPで上書きしますか？")) return;
      const data = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
      try {
        const result = await api.handoff.import(diagnosticMid, data, "overwrite");
        setMessage(
          result.ok ? "引継ぎを適用しました。必要なら再起動してください" : "引継ぎに失敗しました",
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "引継ぎに失敗しました");
      }
    };
    input.click();
  };
  const exportLogs = async () => {
    if (!diagnosticMid)
      return setMessage("MIDを取得できていません。同期完了後に再試行してください");
    try {
      const result = await api.diagnostics.export(diagnosticMid);
      if (!result.ok) throw new Error(result.error ?? "ログ出力に失敗しました");
      download("vyline-diagnostics.json", result.content, "application/json");
      setMessage("サニタイズ済みログを出力しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログ出力に失敗しました");
    }
  };
  const loadLogs = async () => {
    if (!diagnosticMid)
      return setMessage("MIDを取得できていません。同期完了後に再試行してください");
    try {
      const result = await api.diagnostics.list(diagnosticMid);
      if (!result.ok) throw new Error(result.error ?? "ログ一覧の取得に失敗しました");
      setEntries(result.entries);
      setMessage(
        result.entries.length > 0
          ? `${result.entries.length}件のログを読み込みました`
          : debugSettings?.enabled === false
            ? "ログ収集が無効です。有効にしてから問題の操作を再実行してください"
            : "記録されたログはまだありません。問題の操作後にもう一度確認してください",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログ一覧の取得に失敗しました");
    }
  };
  const reportIssue = async () => {
    if (!diagnosticMid)
      return setMessage("MIDを取得できていません。同期完了後に再試行してください");
    try {
      const result = await api.diagnostics.issuePreview(diagnosticMid);
      setIssuePreview(result.preview);
      setMessage("GitHubへ送る前に、下の内容を確認してください");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Issue作成情報の生成に失敗しました");
    }
  };
  return (
    <>
      <Section
        title="引継ぎ"
        desc="設定だけを安全に別のVylineへ移行します。認証情報やトークンは含みません。"
      >
        <Card>
          <Row title="引継ぎZIPを作成" desc="manifestと改ざん検知用ハッシュを含めます">
            <button
              type="button"
              onClick={() => void exportHandoff()}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs"
            >
              エクスポート
            </button>
          </Row>
          <Row title="引継ぎZIPを適用" desc="適用前に既存設定をバックアップします">
            <button
              type="button"
              onClick={importHandoff}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs"
            >
              インポート
            </button>
          </Row>
        </Card>
      </Section>
      <Section title="デバッグログ" desc="共有前にサニタイズされた診断情報だけを出力します">
        <Card>
          <Row
            title="診断ログを収集"
            desc="通信結果と所要時間を記録します。メッセージ本文・認証情報は含みません"
          >
            <Toggle
              checked={debugSettings?.enabled ?? false}
              disabled={!debugSettings}
              onChange={(enabled) => void toggleLogs(enabled)}
              label="診断ログを収集"
            />
          </Row>
          <Row title="ログをエクスポート" desc="GitHub Issue作成画面へ貼り付けられるJSONです">
            <button
              type="button"
              onClick={() => void exportLogs()}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs"
            >
              出力
            </button>
          </Row>
          <Row title="ログ一覧" desc="共有前にサニタイズ済みの内容を確認します">
            <button
              type="button"
              onClick={() => void loadLogs()}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs"
            >
              確認
            </button>
          </Row>
          <Row
            title="GitHubで問題を報告"
            desc="送信内容を先にプレビューしてからIssue作成画面を開きます"
          >
            <button
              type="button"
              onClick={() => void reportIssue()}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs"
            >
              Issue作成
            </button>
          </Row>
          <Row title="ログを削除" desc="保存済みの診断ログを削除します">
            <button
              type="button"
              onClick={() =>
                diagnosticMid &&
                window.confirm("保存済みの診断ログをすべて削除しますか？") &&
                void api.diagnostics
                  .clear(diagnosticMid)
                  .then((result) => {
                    if (!result.ok) throw new Error(result.error ?? "ログ削除に失敗しました");
                    setEntries([]);
                    setMessage("ログを削除しました");
                  })
                  .catch((error) =>
                    setMessage(error instanceof Error ? error.message : "ログ削除に失敗しました"),
                  )
              }
              className="rounded-lg border border-red-400/50 px-3 py-1.5 text-xs text-red-300"
            >
              削除
            </button>
          </Row>
        </Card>
        {entries.length > 0 && (
          <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-[var(--vy-bg)] p-3 text-[0.65rem] text-[var(--vy-text-dim)]">
            {JSON.stringify(entries, null, 2)}
          </pre>
        )}
        {issuePreview && (
          <div className="mt-3 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium">GitHubへ送る内容のプレビュー</p>
              <button
                type="button"
                onClick={() => setIssuePreview(null)}
                className="text-xs text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]"
              >
                閉じる
              </button>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--vy-bg)] p-3 text-[0.65rem] text-[var(--vy-text-dim)]">
              {issuePreview.report}
            </pre>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(issuePreview.report)
                    .then(() => setMessage("Issue本文をコピーしました"))
                    .catch(() => setMessage("コピーに失敗しました"))
                }
                className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs"
              >
                本文をコピー
              </button>
              {issuePreview.issueUrl && (
                <button
                  type="button"
                  onClick={() =>
                    window.open(issuePreview.issueUrl, "_blank", "noopener,noreferrer")
                  }
                  className="rounded-lg bg-[var(--vy-accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  GitHubを開く
                </button>
              )}
            </div>
            {issuePreview.delivery === "copy" && (
              <p className="mt-2 text-[0.65rem] text-[var(--vy-text-dim)]">
                内容が長いためURLには埋め込まず、本文をコピーしてGitHubへ貼り付けます。
              </p>
            )}
          </div>
        )}
      </Section>
      {message && <p className="mt-3 text-xs text-[var(--vy-text-dim)]">{message}</p>}
    </>
  );
}

function SubdevicesSection() {
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<
    Awaited<ReturnType<typeof api.subdevices.list>>["devices"]
  >(() =>
    demoMode
      ? [
          {
            id: "demo-tablet",
            accountId: "demo",
            name: "デモ iPad",
            platform: "ios",
            createdAt: new Date().toISOString(),
            blocked: false,
            lastSeenAt: new Date().toISOString(),
          },
        ]
      : [],
  );
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const res = await api.subdevices.list();
    if (res.ok) setDevices(res.devices ?? []);
  };
  useEffect(() => {
    if (demoMode) return;
    void load();
  }, [demoMode]);

  useEffect(() => {
    if (!pairingUrl || demoMode) return;
    return startSerialPoll(
      async () => {
        const res = await api.subdevices.list();
        if (res.ok) setDevices(res.devices ?? []);
        return true;
      },
      {
        intervalMs: 1500,
        pauseWhenHidden: true,
        onError: () => undefined,
      },
    );
  }, [pairingUrl, demoMode]);

  const startPairing = async () => {
    if (demoMode) {
      setPairingUrl("https://vyline.invalid/demo-pairing");
      setMessage("デモ用QRコードです。実際の端末とは接続しません（2分間有効）");
      return;
    }
    if (!accountId) return setMessage("LINEログインが必要です");
    const res = await api.subdevices.createPairing(accountId, window.location.origin);
    if (!res.ok || !res.token) return setMessage(res.error ?? "QRコードを作成できませんでした");
    if (!res.pairingUrl) {
      setPairingUrl(null);
      setMessage(
        res.lanAccessRequired
          ? "LAN接続が無効です。VYLINE_LAN_ACCESS=true で再起動してからQRを表示してください"
          : "スマホから到達できるURLを作成できませんでした。PCとスマホが同じLANに接続されているか確認してください",
      );
      return;
    }
    setPairingUrl(res.pairingUrl);
    setMessage("スマホの標準カメラでQRコードを読み込んでください（2分間有効）");
  };

  const action = async (id: string, kind: "remove" | "block" | "unblock") => {
    if (kind === "remove" && !window.confirm("この端末を削除しますか？再認証は可能です。")) return;
    if (
      kind === "block" &&
      !window.confirm("この端末をブロックしますか？解除するまで再認証できません。")
    )
      return;
    if (demoMode) {
      setDevices((current) =>
        kind === "remove"
          ? (current ?? []).filter((device) => device.id !== id)
          : (current ?? []).map((device) =>
              device.id === id ? { ...device, blocked: kind === "block" } : device,
            ),
      );
      setMessage(
        kind === "remove"
          ? "デモ端末を削除しました"
          : kind === "block"
            ? "デモ端末をブロックしました"
            : "デモ端末のブロックを解除しました",
      );
      return;
    }
    if (kind === "remove") await api.subdevices.remove(id);
    if (kind === "block") await api.subdevices.block(id);
    if (kind === "unblock") await api.subdevices.unblock(id);
    await load();
  };

  return (
    <Section title="サブデバイス" desc="PCで認証したスマホ・タブレットからVylineを利用します">
      <div className="space-y-4">
        <Card>
          <Row title="新しい端末を接続" desc="QRコードは一度だけ利用でき、2分で期限切れになります">
            <button
              type="button"
              onClick={() => void startPairing()}
              className="rounded-lg bg-[var(--vy-accent)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              QRを表示
            </button>
          </Row>
        </Card>
        {pairingUrl && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-white p-5 text-center">
            <QRCodeSVG value={pairingUrl} size={220} includeMargin />
            <p className="max-w-sm text-xs text-slate-600">{message}</p>
            <button
              type="button"
              onClick={() => setPairingUrl(null)}
              className="text-xs text-slate-500 underline"
            >
              閉じる
            </button>
          </div>
        )}
        {message && !pairingUrl && <p className="text-xs text-[var(--vy-text-dim)]">{message}</p>}
        <Card>
          {(devices ?? []).length === 0 && (
            <p className="py-4 text-sm text-[var(--vy-text-dim)]">
              接続中のサブデバイスはありません。
            </p>
          )}
          {(devices ?? []).map((device) => (
            <div key={device.id} className="flex items-center justify-between gap-3 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {device.name}
                  {device.blocked ? "（ブロック中）" : ""}
                </p>
                <p className="text-xs text-[var(--vy-text-dim)]">
                  {device.platform} ·{" "}
                  {device.lastSeenAt
                    ? Date.now() - Date.parse(device.lastSeenAt) < 90_000
                      ? "オンライン"
                      : `オフライン · 最終接続 ${formatRelativeTime(Date.parse(device.lastSeenAt))}`
                    : "オフライン"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void action(device.id, device.blocked ? "unblock" : "block")}
                  className="rounded-lg border border-[var(--vy-border)] px-2 py-1 text-xs"
                >
                  {device.blocked ? "解除" : "ブロック"}
                </button>
                <button
                  type="button"
                  onClick={() => void action(device.id, "remove")}
                  className="rounded-lg border border-[var(--vy-danger)] px-2 py-1 text-xs text-[var(--vy-danger)]"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </Section>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="vy-fade-in">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {desc && <p className="mt-1 mb-5 text-sm text-[var(--vy-text-dim)]">{desc}</p>}
      {children}
    </div>
  );
}

function ThemeSectionWithPreview() {
  const theme = useStore((s) => s.theme);
  const fontScale = useStore((s) => s.settings.fontScale);
  const compact = useStore((s) => s.settings.compactDensity);
  return (
    <div className="vy-fade-in grid gap-6 lg:grid-cols-[1fr_minmax(280px,320px)]">
      <div>
        <h2 className="text-xl font-bold tracking-tight">NezuTheme</h2>
        <p className="mt-1 mb-5 text-sm text-[var(--vy-text-dim)]">
          着せ替えを選ぶ・カスタムして自分だけの Vyline に
        </p>
        <VyThemePanel />
      </div>
      <aside className="hidden lg:block">
        <p className="mb-2 text-xs font-medium text-[var(--vy-text-dim)]">ライブプレビュー</p>
        <div
          className="sticky top-4 overflow-hidden border border-[var(--vy-border)] shadow-lg"
          style={{
            background: theme.chatImage ? undefined : theme.chatBg,
            backgroundImage: theme.chatImage
              ? `linear-gradient(color-mix(in oklab, ${theme.chatBg} 72%, transparent), color-mix(in oklab, ${theme.chatBg} 72%, transparent)), url(${theme.chatImage})`
              : theme.pattern
                ? `radial-gradient(circle at 1px 1px, color-mix(in oklab, ${theme.text} 8%, transparent) 1px, transparent 0)`
                : undefined,
            backgroundSize: theme.chatImage ? "cover" : theme.pattern ? "14px 14px" : undefined,
            backgroundPosition: "center",
            borderRadius: `${theme.radius}rem`,
          }}
        >
          <div
            className="flex items-center gap-2 border-b px-3 py-2.5 backdrop-blur-sm"
            style={{
              background: `color-mix(in oklab, ${theme.surface} 92%, transparent)`,
              borderColor: theme.border,
            }}
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: theme.accent, color: theme.accentContrast }}
            >
              V
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" style={{ color: theme.text }}>
                {theme.name}
              </p>
              <p className="truncate text-[0.65rem]" style={{ color: theme.textDim }}>
                オンライン · 角丸 {theme.radius.toFixed(2)}
              </p>
            </div>
          </div>
          <div
            className="space-y-2 p-3"
            style={{
              fontSize: `${0.95 * fontScale}rem`,
              paddingTop: compact ? "0.55rem" : "0.75rem",
              paddingBottom: compact ? "0.55rem" : "0.85rem",
            }}
          >
            <div
              className="max-w-[88%] px-3 shadow-sm"
              style={{
                background: theme.msgIn,
                color: theme.msgInText,
                borderRadius: `${theme.radius}rem`,
                paddingTop: compact ? "0.32rem" : "0.55rem",
                paddingBottom: compact ? "0.32rem" : "0.55rem",
              }}
            >
              新しい着せ替え、どう？
            </div>
            <div
              className="ml-auto max-w-[88%] px-3 shadow-sm"
              style={{
                background: theme.msgOut,
                color: theme.msgOutText,
                borderRadius: `${theme.radius}rem`,
                paddingTop: compact ? "0.32rem" : "0.55rem",
                paddingBottom: compact ? "0.32rem" : "0.55rem",
              }}
            >
              すごくいい感じ！
            </div>
            <p className="text-right text-[0.7rem] font-medium" style={{ color: theme.accent }}>
              既読
            </p>
            <div
              className="mt-1 flex items-center gap-2 rounded-full border px-3 py-1.5"
              style={{ background: theme.surface, borderColor: theme.border }}
            >
              <span className="flex-1 text-[0.7rem]" style={{ color: theme.textDim }}>
                メッセージを入力
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                style={{ background: theme.accent, color: theme.accentContrast }}
              >
                送信
              </span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

type RestoreResult = Awaited<ReturnType<typeof api.line.restoreFromDesktop>>;

const TOKEN_REFRESH_PRESETS = [
  { seconds: 30 * 24 * 60 * 60, label: "30日前" },
  { seconds: 7 * 24 * 60 * 60, label: "7日前" },
  { seconds: 3 * 24 * 60 * 60, label: "3日前" },
  { seconds: 24 * 60 * 60, label: "1日前" },
  { seconds: 6 * 60 * 60, label: "6時間前" },
  { seconds: 60 * 60, label: "1時間前" },
] as const;

function formatTokenSchedule(timestamp: number): string {
  const date = new Date(timestamp);
  const absolute = date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const diff = timestamp - Date.now();
  if (diff <= 0) return `${absolute}（次回の監視・起動時に更新）`;
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${absolute}（約${days}日後）`;
  const hours = Math.max(1, Math.floor(diff / 3_600_000));
  return `${absolute}（約${hours}時間後）`;
}

function SessionSection() {
  const accountId = useStore((s) => s.accountId);
  const selfMid = useStore((s) => s.self.mid);
  const [accountSettings, setAccountSettings] = useState<AccountSettings | null>(null);
  const [session, setSession] = useState<SavedSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void api.auth.sessions().then(async (res) => {
      if (cancelled || !res.ok) return;
      const current = res.sessions.find((item) => item.accountId === accountId) ?? null;
      setSession(current);
      const mid = current?.mid ?? selfMid;
      if (!mid) return;
      const settingsRes = await api.settings.account(mid);
      if (!cancelled && settingsRes.ok) setAccountSettings(settingsRes.settings);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, selfMid]);

  const saveRefreshLead = async (seconds: number) => {
    const mid = session?.mid ?? selfMid;
    if (!mid || !accountSettings || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.settings.saveAccount(mid, {
        auth: { ...accountSettings.auth, tokenRefreshLeadSeconds: seconds },
      });
      if (!res.ok) throw new Error("設定の保存に失敗しました");
      setAccountSettings(res.settings);
      setMessage("自動更新タイミングを保存しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "設定の保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const leadSeconds = accountSettings?.auth.tokenRefreshLeadSeconds ?? 7 * 24 * 60 * 60;
  const plannedRefreshAt = session?.tokenRefreshAt
    ? session.tokenRefreshAt - leadSeconds * 1000
    : null;

  return (
    <Section
      title="ログイン・セッション"
      desc="LINE の access token を再ログインなしで安全に更新するタイミングを管理します"
    >
      <Card>
        <div className="py-4">
          <p className="text-sm font-medium">Access token の自動更新</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            Vyline
            を常時起動していなくても、起動時に期限を確認します。選んだ余裕幅に入っていれば、保存済み
            refresh token で先に更新してからセッションを復元します。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {TOKEN_REFRESH_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                disabled={saving || !accountSettings}
                onClick={() => void saveRefreshLead(preset.seconds)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  leadSeconds === preset.seconds
                    ? "border-[var(--vy-accent)] bg-[color-mix(in_oklab,var(--vy-accent)_14%,transparent)] text-[var(--vy-accent)]"
                    : "border-[var(--vy-border)] hover:bg-[var(--vy-surface-2)]",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <Row
          title="現在の設定"
          desc={`LINE の更新目安より ${TOKEN_REFRESH_PRESETS.find((p) => p.seconds === leadSeconds)?.label ?? `${Math.round(leadSeconds / 3600)}時間前`} から更新を試します`}
        >
          <span className="text-xs font-medium text-[var(--vy-text)]">
            {TOKEN_REFRESH_PRESETS.find((p) => p.seconds === leadSeconds)?.label ?? "カスタム"}
          </span>
        </Row>
        <Row title="次回の更新目安" desc="LINE が返した更新時刻と現在の設定から算出した目安です">
          <span className="max-w-[260px] text-right text-xs text-[var(--vy-text-dim)]">
            {plannedRefreshAt
              ? formatTokenSchedule(plannedRefreshAt)
              : "更新時刻をまだ取得できていません"}
          </span>
        </Row>
        <Row
          title="自動更新の状態"
          desc="端末認証が LINE 側で解除された場合のみ、再ログインが必要です"
        >
          <span className="text-xs font-medium">
            {session?.hasRefreshToken ? "自動更新できます" : "refresh token 未保存"}
          </span>
        </Row>
      </Card>
      {message && <p className="mt-3 text-xs text-[var(--vy-text-dim)]">{message}</p>}
    </Section>
  );
}

function AdvancedSection() {
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const activeChatId = useStore((s) => s.activeChatId);
  const pollIncoming = useStore((s) => s.pollIncoming);
  const pollMessagesDelta = useStore((s) => s.pollMessagesDelta);
  const refreshChatsSilently = useStore((s) => s.refreshChatsSilently);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const handleRestore = async () => {
    if (demoMode) {
      setRestoring(true);
      setRestoreResult(null);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      setRestoreResult({
        ok: true,
        imported: 128,
        skipped: 0,
        hint: "撮影用データをローカルで復元しました（デモ）",
      });
      setRestoring(false);
      return;
    }
    if (!accountId) {
      setRestoreResult({ ok: false, error: "ログインが必要です" });
      return;
    }
    setRestoring(true);
    setRestoreResult(null);
    try {
      const res = await api.line.restoreFromDesktop(accountId);
      setRestoreResult(res);
    } catch (e) {
      setRestoreResult({
        ok: false,
        error: e instanceof Error ? e.message : "復元に失敗しました",
      });
    } finally {
      setRestoring(false);
    }
  };

  const handleSync = async () => {
    if ((!accountId && !demoMode) || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    const start = Date.now();
    try {
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 550));
        setLastSyncAt(Date.now());
        setSyncMsg("同期完了 · 新着0件（デモ）");
        return;
      }
      // 差分同期: イベントポーリング + アクティブチャットのデルタ + チャット一覧更新
      await pollIncoming();
      if (activeChatId) {
        await pollMessagesDelta(activeChatId);
      }
      await refreshChatsSilently();
      const elapsed = Date.now() - start;
      setLastSyncAt(Date.now());
      setSyncMsg(`同期完了 (${elapsed}ms)`);
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "同期に失敗しました");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Section title="詳細・復元" desc="同期、Desktop データの復元やデバッグ導線">
      <Card>
        <Row title="最新を同期" desc="新着メッセージを差分で取得します（手動）">
          <div className="flex items-center gap-2">
            {lastSyncAt && (
              <span className="text-[0.65rem] text-[var(--vy-text-dim)]">
                {formatRelativeTime(lastSyncAt)}
              </span>
            )}
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || (!accountId && !demoMode)}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--vy-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? "同期中…" : "同期"}
            </button>
          </div>
        </Row>
        {syncMsg && (
          <div className="py-2">
            <p className="text-xs text-[var(--vy-text-dim)]">{syncMsg}</p>
          </div>
        )}
        <Row title="Desktop データを復元" desc="以前の端末のトーク履歴・設定を読み込みます">
          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring || (!accountId && !demoMode)}
            className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--vy-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {restoring ? "復元中…" : "復元"}
          </button>
        </Row>
        <Row
          title="設定をエクスポート"
          desc="テーマ・表示・チャット整理設定をJSONファイルに書き出します（認証情報・履歴は含みません）"
        >
          <button
            type="button"
            onClick={() => {
              const state = useStore.getState();
              const exportData = {
                format: "vyline-local-settings",
                version: 2,
                exportedAt: new Date().toISOString(),
                contents: ["theme", "preferences", "chat-view"],
                theme: state.theme,
                settings: state.settings,
                hiddenChats: state.chats.filter((c) => c.hidden).map((c) => c.id),
                pinnedChats: state.chats.filter((c) => c.pinned).map((c) => c.id),
                customOrder: state.customOrder,
                localNames: Object.fromEntries(
                  state.chats.filter((c) => c.localName).map((c) => [c.id, c.localName]),
                ),
                mutedChats: state.chats.filter((c) => c.muted).map((c) => c.id),
                sidebarWidth: state.sidebarWidth,
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `vyline-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--vy-surface-2)]"
          >
            エクスポート
          </button>
        </Row>
        <Row title="設定をインポート" desc="形式と適用内容を確認してから、画面設定だけを復元します">
          <button
            type="button"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 1024 * 1024) throw new Error("設定ファイルが大きすぎます");
                  const text = await file.text();
                  const data = JSON.parse(text);
                  if (!data || typeof data !== "object") throw new Error("Invalid format");
                  if ("format" in data && data.format !== "vyline-local-settings")
                    throw new Error("Unsupported format");
                  const contents = Array.isArray(data.contents)
                    ? data.contents.filter(
                        (value: unknown): value is string => typeof value === "string",
                      )
                    : ["theme", "preferences", "chat-view"];
                  if (
                    !window.confirm(
                      `次の設定を復元します: ${contents.join("、")}\n認証情報とトーク履歴は変更しません。`,
                    )
                  )
                    return;
                  const state = useStore.getState();
                  // テーマ
                  if (data.theme && typeof data.theme === "object") state.setTheme(data.theme);
                  // 設定
                  if (data.settings && typeof data.settings === "object") {
                    for (const [k, v] of Object.entries(data.settings as Record<string, unknown>)) {
                      state.updateSetting(k as never, v as never);
                    }
                  }
                  // 非表示チャット
                  if (Array.isArray(data.hiddenChats)) {
                    for (const id of data.hiddenChats) state.setHidden(id, true);
                  }
                  // ピン留め
                  if (Array.isArray(data.pinnedChats)) {
                    for (const id of data.pinnedChats) {
                      if (!state.chats.find((c) => c.id === id)?.pinned) state.togglePin(id);
                    }
                  }
                  // カスタム順序
                  if (Array.isArray(data.customOrder)) state.setCustomOrder(data.customOrder);
                  // ローカル名
                  if (data.localNames && typeof data.localNames === "object") {
                    for (const [id, name] of Object.entries(
                      data.localNames as Record<string, string>,
                    )) {
                      state.setLocalName(id, name);
                    }
                  }
                  // ミュート
                  if (Array.isArray(data.mutedChats)) {
                    for (const id of data.mutedChats) {
                      if (!state.chats.find((c) => c.id === id)?.muted) state.toggleMute(id);
                    }
                  }
                  // サイドバー幅
                  if (typeof data.sidebarWidth === "number")
                    state.setSidebarWidth(data.sidebarWidth);
                  alert("設定をインポートしました");
                } catch {
                  alert("インポートに失敗しました。ファイルが破損している可能性があります。");
                }
              };
              input.click();
            }}
            className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--vy-surface-2)]"
          >
            インポート
          </button>
        </Row>
        <Row title="デバッグログを表示" desc="接続状態や送受信ログを確認します（開発者向け）">
          <button
            type="button"
            className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--vy-surface-2)]"
          >
            開く
          </button>
        </Row>
        <Row
          title="設定を初期化"
          desc="テーマ・設定・表示を初期値に戻します（ログイン状態・トーク履歴は保持）"
        >
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  "テーマ・設定・表示状態を初期値に戻します。\nログイン状態とトーク履歴はそのまま残ります。よろしいですか？",
                )
              )
                return;
              useStore.getState().resetSettings();
            }}
            className="rounded-lg border border-[var(--vy-danger)] px-3 py-1.5 text-xs font-medium text-[var(--vy-danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-danger)_12%,transparent)]"
          >
            初期化
          </button>
        </Row>
      </Card>

      <div className="mt-4">
        <AccountBackupStorage accountId={accountId} />
        <VylineBackupPanel key={accountId ?? "no-account"} accountId={accountId} />
      </div>

      {restoreResult && (
        <div
          className={cn(
            "mt-4 rounded-xl border px-4 py-3 text-sm",
            restoreResult.ok
              ? "border-[color-mix(in_oklab,var(--vy-accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--vy-accent)_10%,var(--vy-surface))]"
              : "border-[color-mix(in_oklab,var(--vy-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--vy-danger)_10%,var(--vy-surface))]",
          )}
        >
          {restoreResult.ok ? (
            <div className="space-y-1">
              <p className="font-medium" style={{ color: "var(--vy-accent)" }}>
                Desktop データの復元が完了しました
              </p>
              {restoreResult.imported != null && (
                <p className="text-xs text-[var(--vy-text-dim)]">
                  インポート: {restoreResult.imported} 件
                  {restoreResult.skipped != null ? ` · スキップ: ${restoreResult.skipped} 件` : ""}
                  {restoreResult.keyIds?.length
                    ? ` · 鍵 ID: ${restoreResult.keyIds.join(", ")}`
                    : ""}
                </p>
              )}
              {restoreResult.hint && (
                <p className="text-xs text-[var(--vy-text-dim)]">{restoreResult.hint}</p>
              )}
            </div>
          ) : (
            <p className="text-[var(--vy-text)]">
              {restoreResult.error ?? restoreResult.hint ?? "復元に失敗しました"}
            </p>
          )}
        </div>
      )}

      {!accountId && !demoMode && (
        <p className="mt-3 px-1 text-xs text-[var(--vy-text-dim)]">
          復元には LINE ログインが必要です。
        </p>
      )}
      <div className="mt-4">
        <AndroidBackupPanel key={accountId ?? "no-account"} accountId={accountId} />
        <IosBackupBetaPanel accountId={accountId} />
      </div>
    </Section>
  );
}

function VylineBackupPanel({ accountId }: { accountId: string | null }) {
  const [backups, setBackups] = useState<
    NonNullable<Awaited<ReturnType<typeof api.line.backupList>>["data"]>
  >([]);
  const [storage, setStorage] =
    useState<Awaited<ReturnType<typeof api.line.backupList>>["storage"]>();
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    if (!accountId) return;
    const result = await api.line.backupList(accountId);
    if (!result.ok) throw new Error(result.error ?? "バックアップ一覧を取得できませんでした");
    setBackups(result.data ?? []);
    setStorage(result.storage);
  };
  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "バックアップ一覧を取得できませんでした"),
    );
    return onAppEvent("backup:restored", (event) => {
      if (event.accountId === accountId)
        void load().catch((error) =>
          setMessage(error instanceof Error ? error.message : "保存容量を取得できませんでした"),
        );
    });
  }, [accountId]);
  const create = async () => {
    if (!accountId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.line.backupCreate(accountId, { includeMedia });
      if (!result.ok) throw new Error(result.error ?? "バックアップを作成できませんでした");
      setMessage(`${result.summary?.messageCount ?? 0}件のメッセージを保存しました`);
      emitAppEvent("backup:changed", { accountId });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "バックアップを作成できませんでした");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (id: string, media: boolean) => {
    if (!accountId || !window.confirm("現在の履歴にバックアップ内容を統合します。よろしいですか？"))
      return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.line.backupRestore(accountId, { backupId: id, includeMedia: media });
      if (!result.ok) throw new Error(result.error ?? "復元できませんでした");
      setMessage(`復元完了: ${result.restoredMessages ?? 0}件のメッセージ`);
      emitAppEvent("backup:changed", { accountId });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復元できませんでした");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (
      !accountId ||
      !window.confirm("このバックアップを削除しますか？現在のトーク履歴は削除されません。")
    )
      return;
    setBusy(true);
    try {
      const result = await api.line.backupDelete(accountId, id);
      if (!result.ok) throw new Error(result.error ?? "バックアップを削除できませんでした");
      await load();
      setMessage("バックアップを削除しました");
      emitAppEvent("backup:changed", { accountId });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "バックアップを削除できませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="VylineBackup"
      desc="このアカウントのトーク履歴を保存・復元します。履歴・保存メディア・バックアップを合わせて1アカウント10GBです。認証情報は含みません。"
    >
      <Card>
        <Row title="新しいバックアップを作成" desc="履歴をいつでも戻せるよう、このPC内へ保存します">
          <button
            type="button"
            disabled={busy || !accountId || storage?.remainingBytes === 0}
            onClick={() => void create()}
            className="rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {busy ? "処理中…" : "作成"}
          </button>
        </Row>
        <p className="py-2 text-xs text-[var(--vy-text-dim)]">
          {storage
            ? `このアカウントの使用量: ${formatBytes(storage.usedBytes)} / ${formatBytes(storage.limitBytes)}`
            : "保存上限: このアカウントで10GB"}
          {" · 上限を超える新規作成は停止します。既存バックアップは自動削除しません。"}
        </p>
        <label className="flex items-center justify-between py-3 text-xs text-[var(--vy-text-dim)]">
          <span>画像・動画などの保存済みメディアも含める</span>
          <input
            type="checkbox"
            checked={includeMedia}
            onChange={(event) => setIncludeMedia(event.target.checked)}
          />
        </label>
        {backups.length === 0 ? (
          <p className="py-3 text-sm text-[var(--vy-text-dim)]">まだバックアップはありません。</p>
        ) : (
          backups.map((backup) => (
            <div
              key={backup.id}
              className="flex items-center justify-between gap-3 border-t border-[var(--vy-border)] py-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium">{new Date(backup.createdAt).toLocaleString()}</p>
                <p className="text-[0.65rem] text-[var(--vy-text-dim)]">
                  {backup.chatCount}チャット · {backup.messageCount.toLocaleString()}件 ·{" "}
                  {formatBytes(backup.sizeBytes)}
                  {backup.includeMedia ? " · メディアあり" : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void restore(backup.id, backup.includeMedia)}
                className="shrink-0 rounded-lg border border-[var(--vy-border)] px-3 py-1.5 text-xs disabled:opacity-50"
              >
                復元
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(backup.id)}
                className="shrink-0 rounded-lg border border-red-400/50 px-3 py-1.5 text-xs text-red-300 disabled:opacity-50"
              >
                削除
              </button>
            </div>
          ))
        )}
      </Card>
      {message && <p className="mt-3 text-xs text-[var(--vy-text-dim)]">{message}</p>}
    </Section>
  );
}

function ReadDisabledChatList() {
  const chats = useStore((s) => s.chats);
  const readDisabledMids = useStore((s) => s.readDisabledMids);
  const toggleChatReadDisabled = useStore((s) => s.toggleChatReadDisabled);
  const disabledChats = chats.filter((chat) => readDisabledMids[chat.id]);

  return (
    <div className="mt-4">
      <Card>
        <div className="py-3.5">
          <p className="text-sm font-medium">既読オフにしているチャット</p>
          <p className="mt-0.5 text-xs text-[var(--vy-text-dim)]">
            個別に既読を無効化したチャットを確認できます。
          </p>
          {disabledChats.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--vy-text-dim)]">
              設定されているチャットはありません
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {disabledChats.map((chat) => (
                <li
                  key={chat.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--vy-surface-2)]"
                >
                  <Avatar
                    glyph={chat.name.charAt(0) || "?"}
                    color="var(--vy-accent)"
                    size={30}
                    imageUrl={chat.avatarUrl}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{chat.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleChatReadDisabled(chat.id)}
                    className="shrink-0 rounded-lg border border-[var(--vy-border)] px-2 py-1 text-[0.65rem] text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]"
                  >
                    既読を有効化
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function StorageSection() {
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const [storage, setStorage] = useState<{
    ok: boolean;
    driveLetter?: string;
    dataPath?: string;
    storagePath?: string;
    disk?: { totalBytes: number; freeBytes: number; usedBytes: number };
    vylineTotal: number;
    cacheSize: number;
    savedMediaSize: number;
    cache: { cdn: number; icons: number };
    savedMedia: { image: number; video: number; audio: number; file: number };
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    if (demoMode) {
      setStorage({
        ok: true,
        driveLetter: "DEMO",
        dataPath: "/app/data",
        storagePath: "/app/storage",
        disk: {
          totalBytes: 512 * 1024 ** 3,
          freeBytes: 338 * 1024 ** 3,
          usedBytes: 174 * 1024 ** 3,
        },
        vylineTotal: 476 * 1024 ** 2,
        cacheSize: 92 * 1024 ** 2,
        savedMediaSize: 384 * 1024 ** 2,
        cache: { cdn: 68 * 1024 ** 2, icons: 24 * 1024 ** 2 },
        savedMedia: {
          image: 188 * 1024 ** 2,
          video: 142 * 1024 ** 2,
          audio: 18 * 1024 ** 2,
          file: 36 * 1024 ** 2,
        },
      });
      return;
    }
    if (!accountId) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await api.line.getVylineStorageInfo(accountId);
      if (res.ok) setStorage(res);
      else setMsg(res.error ?? "取得に失敗しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const clearType = async (
    label: string,
    action: () => Promise<{ ok: boolean; removed?: number }>,
  ) => {
    if (!accountId && !demoMode) return;
    if (!window.confirm(`${label}を削除します。この操作は取り消せません。よろしいですか？`)) return;
    if (demoMode) {
      setMsg(`${label}を削除しました（デモ）`);
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const res = await action();
      if (res.ok) {
        setMsg(`${label}を削除しました (${res.removed ?? 0} 件)`);
        await load();
      } else {
        setMsg("削除に失敗しました");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accountId, demoMode]);

  const removableTotal = storage ? storage.cacheSize + storage.savedMediaSize : 0;
  const appDataSize = storage ? Math.max(0, storage.vylineTotal - removableTotal) : 0;
  const persistentPathLabel =
    storage?.dataPath && storage?.storagePath && storage.dataPath !== storage.storagePath
      ? `${storage.dataPath} + ${storage.storagePath}`
      : (storage?.storagePath ?? storage?.dataPath ?? storage?.driveLetter ?? "---");

  const segments = storage
    ? [
        {
          key: "app-data",
          label: "トーク履歴・設定",
          size: appDataSize,
          color: "#f59e0b",
        },
        { key: "cdn", label: "CDN", size: storage.cache.cdn, color: "var(--vy-accent)" },
        { key: "icons", label: "アイコン", size: storage.cache.icons, color: "var(--vy-accent)" },
        { key: "image", label: "画像", size: storage.savedMedia.image, color: "#3b82f6" },
        { key: "video", label: "動画", size: storage.savedMedia.video, color: "#a855f7" },
        { key: "audio", label: "音声", size: storage.savedMedia.audio, color: "#22c55e" },
        { key: "file", label: "ファイル", size: storage.savedMedia.file, color: "#6b7280" },
      ]
    : [];
  const diskFree = storage?.disk?.freeBytes ?? 0;
  const diskUsed = storage?.disk?.usedBytes ?? 0;
  const diskTotal = storage?.disk?.totalBytes ?? 0;
  const diskUsedPct = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

  return (
    <Section title="ストレージ" desc="アプリが使用している容量を管理します">
      <AccountBackupStorage accountId={accountId} />
      {storage && (
        <div className="mb-6 overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)]">
          <div className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs text-[var(--vy-text-dim)]">保存先 {persistentPathLabel}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {formatBytes(storage.vylineTotal)}
                </p>
                <p className="mt-2 max-w-md text-sm text-[var(--vy-text-dim)]">
                  トーク履歴・設定・バックアップ・キャッシュ・保存メディアを含むVyline全体の使用量です。
                </p>
              </div>

              <div className="shrink-0 sm:text-right">
                <p className="text-xs text-[var(--vy-text-dim)]">保存先の使用率</p>
                <p className="mt-1 text-xl font-semibold tracking-tight">
                  {formatPercent(diskUsedPct)}
                </p>
                <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
                  空き {formatBytes(diskFree)}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs text-[var(--vy-text-dim)]">
                <span>Vyline使用量の内訳</span>
                <span>{formatBytes(storage.vylineTotal)} 合計</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--vy-surface-2)]">
                {segments.map((s) => {
                  const pct = storage.vylineTotal > 0 ? (s.size / storage.vylineTotal) * 100 : 0;
                  return (
                    <div
                      key={s.key}
                      className="h-full transition-all duration-500"
                      style={{ background: s.color, width: `${pct}%` }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
              {segments.map((s) => (
                <div
                  key={s.key}
                  className="flex min-w-0 items-center gap-2 text-[var(--vy-text-dim)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 truncate">{s.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-[var(--vy-text)]">
                    {formatBytes(s.size)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-base font-semibold">削除可能なデータ</p>
          <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
            キャッシュと保存済みメディアだけを削除できます。トーク履歴・設定・バックアップは保持されます。
          </p>
        </div>
        {storage && (
          <span className="shrink-0 rounded-full bg-[var(--vy-surface-2)] px-2.5 py-1 text-xs text-[var(--vy-text-dim)]">
            {formatBytes(removableTotal)}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <TypeCard
          title="CDN キャッシュ"
          desc="スタンプ・LINE絵文字など"
          size={storage?.cache.cdn ?? 0}
          ratio={removableTotal > 0 ? (storage?.cache.cdn ?? 0) / removableTotal : 0}
          icon={<IconDownload size={20} className="text-[var(--vy-accent)]" />}
          iconBg="bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]"
          onDelete={() => clearType("CDN キャッシュ", () => api.line.clearCdnCache(accountId!))}
          disabled={loading || (!accountId && !demoMode)}
          accent="var(--vy-accent)"
        />
        <TypeCard
          title="アイコンキャッシュ"
          desc="プロフィール画像など"
          size={storage?.cache.icons ?? 0}
          ratio={removableTotal > 0 ? (storage?.cache.icons ?? 0) / removableTotal : 0}
          icon={<IconDownload size={20} className="text-[var(--vy-accent)]" />}
          iconBg="bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]"
          onDelete={() =>
            clearType("アイコンキャッシュ", () => api.line.clearIconCache(accountId!))
          }
          disabled={loading || (!accountId && !demoMode)}
          accent="var(--vy-accent)"
        />
        <TypeCard
          title="画像"
          desc="チャット画像"
          size={storage?.savedMedia.image ?? 0}
          ratio={removableTotal > 0 ? (storage?.savedMedia.image ?? 0) / removableTotal : 0}
          icon={<IconDownload size={20} className="text-[#3b82f6]" />}
          iconBg="bg-[color-mix(in_oklab,#3b82f6_18%,var(--vy-surface-2))]"
          onDelete={() =>
            clearType("保存画像", () => api.line.clearSavedMediaByType(accountId!, "image"))
          }
          disabled={loading || (!accountId && !demoMode)}
          accent="#3b82f6"
        />
        <TypeCard
          title="動画"
          desc="チャット動画"
          size={storage?.savedMedia.video ?? 0}
          ratio={removableTotal > 0 ? (storage?.savedMedia.video ?? 0) / removableTotal : 0}
          icon={<IconDownload size={20} className="text-[#a855f7]" />}
          iconBg="bg-[color-mix(in_oklab,#a855f7_18%,var(--vy-surface-2))]"
          onDelete={() =>
            clearType("保存動画", () => api.line.clearSavedMediaByType(accountId!, "video"))
          }
          disabled={loading || (!accountId && !demoMode)}
          accent="#a855f7"
        />
        <TypeCard
          title="音声"
          desc="ボイスメッセージなど"
          size={storage?.savedMedia.audio ?? 0}
          ratio={removableTotal > 0 ? (storage?.savedMedia.audio ?? 0) / removableTotal : 0}
          icon={<IconDownload size={20} className="text-[#22c55e]" />}
          iconBg="bg-[color-mix(in_oklab,#22c55e_18%,var(--vy-surface-2))]"
          onDelete={() =>
            clearType("保存音声", () => api.line.clearSavedMediaByType(accountId!, "audio"))
          }
          disabled={loading || (!accountId && !demoMode)}
          accent="#22c55e"
        />
        <TypeCard
          title="ファイル"
          desc="PDF など"
          size={storage?.savedMedia.file ?? 0}
          ratio={removableTotal > 0 ? (storage?.savedMedia.file ?? 0) / removableTotal : 0}
          icon={<IconDownload size={20} className="text-[#6b7280]" />}
          iconBg="bg-[color-mix(in_oklab,#6b7280_18%,var(--vy-surface-2))]"
          onDelete={() =>
            clearType("保存ファイル", () => api.line.clearSavedMediaByType(accountId!, "file"))
          }
          disabled={loading || (!accountId && !demoMode)}
          accent="#6b7280"
        />
      </div>

      {msg && (
        <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3">
          <p className="text-xs text-[var(--vy-text-dim)]">{msg}</p>
        </div>
      )}
      {!accountId && (
        <p className="mt-3 px-1 text-xs text-[var(--vy-text-dim)]">
          ストレージ情報を取得するにはログインが必要です。
        </p>
      )}
    </Section>
  );
}

function TypeCard({
  title,
  desc,
  size,
  ratio,
  icon,
  iconBg,
  accent,
  onDelete,
  disabled,
}: {
  title: string;
  desc: string;
  size: number;
  ratio: number;
  icon: React.ReactNode;
  iconBg: string;
  accent: string;
  onDelete: () => void;
  disabled: boolean;
}) {
  const hasData = size > 0;
  return (
    <div className="rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 break-words text-sm font-medium">{title}</p>
              <p className="shrink-0 font-mono text-sm font-semibold">{formatBytes(size)}</p>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--vy-surface-2)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    background: accent,
                    width: `${Math.max(ratio * 100, hasData ? 4 : 0)}%`,
                  }}
                />
              </div>
              <p className="shrink-0 text-xs text-[var(--vy-text-dim)]">
                {hasData ? formatPercent(ratio * 100) : "データなし"}
              </p>
            </div>
            <p className="mt-1 text-xs text-[var(--vy-text-dim)]">{desc}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDelete}
          disabled={disabled || !hasData}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs font-medium transition-colors sm:w-20",
            "hover:bg-[var(--vy-surface-2)] disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <IconTrash size={14} />
          {hasData ? "削除" : "データなし"}
        </button>
      </div>
    </div>
  );
}

function RemoteLinkIcon({
  src,
  fallback,
  alt,
}: {
  src: string;
  fallback: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--vy-surface-2)] text-xs font-bold">
      {failed ? (
        fallback
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function InfoSection() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    checkForUpdates().then((info) => {
      if (!cancelled) {
        setUpdateInfo(info);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section title="情報" desc="Vyline について">
      <div className="overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)]">
        <div className="flex flex-col items-center px-6 py-8 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-[var(--vy-accent-contrast)] shadow-lg"
            style={{ background: "var(--vy-accent)" }}
          >
            V
          </div>
          <h2 className="mt-4 text-xl font-bold">Vyline</h2>
          <p className="mt-1 font-mono text-sm text-[var(--vy-text-dim)]">
            v{UPDATE_NOTES.version}
          </p>
          {updateInfo?.hasUpdate && (
            <a
              href={updateInfo.downloadUrl ?? updateInfo.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--vy-accent)_16%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--vy-accent)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_26%,transparent)]"
            >
              更新あり: v{updateInfo.latestVersion}（インストーラー）
            </a>
          )}
          {checking && <p className="mt-3 text-xs text-[var(--vy-text-dim)]">更新を確認中…</p>}
          <p className="mt-3 max-w-sm text-xs leading-relaxed text-[var(--vy-text-dim)]">
            LINE 非公式サードパーティクライアント。Bun + Hono + React で構築。
          </p>
        </div>

        <div className="border-t border-[var(--vy-border)] px-5 py-3">
          <p className="text-xs font-medium text-[var(--vy-text-dim)]">作者</p>
          <p className="mt-1 text-sm font-semibold">nezumi0627</p>
        </div>

        <div className="border-t border-[var(--vy-border)] px-5 py-3">
          <p className="mb-3 text-xs font-medium text-[var(--vy-text-dim)]">リンク</p>
          <div className="space-y-2">
            <a
              href="https://github.com/nezumi0627"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--vy-surface-2)]"
            >
              <RemoteLinkIcon
                src="https://github.com/nezumi0627.png?size=96"
                fallback="GH"
                alt="nezumi0627 の GitHub アイコン"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">GitHub</p>
                <p className="truncate text-xs text-[var(--vy-text-dim)]">nezumi0627</p>
              </div>
              <span className="text-xs text-[var(--vy-text-dim)]">↗</span>
            </a>
            <a
              href="https://x.com/nezum1n1um"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--vy-surface-2)]"
            >
              <RemoteLinkIcon
                src="https://unavatar.io/twitter/nezum1n1um"
                fallback="𝕏"
                alt="nezum1n1um の X プロフィールアイコン"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">X (Twitter)</p>
                <p className="truncate text-xs text-[var(--vy-text-dim)]">@nezum1n1um</p>
              </div>
              <span className="text-xs text-[var(--vy-text-dim)]">↗</span>
            </a>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center text-[0.65rem] text-[var(--vy-text-dim)]">
        Vyline · MIT License
      </p>
    </Section>
  );
}

function NotificationsSection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async () => {
    if (demoMode) {
      const next = !settings.notificationsEnabled;
      updateSetting("notificationsEnabled", next);
      setMsg(next ? "通知を有効にしました（デモ）" : "通知を無効にしました（デモ）");
      return;
    }
    if (!accountId) {
      setMsg("ログインが必要です");
      return;
    }
    const next = !settings.notificationsEnabled;
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.line.setNotificationsEnabled(accountId, next);
      if (!res.ok) throw new Error(res.error ?? "失敗");
      updateSetting("notificationsEnabled", next);
      // マスタースイッチが無効のままなら通知は鳴らないので明示する
      if (next && res.masterEnable === false) {
        setMsg("有効化しました（ただし Settings の通知マスターが無効のため端末には届きません）");
      } else {
        setMsg(next ? "通知を有効にしました" : "通知を無効にしました");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="通知" desc="モバイルプッシュ通知の有効/無効を切替します">
      <Card>
        <Row title="通知を有効にする" desc="OFF にすると LINE からのプッシュ通知を一時停止します">
          <Toggle
            checked={settings.notificationsEnabled}
            onChange={toggle}
            label="通知を有効にする"
            disabled={saving || (!accountId && !demoMode)}
          />
        </Row>
      </Card>
      {msg && <p className="mt-3 text-xs text-[var(--vy-text-dim)]">{msg}</p>}
    </Section>
  );
}

function PrivacySection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [proxyMsg, setProxyMsg] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Array<{ mid: string; name?: string; avatarUrl?: string }>>(
    [],
  );
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [unblocking, setUnblocking] = useState<Set<string>>(new Set());

  const applyProxy = async () => {
    if (!accountId && !demoMode) return;
    const enabled = useStore.getState().settings.proxyEnabled;
    updateSetting("proxyUrl", proxyUrl);
    if (demoMode) {
      setProxyMsg(enabled ? "プロキシを適用しました（デモ）" : "プロキシを無効化しました（デモ）");
      return;
    }
    try {
      const res = await api.line.setProxySettings(accountId!, enabled, proxyUrl);
      setProxyMsg(
        res.ok
          ? enabled
            ? "プロキシを適用しました"
            : "プロキシを無効化しました"
          : (res.error ?? "失敗"),
      );
    } catch (err) {
      setProxyMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const loadBlocked = async () => {
    if (!accountId && !demoMode) return;
    setBlockedLoading(true);
    if (demoMode) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setBlocked([{ mid: "demo-blocked-user", name: "ブロック済みデモ" }]);
      setBlockedLoading(false);
      return;
    }
    try {
      const res = await api.line.getBlockedContactIds(accountId!);
      const mids = res.ok ? (res.mids ?? []) : [];
      // プロフィール取得
      const withProfiles = await Promise.all(
        mids.map(async (mid) => {
          try {
            const prof = await api.line.getContact(accountId!, mid);
            if (!prof.ok) return { mid };
            return {
              mid,
              name: prof.profile?.displayName,
              avatarUrl: prof.profile?.thumbnailUrl,
            };
          } catch {
            return { mid };
          }
        }),
      );
      setBlocked(withProfiles);
    } catch {
      setBlocked([]);
    } finally {
      setBlockedLoading(false);
    }
  };

  useEffect(() => {
    void loadBlocked();
    // アカウントを切り替えたときも、ブロック一覧を古い内容のまま表示しない。
  }, [accountId, demoMode]);

  const handleUnblock = async (mid: string) => {
    if ((!accountId && !demoMode) || unblocking.has(mid)) return;
    setUnblocking((s) => new Set(s).add(mid));
    if (demoMode) {
      setBlocked((prev) => prev.filter((b) => b.mid !== mid));
      setUnblocking(new Set());
      setProxyMsg("ブロックを解除しました（デモ）");
      return;
    }
    try {
      const res = await api.line.unblockContact(accountId!, mid);
      if (res.ok) {
        setBlocked((prev) => prev.filter((b) => b.mid !== mid));
        useStore.setState((st) => ({
          blockedMids: st.blockedMids.filter((m) => m !== mid),
        }));
      }
    } catch {
      /* ignore */
    } finally {
      setUnblocking((s) => {
        const next = new Set(s);
        next.delete(mid);
        return next;
      });
    }
  };

  return (
    <Section title="プライバシー" desc="プロキシ・ブロック">
      <Card>
        <Row title="配信者モード" desc="一覧・ヘッダーの名前を「友だち／グループ」に伏せます">
          <Toggle
            checked={settings.streamerMode}
            onChange={(v) => updateSetting("streamerMode", v)}
            label="配信者モード"
          />
        </Row>
        <Row title="プロキシを使う" desc="HTTP/HTTPS/SOCKS（例: http://127.0.0.1:7890）">
          <Toggle
            checked={settings.proxyEnabled}
            onChange={(v) => updateSetting("proxyEnabled", v)}
            label="プロキシを使う"
          />
        </Row>
      </Card>

      <div className="mt-4">
        <Card>
          <div className="py-3.5">
            <p className="text-sm font-medium">プロキシ URL</p>
            <div className="mt-2 flex gap-2">
              <input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className="flex-1 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              />
              <button
                type="button"
                onClick={() => void applyProxy()}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)]"
                style={{ background: "var(--vy-accent)" }}
              >
                適用
              </button>
            </div>
            {proxyMsg && <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{proxyMsg}</p>}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <div className="py-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">ブロックリスト</p>
              <button
                type="button"
                disabled={(!accountId && !demoMode) || blockedLoading}
                onClick={() => void loadBlocked()}
                className="rounded-lg border border-[var(--vy-border)] px-2.5 py-1 text-xs disabled:opacity-50"
              >
                {blockedLoading ? "取得中…" : "取得"}
              </button>
            </div>
            {blocked.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--vy-text-dim)]">未取得、または 0 件</p>
            ) : (
              <ul className="vy-scroll mt-2 max-h-64 space-y-1 overflow-y-auto">
                {blocked.map((b) => (
                  <li
                    key={b.mid}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--vy-surface-2)]"
                  >
                    <Avatar
                      glyph={b.name?.charAt(0)?.toUpperCase() ?? "?"}
                      color="var(--vy-accent)"
                      size={32}
                      imageUrl={b.avatarUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {b.name || `${b.mid.slice(0, 14)}…`}
                      </p>
                      <p className="truncate font-mono text-[0.6rem] text-[var(--vy-text-dim)]">
                        {b.mid}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={unblocking.has(b.mid)}
                      onClick={() => void handleUnblock(b.mid)}
                      className="shrink-0 rounded-lg border border-[var(--vy-border)] px-2.5 py-1 text-[0.65rem] font-medium text-[var(--vy-text-dim)] transition-colors hover:border-[var(--vy-danger)] hover:text-[var(--vy-danger)] disabled:opacity-40"
                    >
                      {unblocking.has(b.mid) ? "…" : "解除"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Section>
  );
}
