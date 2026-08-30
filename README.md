<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: ja -->

[English](README.en.md)

# Vyline — tqmane fork

LINE 非公式サードパーティクライアント Vyline の tqmane fork です。

> [!CAUTION]
> 非公式・未承認クライアントです。アカウント停止やデータ損失を含むリスクを理解したうえで利用してください。

## Quickstart

### Portainer

1. **Stacks → Add stack → Web editor** を開き、[`docker-compose.portainer.yml`](docker-compose.portainer.yml) を貼り付けます。
2. Deploy します。既定イメージは `ghcr.io/tqmane/vyline:latest` です。
3. 更新時は **Pull latest image → Update the stack**。ホスト側ビルドは不要です。

`latest` は `linux/amd64` と `linux/arm64` の multi-arch manifest です。通常の Linux PC/サーバー、64-bit Raspberry Pi、arm64 Android Docker 環境で同じタグを使えます。

### Docker Compose

```bash
mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
```

ブラウザで `http://<server-ip>:3000` を開きます。

既定では `./data` と `./storage` を永続化します。更新時にこの2つを削除しないでください。

LAN公開を止めたい場合は `VYLINE_BIND_ADDRESS=127.0.0.1`、ポート変更は `VYLINE_PORT`、保存先変更は `VYLINE_DATA_PATH` / `VYLINE_STORAGE_PATH` を設定します。

## tqmane fork の主な差分

- トーク履歴を必要時だけ追加取得し、バックグラウンドで無限取得しない同期設計。
- 過去ログ閲覧中のスクロール位置を維持し、右下のボタンから最新位置へ戻れる UI。
- アナウンスを既定でコンパクト表示し、`∨` / `∧` で展開・折りたたみ。
- Docker の履歴・設定・メディア永続化、atomic write、復元後 flush の強化。
- Note / Album、LIFF sender metadata、channel token lifecycle、期限切れ unsend 防止など upstream の有用な修正を選択的に同期。

## GHCR / GitHub Actions

`.github/workflows/container.yml` が `main` push、`v*` tag、手動実行で Buildx を起動し、次を GHCR に push します。

```text
ghcr.io/tqmane/vyline:latest
linux/amd64
linux/arm64
```

branch / tag / `sha-*` タグ、GitHub Actions cache、provenance、SBOM も生成します。

## Development

```bash
git clone --recurse-submodules https://github.com/tqmane/vyline.git
cd vyline
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

Bun 1.4 以降を使用してください。サブモジュールは tqmane 側リポジトリを参照します。

## Security

Vyline を認証なしで直接インターネットへ公開しないでください。外部公開する場合は TLS と認証済み reverse proxy / VPN を使用してください。`.env`、トークン、バックアップ、アカウント DB、`data/`、`storage/` をコミットしないでください。

## Documentation

長い旧 README は [`docs/README.full.md`](docs/README.full.md) に退避しています。詳細な解析・開発ドキュメントは [`docs/`](docs/) を参照してください。

## Upstream / License

Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). tqmane fork の意図的な差分を維持しつつ、有用な upstream 変更を選択的に取り込みます。

ライセンスと attribution は [`LICENSE`](LICENSE) を参照してください。
