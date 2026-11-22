# Vyline PR動画をTellaで仕上げる

`/pr-demo` は、Vyline本体と同じ `ChatShell` / `Sidebar` / `ChatArea` /
`MessageInput` / `SettingsSections` を、個人情報のない仮データで表示する撮影専用モードです。
`accountId` は常に `null` で、デモ中の送信もローカルストアにだけ追加されます。
実際のPR動画は、この画面をPlaywrightで操作し、OpenScreenでウィンドウ録画する `pr:video` を使います。

## 1. 素材を自動生成

```powershell
cd E:\projects\Vyline\Vyline\apps\desktop
# OpenScreen v1.10.0 をインストール済みの場合
$env:OPENSCREEN_BIN = "C:\Users\<ユーザー名>\AppData\Local\Programs\Openscreen\Openscreen.exe"
bun run pr:video
```

生成物:

- `recordings/openscreen/vyline-demo-*.openscreen` — OpenScreen編集プロジェクト（カーソル情報・ズーム情報）
- `recordings/openscreen/vyline-demo-*.mp4` — OpenScreenで自動ズームを適用したMP4
- `recordings/openscreen/vyline-demo-*.srt` — Tella等で再利用できる字幕

バックエンド、ログイン、LINEアカウントは不要です。録画時はローカルViteと仮データだけを使い、
Playwrightはlocalhost以外のURLを遮断します。実アカウントのチャット・名前・MID・画像は読み込みません。

機能別クリップの対象は次のとおりです。

- チャット一覧と仮メッセージ
- チャット検索とローカルデモ送信
- スタンプ・絵文字ピッカーと仮スタンプ
- 返信メニュー
- 設定（表示、NezuTheme、プライバシー、詳細・復元）

UIに存在する設定タブ（プロフィール、既読、表示、テーマ、通知、プライバシー、
詳細・復元、サブデバイス、ストレージ、情報、ベータ）も、詳細設定クリップの流れで
確認できます。未実装の機能は画面上のComing Soon表示をそのまま撮影します。

実アカウントを使った動作確認が必要な場合だけ、個別に次を実行します。

```powershell
bun run pr:video:live
```

このコマンドは実データを表示し得るため、PR素材の作成には使用しないでください。

OpenScreenの録画対象を絞る場合:

```powershell
$env:VYLINE_PR_SCENARIOS = "chat,search-send,sticker-emoji,theme"
bun run pr:video
```

## 2. Tellaへアップロード

Tellaで `Upload existing videos` を選び、MP4をアップロードします。MP4がない場合はWebMを試し、必要ならTella側で書き出します。

推奨設定:

- Layout: Screen recordingを主役にするFull screenまたはSide-by-side
- Background: Vylineの青 (`#2AABEE`) と濃紺 (`#09111C`)
- Zoom: クリック位置が分かる程度に自動ズームを有効化
- Captions: ナレーションを録音した場合はTellaのTranscriptから自動字幕を生成
- Export: 16:9、HDまたは4K、30fps

字幕を音声なしで確実に出す場合は、画面左側に表示されるシーン字幕をそのまま残します。ナレーションを録音する場合は、SRTの文面を読み上げるとTellaの自動字幕と一致します。

## 3. Tellaへアップロードする順番

MP4を次の順で並べると、ドキュメントの使い方を短編動画として説明できます。

1. `chat`
2. `search-send`
3. `sticker-emoji`
4. `reply`
5. `settings-display`
6. `settings-theme`
7. `settings-privacy`
8. `settings-advanced`

## 注意

このモードは実LINEの送信API、プロフィールAPI、スタンプAPI、サブデバイスAPIを呼びません。
スタンプと絵文字はリポジトリ内のデモSVGを使用します。したがってネットワーク状態や
個人アカウントの内容に左右されず、PR素材に個人情報が混入しません。
