# Bunとvyl CLIで起動する

Windows・macOS・Linuxで同じコマンドを使う方法です。GitとBun 1.4.0以降を用意します。

## 1. Vylineを取得する

```sh
git clone --recurse-submodules --branch v1.0.3 https://github.com/nezumi0627/vyline.git
cd vyline
bun install
```

WindowsではPowerShell、macOSとLinuxでは普段使うターミナルで実行できます。

## 2. vylを登録する

Vylineのフォルダ内で実行します。

```sh
bun run vyl register
```

`vyl` と `vyline` のコマンドをBunのグローバルbinへ登録し、このチェックアウトを既定の起動先としてユーザー設定に保存します。設定はWindowsでは `%APPDATA%\Vyline\cli.json`、macOSとLinuxでは `${XDG_CONFIG_HOME:-~/.config}/Vyline/cli.json` に置きます。アカウント情報は保存しません。

## 3. どこからでも起動する

ターミナルを開き直し、任意のフォルダから実行します。

```sh
vyl doctor
vyl dev
```

ブラウザで `http://localhost:5173` を開きます。`vyl start` はBackendだけを起動します。ログインには通常のVyline画面を使います。

### Bunのコマンドが見つからないとき

登録先は `bun pm bin -g` で確認できます。そのフォルダをユーザーのPATHに追加してから、新しいターミナルを開いてください。

- Windows: 通常は `%USERPROFILE%\.bun\bin`。Windowsの「環境変数」からユーザーPATHへ追加します。
- macOS / Linux: 通常は `~/.bun/bin`。必要ならシェルの設定ファイルに次を追加します。

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

`bunfig.toml` で `install.globalBinDir` または `BUN_INSTALL_BIN` を設定している場合は、その登録先をPATHへ追加します。

### 別のチェックアウトを既定にする

対象のVylineフォルダから `bun run vyl register` をもう一度実行します。または既に登録済みなら、次のようにパスを指定できます。

```sh
vyl register --project /path/to/vyline
```

Windowsの例:

```powershell
vyl register --project E:\projects\Vyline
```

### 登録を解除する

```sh
vyl unregister
```

グローバルコマンドと既定プロジェクトの設定を削除します。Bun本体は削除しません。
