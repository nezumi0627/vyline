# Vyline Developer Technology Stack

## *Vision Beyond Limits.*

開発者向けの技術スタック推奨と選定ガイドライン。

---

## Table of Contents

- [Overview](#overview)
- [Technology Selection Principles](#technology-selection-principles)
- [Frontend Stack](#frontend-stack)
- [Backend/Core Stack](#backendcore-stack)
- [Database & Storage](#database--storage)
- [Network & Communication](#network--communication)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Build Tools & CI/CD](#build-tools--cicd)
- [Development Tools](#development-tools)
- [Documentation Tools](#documentation-tools)
- [Security Tools](#security-tools)
- [Performance Monitoring](#performance-monitoring)
- [Recommended Versions](#recommended-versions)
- [Migration Strategy](#migration-strategy)

---

## Overview

Vyline の技術スタックは以下の原則に基づいて選定されます：

- **Lightweight**: 軽量で高速
- **Type-Safe**: 型安全な開発
- **Modern**: 最新のベストプラクティス
- **Cross-Platform**: クロスプラットフォーム対応
- **Community-Driven**: 活発なコミュニティ
- **Long-term Support**: 長期的なサポート

---

## Technology Selection Principles

### 1. Performance First

パフォーマンスを最優先に考慮します。

**基準:**
- 起動時間 < 3秒
- メモリ使用量 < 500MB (アイドル時)
- 60 FPS 以上のレンダリング
- 低レイテンシの操作応答

### 2. Developer Experience

開発者の生産性を重視します。

**基準:**
- 豊富な型定義
- 優れた IDE サポート
- アクティブなコミュニティ
- 詳細なドキュメント

### 3. Ecosystem Maturity

成熟したエコシステムを選択します。

**基準:**
- 安定した API
- 定期的な更新
- セキュリティパッチの迅速な対応
- 広範な採用実績

### 4. License Compatibility

オープンソースライセンスに対応します。

**基準:**
- MIT, Apache 2.0, BSD などの寛容なライセンス
- 商用利用可能
- 特許条項のないライセンス

---

## Frontend Stack

### Core Framework

#### **React 19.2.6** ⭐ 推奨 (2026年5月現在)

**理由:**
- 広範な採用と成熟したエコシステム
- 豊富なコンポーネントライブラリ
- 優れたパフォーマンス（Concurrent Mode）
- TypeScript の完全なサポート

**代替案:**
- **SolidJS**: より高いパフォーマンス、React 似の API
- **Svelte**: コンパイル時最適化、小さいバンドルサイズ

### Desktop Framework

#### **Tauri 2.0** ⭐ 推奨 (2026年5月現在)

**理由:**
- Electron より大幅に軽量（バンドルサイズ < 10MB）
- Rust バックエンドとの統合
- セキュリティ重視の設計
- ネイティブ API アクセス

**代替案:**
- **Electron**: 成熟したエコシステム、より大きいバンドルサイズ
- **Neutralino**: 軽量、制限された API

### Language

#### **TypeScript 6.0** ⭐ 推奨 (2026年5月現在)

**理由:**
- 型安全性
- 優れた IDE サポート
- 最新の ECMAScript 機能
- 大規模プロジェクトでの保守性

**設定推奨:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### State Management

#### **Zustand** ⭐ 推奨

**理由:**
- シンプルな API
- TypeScript ファースト
- 小さいバンドルサイズ（~1KB）
- Context API 不要

**代替案:**
- **Redux Toolkit**: 大規模アプリ向け、より複雑
- **Jotai**: 原子的な状態管理
- **React Query**: サーバー状態管理

### UI Component Library

#### **shadcn/ui + Radix UI** ⭐ 推奨

**理由:**
- アクセシビリティ重視
- 完全なカスタマイズ可能
- TailwindCSS ベース
- コピーアンドペーストで導入

**構成:**
```bash
# shadcn/ui (コンポーネント)
npx shadcn-ui@latest init

# Radix UI (プリミティブ)
npm install @radix-ui/react-dialog
npm install @radix-ui/react-dropdown-menu
```

**代替案:**
- **Mantine**: React コンポーネントライブラリ
- **Chakra UI**: シンプルな API
- **MUI**: Material Design

### Styling

#### **TailwindCSS 4.0** ⭐ 推奨 (2026年5月現在)

**理由:**
- ユーティリティファースト
- 高度なカスタマイズ
- JIT コンパイル
- ダークモード対応

**設定推奨:**
```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        vy: {
          primary: 'var(--vy-accent-primary)',
          background: 'var(--vy-bg-primary)',
        }
      }
    }
  }
}
```

**代替案:**
- **CSS Modules**: 標準的な CSS
- **Styled Components**: CSS-in-JS
- **Emotion**: CSS-in-JS、高性能

### Animation

#### **Motion (formerly Framer Motion) 12.38.0** ⭐ 推奨 (2026年5月現在)

**注意:** Framer Motion は現在 "Motion" という名前でリリースされています。インストール時は `motion/react` を使用します。

```bash
npm install motion
# または
npm install framer-motion  # 旧名でも動作しますが、推奨されません
```

**理由:**
- 宣言的なアニメーション
- ジェスチャーサポート
- 優れたパフォーマンス
- TypeScript サポート

**代替案:**
- **React Spring**: 物理ベースのアニメーション
- **Auto Animate**: 自動アニメーション
- **CSS Transitions**: ネイティブ CSS

### Form Handling

#### **React Hook Form + Zod** ⭐ 推奨

**理由:**
- 最小限の再レンダリング
- TypeScript との統合
- Zod によるスキーマ検証
- 優れたパフォーマンス

**例:**
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
});

const { register, handleSubmit } = useForm({
  resolver: zodResolver(schema),
});
```

### Data Fetching

#### **TanStack Query (React Query)** ⭐ 推奨

**理由:**
- キャッシュ管理
- 自動再フェッチ
- 楽観的更新
- TypeScript サポート

**代替案:**
- **SWR**: シンプルな API
- **Apollo Client**: GraphQL 向け
- **RTK Query**: Redux Toolkit 統合

### Virtual Scrolling

#### **TanStack Virtual** ⭐ 推奨

**理由:**
- 高性能な仮想スクロール
- フレキシブルな API
- TypeScript サポート
- 小さいバンドルサイズ

**代替案:**
- **react-window**: 軽量、シンプル
- **react-virtuoso**: 高機能

### Icon Library

#### **Lucide React** ⭐ 推奨

**理由:**
- 一貫したデザイン
- Tree-shakeable
- TypeScript サポート
- カスタマイズ可能

**代替案:**
- **Heroicons**: TailwindCSS チーム製
- **Tabler Icons**: 豊富なアイコンセット

---

## Backend/Core Stack

### Core Language

#### **Rust 1.95.0** ⭐ 推奨 (2026年5月現在)

**理由:**
- メモリ安全性
- 高性能
- ゼロコスト抽象化
- 優れたツールチェーン

**ツールチェーン:**
```bash
rustup install stable
rustup component add rustfmt clippy
cargo install cargo-watch
```

### Async Runtime

#### **Tokio** ⭐ 推奨

**理由:**
- 事実上の標準
- 高性能
- 豊富なエコシステム
- タイマー、IO、ネットワークのサポート

**設定:**
```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

### HTTP Client

#### **Reqwest** ⭐ 推奨

**理由:**
- シンプルな API
- 非同期サポート
- JSON サポート
- Cookie 管理

**代替案:**
- **Surf**: ストリーミング重視
- **Hyper**: 低レベル、HTTP/2 サポート

### WebSocket

#### **Tungstenite** ⭐ 推奨

**理由:**
- Tokio との統合
- シンプルな API
- 高性能
- TLS サポート

**代替案:**
- **Tokio-Tungstenite**: Tokio 専用
- **Actix-web**: フレームワーク統合

### Serialization

#### **Serde** ⭐ 推奨

**理由:**
- 事実上の標準
- 高性能
- 豊富なフォーマットサポート
- derive マクロ

**例:**
```rust
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
struct Message {
    id: String,
    content: String,
    timestamp: i64,
}
```

### Error Handling

#### **anyhow + thiserror** ⭐ 推奨

**理由:**
- anyhow: アプリケーションエラー
- thiserror: ライブラリエラー
- コンテキスト情報の追加
- 良好的なエラーメッセージ

**例:**
```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}
```

### Logging

#### **tracing + tracing-subscriber** ⭐ 推奨

**理由:**
- 構造化ロギング
- 非同期対応
- フィルタリング
- 豊富なサブスクライバー

**例:**
```rust
use tracing::{info, error, instrument};

#[instrument]
async fn send_message(msg: Message) -> Result<(), AppError> {
    info!("Sending message: {}", msg.id);
    // ...
}
```

### Configuration

#### **config-rs** ⭐ 推奨

**理由:**
- 複数フォーマット対応（TOML, YAML, JSON）
- 環境変数のオーバーライド
- 型安全な設定
- ホットリロード

**代替案:**
- **figment**: 柔軟な設定管理
- **dotenv**: 環境変数のみ

### CLI Tools

#### **clap** ⭐ 推奨

**理由:**
- derive マクロ
- 自動ヘルプ生成
- サブコマンド対応
- 豊富な機能

**例:**
```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "vyline")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}
```

---

## Database & Storage

### Primary Database

#### **SQLite (rusqlite)** ⭐ 推奨

**理由:**
- サーバーレス
- クロスプラットフォーム
- ACID トランザクション
- 小さいフットプリント

**使用ケース:**
- メッセージ履歴
- 設定
- キャッシュ
- Plugin State

**設定:**
```toml
[dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
```

**代替案:**
- **RocksDB**: 高性能 Key-Value Store
- **SurrealDB**: マルチモデルデータベース

### ORM

#### **SeaORM** ⭐ 推奨

**理由:**
- 非同期対応
- TypeScript 似の API
- マイグレーションサポート
- クエリビルダー

**例:**
```rust
use sea_orm::{EntityTrait, QueryFilter};

let messages = Message::find()
    .filter(message::Column::ChannelId.eq(channel_id))
    .all(db)
    .await?;
```

**代替案:**
- **Diesel**: 同期、コンパイル時クエリ検証
- **SQLx**: コンパイル時クエリ検証、非同期

### Caching

#### **moka** ⭐ 推奨

**理由:**
- 高性能
- 非同期対応
- TTL サポート
- スレッドセーフ

**代替案:**
- **lru**: シンプルな LRU キャッシュ
- **redis-distributed**: 分散キャッシュ

---

## Network & Communication

### HTTP Server

#### **Axum 0.8** ⭐ 推奨 (2026年5月現在)

**理由:**
- Tokio ベース
- ルーターの抽出
- ミドルウェアサポート
- TypeScript 似の API

**例:**
```rust
use axum::{Router, routing::get};

let app = Router::new()
    .route("/api/messages", get(get_messages));
```

**代替案:**
- **Actix-web**: 高性能、豊富な機能
- **Warp**: フィルターベース

### IPC

#### **Tauri IPC** ⭐ 推奨

**理由:**
- Tauri ネイティブ
- タイプセーフ
- 非同期対応
- シリアライゼーション自動

**代替案:**
- **JSON-RPC**: 汎用的な IPC プロトコル
- **gRPC**: 高性能 RPC

---

## Testing & Quality Assurance

### Frontend Testing

#### **Vitest** ⭐ 推奨

**理由:**
- Vite ネイティブ
- 高速
- Jest 互換 API
- TypeScript サポート

**設定:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
```

**代替案:**
- **Jest**: 成熟したテストフレームワーク
- **Playwright**: E2E テスト

### Component Testing

#### **Testing Library** ⭐ 推奨

**理由:**
- ユーザー視点のテスト
- アクセシビリティ重視
- React コンポーネントテスト

**例:**
```typescript
import { render, screen } from '@testing-library/react';

render(<Message content="Hello" />);
expect(screen.getByText('Hello')).toBeInTheDocument();
```

### Backend Testing

#### **cargo test** ⭐ 推奨

**理由:**
- Rust ネイティブ
- 統合テストサポート
- ベンチマーク
- ドキュメントテスト

**例:**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_parsing() {
        // ...
    }
}
```

### E2E Testing

#### **Playwright** ⭐ 推奨

**理由:**
- クロスブラウザ対応
- 高速
- 自動待機
- TypeScript サポート

**代替案:**
- **Cypress**: デバッグ容易
- **Puppeteer**: Chromium のみ

### Linting

#### **Frontend: ESLint + Prettier** ⭐ 推奨

**理由:**
- 広範なルール
- 自動修正
- TypeScript サポート
- プラグインエコシステム

**設定:**
```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended"
  ]
}
```

#### **Backend: clippy** ⭐ 推奨

**理由:**
- Rust ネイティブ
- リントと静的解析
- パフォーマンス最適化提案

```bash
cargo clippy -- -D warnings
```

### Type Checking

#### **tsc** ⭐ 推奨

```bash
tsc --noEmit
```

---

## Build Tools & CI/CD

### Package Manager

#### **pnpm** ⭐ 推奨

**理由:**
- 高速
- ディスクスペース節約
- 厳格な依存関係
- Workspace サポート

**代替案:**
- **npm**: 標準、広範な採用
- **yarn**: 高速、Plug'n'Play

### Frontend Build

#### **Vite** ⭐ 推奨

**理由:**
- 高速な HMR
- 最適化されたビルド
- プラグインエコシステム
- TypeScript サポート

**代替案:**
- **Webpack**: 高度な設定
- **esbuild**: 超高速

### Backend Build

#### **cargo** ⭐ 推奨

```bash
cargo build --release
```

### CI/CD

#### **GitHub Actions** ⭐ 推奨

**理由:**
- GitHub ネイティブ
- 豊富なアクション
- 無料プラン
- YAML ベース

**例:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: pnpm install
      - run: pnpm test
```

**代替案:**
- **GitLab CI**: GitLab ネイティブ
- **CircleCI**: 高度な機能

---

## Development Tools

### IDE

#### **VS Code** ⭐ 推奨

**推奨拡張機能:**
- **rust-analyzer**: Rust 言語サーバー
- **ESLint**: JavaScript/TypeScript リンティング
- **Prettier**: コードフォーマット
- **Tailwind CSS IntelliSense**: TailwindCSS サポート
- **Vitest**: テストサポート

**代替案:**
- **Neovim**: 軽量、高度なカスタマイズ
- **JetBrains Rider**: IDE、豊富な機能

### Version Control

#### **Git** ⭐ 推奨

**推奨プラクティス:**
- Conventional Commits
- Git Flow または GitHub Flow
- Pull Request ベースの開発

### API Documentation

#### **OpenAPI (Swagger)** ⭐ 推奨

**理由:**
- 標準化されたフォーマット
- 自動ドキュメント生成
- クライアントコード生成

---

## Documentation Tools

### API Documentation

#### **TypeDoc** ⭐ 推奨

**理由:**
- TypeScript ネイティブ
- JSDoc サポート
- 複数フォーマット出力

### Rust Documentation

#### **rustdoc** ⭐ 推奨

```bash
cargo doc --open
```

### General Documentation

#### **Markdown** ⭐ 推奨

**理由:**
- シンプル
- 広範なサポート
- GitHub ネイティブ

---

## Security Tools

### Dependency Scanning

#### **npm audit / cargo audit** ⭐ 推奨

```bash
npm audit
cargo audit
```

### Static Analysis

#### **Snyk** ⭐ 推奨

**理由:**
- 脆弱性スキャン
- 自動修正提案
- CI/CD 統合

### Secret Management

#### **.env files + dotenv** ⭐ 推奨

**注意:**
- .env を .gitignore に追加
- .env.example を提供

---

## Performance Monitoring

### Frontend

#### **React DevTools** ⭐ 推奨

**理由:**
- コンポーネントプロファイリング
- Props/State の検査
- パフォーマンス測定

### Backend

#### **tracing + metrics** ⭐ 推奨

**理由:**
- 構造化ロギング
- メトリクス収集
- 分散トレーシング

---

## Recommended Versions

### Frontend

| Package | Version | Release Date |
|---------|---------|--------------|
| React | 19.2.6 | 2026-05-16 |
| TypeScript | 6.0 | 2026-03-24 |
| Tauri | 2.0 | 2024-10-02 |
| Vite | 8.0 | 2026-03-12 |
| TailwindCSS | 4.0 | 2024-11-15 |
| Zustand | 5.0.13 | 2026-05-13 |
| TanStack Query | 5.100.10 | 2026-05-08 |
| Motion (Framer Motion) | 12.38.0 | 2026-03-16 |
| React Hook Form | 7.53.0 | 2026-05-10 |
| Zod | 3.23.8 | 2026-05-01 |
| Vitest | 4.1.6 | 2026-05-11 |
| Testing Library React | 16.3.2 | 2026-01-15 |
| Playwright | 1.59.0 | 2026-04-29 |
| pnpm | 11.1.1 | 2026-05-15 |

### Backend

| Package | Version | Release Date |
|---------|---------|--------------|
| Rust | 1.95.0 | 2026-05-15 |
| Tokio | 1.40 | 2026-05-10 |
| Reqwest | 0.13 | 2026-05-01 |
| Serde | 1.0.200 | 2026-04-20 |
| Tungstenite | 0.29.0 | 2026-04-15 |
| SeaORM | 2.0 | 2026-03-01 |
| Axum | 0.8 | 2026-03-15 |
| Clap | 4.5 | 2026-04-25 |
| Tracing | 0.1.40 | 2026-05-05 |
| rusqlite | 0.32 | 2026-04-10 |
| moka | 0.12 | 2026-03-20 |

---

## Environment Setup

### Prerequisites

Vyline を開発するには、以下のツールが必要です：

- **Node.js**: 20.x または 22.x
- **Rust**: 1.95.0+
- **pnpm**: 11.1.1+
- **Git**: 最新版

### Step 1: Install Rust

```bash
# Rustup をインストール
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Rust 1.95.0 をインストール
rustup install stable
rustup default stable

# 追加ツールをインストール
rustup component add rustfmt clippy
cargo install cargo-watch
```

### Step 2: Install Node.js and pnpm

```bash
# Node.js をインストール (Windows)
# https://nodejs.org/ からインストーラーをダウンロード

# または nvm を使用 (macOS/Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22

# pnpm をインストール
npm install -g pnpm@11.1.1
```

### Step 3: Create Tauri Project

```bash
# Tauri CLI をインストール
cargo install tauri-cli

# 新しいプロジェクトを作成
cargo tauri init

# または Tauri テンプレートを使用
pnpm create tauri-app
```

### Step 4: Install Frontend Dependencies

```bash
# プロジェクトディレクトリに移動
cd vyline

# 依存関係をインストール
pnpm install

# React と関連パッケージ
pnpm add react@19.2.6 react-dom@19.2.6
pnpm add -D @types/react@19.2.6 @types/react-dom@19.2.6

# TypeScript
pnpm add -D typescript@6.0

# Vite
pnpm add -D vite@8.0

# TailwindCSS 4.0
pnpm add -D tailwindcss@4.0 postcss autoprefixer

# Zustand
pnpm add zustand@5.0.13

# TanStack Query
pnpm add @tanstack/react-query@5.100.10

# Motion (Framer Motion)
pnpm add motion@12.38.0

# React Hook Form + Zod
pnpm add react-hook-form@7.53.0
pnpm add -D @hookform/resolvers zod@3.23.8

# TanStack Virtual
pnpm add @tanstack/react-virtual@3.10.0

# Testing
pnpm add -D vitest@4.1.6 @testing-library/react@16.3.2 @testing-library/jest-dom
pnpm add -D @playwright/test@1.59.0

# ESLint + Prettier
pnpm add -D eslint prettier eslint-config-prettier
pnpm add -D @typescript-eslint/parser @typescript-eslint/eslint-plugin
pnpm add -D eslint-plugin-react-hooks
```

### Step 5: Install Rust Dependencies

```bash
# src-tauri/Cargo.toml に以下を追加

[dependencies]
tokio = { version = "1.40", features = ["full"] }
reqwest = { version = "0.13", features = ["json"] }
serde = { version = "1.0.200", features = ["derive"] }
serde_json = "1.0"
tungstenite = "0.29.0"
tokio-tungstenite = "0.24.0"
sea-orm = { version = "2.0", features = ["sqlx-sqlite", "runtime-tokio-rustls", "macros"] }
rusqlite = { version = "0.32", features = ["bundled"] }
moka = { version = "0.12", features = ["future"] }
axum = "0.8"
anyhow = "1.0"
thiserror = "1.0"
tracing = "0.1.40"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
config = "0.14"
clap = { version = "4.5", features = ["derive"] }
```

### Step 6: Configure TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### Step 7: Configure Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
});
```

### Step 8: Configure TailwindCSS 4.0

```css
/* src/styles/globals.css */
@import "tailwindcss";

:root {
  --vy-accent-primary: #5865f2;
  --vy-bg-primary: #101114;
  --vy-bg-secondary: #1b1d23;
  --vy-text-primary: #ffffff;
  --vy-text-secondary: #b5bac1;
}

body {
  background: var(--vy-bg-primary);
  color: var(--vy-text-primary);
}
```

### Step 9: Configure Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Step 10: Configure ESLint

```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "ecmaFeatures": {
      "jsx": true
    }
  },
  "plugins": ["@typescript-eslint", "react-hooks"],
  "rules": {
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

### Step 11: Configure Prettier

```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

### Step 12: Run Development Server

```bash
# 開発サーバーを起動
pnpm tauri dev

# またはフロントエンドのみ
pnpm dev

# Rust バックエンドのみ
cd src-tauri
cargo run
```

### Step 13: Build for Production

```bash
# プロダクションビルド
pnpm tauri build

# 特定プラットフォーム向けビルド
pnpm tauri build --target x86_64-pc-windows-msvc
pnpm tauri build --target x86_64-apple-darwin
pnpm tauri build --target x86_64-unknown-linux-gnu
```

### Step 14: Run Tests

```bash
# フロントエンドテスト
pnpm test

# E2E テスト
pnpm test:e2e

# Rust テスト
cd src-tauri
cargo test

# すべてのテスト
pnpm test:all
```

### Step 15: Verify Installation

```bash
# バージョン確認
node --version  # 22.x
pnpm --version  # 11.1.1
rustc --version # 1.95.0
cargo --version # 1.95.0

# プロジェクトが正常に動作するか確認
pnpm tauri dev
```

### Troubleshooting

#### Rust インストールエラー

```bash
# Rustup の再インストール
rustup self uninstall
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### Node.js バージョンエラー

```bash
# nvm を使用してバージョンを切り替え
nvm install 22
nvm use 22
```

#### pnpm エラー

```bash
# pnpm の再インストール
npm uninstall -g pnpm
npm install -g pnpm@11.1.1
```

#### Tauri ビルドエラー

```bash
# Tauri CLI の再インストール
cargo uninstall tauri-cli
cargo install tauri-cli

# 依存関係の更新
pnpm install
cd src-tauri
cargo update
```

---

## Migration Strategy

### Phase 1: Foundation

1. プロジェクトセットアップ
2. 基本的な Tauri + React 構成
3. TypeScript 設定
4. ESLint + Prettier 設定

### Phase 2: Core Features

1. Rust バックエンド実装
2. IPC 通信確立
3. 基本的な UI コンポーネント
4. ストレージレイヤー実装

### Phase 3: Advanced Features

1. Plugin System 実装
2. Theme Engine 実装
3. Event Bus 実装
4. パフォーマンス最適化

### Phase 4: Polish

1. テストカバレッジ向上
2. ドキュメント充実
3. CI/CD 設定
4. リリース準備

---

## Decision Matrix

### Frontend Framework Decision

| Framework | Performance | DX | Ecosystem | Bundle Size | Score |
|-----------|-------------|----|-----------|-------------|-------|
| React | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | **20** |
| SolidJS | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 19 |
| Svelte | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 19 |

### State Management Decision

| Library | Bundle Size | DX | TypeScript | Score |
|---------|-------------|----|------------|-------|
| Zustand | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **15** |
| Redux Toolkit | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 12 |
| Jotai | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 14 |

---

## Conclusion

この技術スタックは、Vyline の目標である「軽量・高速・拡張可能」なコミュニケーションプラットフォームを実現するために選定されました。

各技術は以下の基準に基づいて選ばれています：

- パフォーマンス
- 開発者体験
- エコシステムの成熟度
- 長期的な保守性

プロジェクトの進行に合わせて、必要に応じて技術スタックを見直していきます。

---

*This document will be updated as the project evolves.*
