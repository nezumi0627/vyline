/**
 * scripts/build-landing.ts — GitHub Pages 用 Official Vyline Page 生成
 *
 * Swagger UI は nezumi0627.github.io/vyline-api に移設済み。
 * 出力先: <outdir>/index.html
 *
 * ページ上の機能表現は docs/feature-capabilities.md の evidence status に合わせ、
 * verified / partial / unverified を区別して過剰な完成表現を避ける。
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist-landing");
await mkdir(outDir, { recursive: true });
await Bun.write(
  join(outDir, "index.html"),
  `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0d100f" />
    <meta
      name="description"
      content="Vyline は Bun・Hono・React と独自 protocol stack で開発中のサードパーティ LINE クライアントです。Beta の現在地を evidence status とともに公開しています。"
    />
    <title>Vyline — Independent LINE client</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0d100f;
        --surface: #121614;
        --surface-raised: #171c19;
        --surface-soft: #101311;
        --line: #28312c;
        --line-strong: #39453f;
        --text: #f1f5f2;
        --muted: #a5afa9;
        --subtle: #7d8982;
        --accent: #78e08f;
        --accent-ink: #07100a;
        --accent-soft: rgba(120, 224, 143, 0.1);
        --warning: #e9cf8a;
        --warning-soft: rgba(233, 207, 138, 0.1);
        --unknown: #a8aeb8;
        --unknown-soft: rgba(168, 174, 184, 0.09);
        --shadow: 0 18px 60px rgba(0, 0, 0, 0.24);
        --radius-lg: 24px;
        --radius-md: 16px;
        --radius-sm: 11px;
        --page: min(1120px, calc(100% - 40px));
      }

      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }

      body {
        margin: 0;
        min-width: 320px;
        background:
          radial-gradient(circle at 78% 8%, rgba(120, 224, 143, 0.08), transparent 28rem),
          linear-gradient(180deg, #0f1311 0%, var(--bg) 30rem);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }

      a { color: inherit; }

      a:focus-visible,
      summary:focus-visible {
        outline: 3px solid rgba(120, 224, 143, 0.48);
        outline-offset: 4px;
        border-radius: 8px;
      }

      .skip-link {
        position: fixed;
        z-index: 100;
        top: 12px;
        left: 12px;
        transform: translateY(-180%);
        padding: 10px 14px;
        border-radius: 10px;
        background: var(--text);
        color: #0c0f0d;
        text-decoration: none;
        font-weight: 700;
      }

      .skip-link:focus { transform: translateY(0); }
      .shell { width: var(--page); margin: 0 auto; }

      .site-header {
        position: sticky;
        z-index: 20;
        top: 0;
        border-bottom: 1px solid rgba(40, 49, 44, 0.76);
        background: rgba(13, 16, 15, 0.82);
        backdrop-filter: blur(18px);
      }

      .header-inner {
        min-height: 72px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 11px;
        text-decoration: none;
        font-size: 1.02rem;
        font-weight: 760;
        letter-spacing: -0.01em;
      }

      .brand-mark {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 1px solid #41624b;
        border-radius: 9px;
        background: linear-gradient(145deg, #1d2b21, #121713);
        color: var(--accent);
        font-size: 0.8rem;
        font-weight: 850;
        box-shadow: inset 0 1px rgba(255, 255, 255, 0.05);
      }

      .beta {
        color: var(--subtle);
        font-size: 0.72rem;
        font-weight: 650;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      nav { display: flex; align-items: center; gap: 6px; }

      nav a {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        padding: 0 12px;
        border-radius: 9px;
        color: var(--muted);
        text-decoration: none;
        font-size: 0.9rem;
        font-weight: 620;
      }

      nav a:hover { background: rgba(255, 255, 255, 0.035); color: var(--text); }

      nav .github-link {
        margin-left: 5px;
        border: 1px solid var(--line-strong);
        color: var(--text);
      }

      main { overflow: hidden; }

      .hero {
        padding: 112px 0 88px;
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
        gap: 74px;
        align-items: center;
      }

      .eyebrow {
        margin: 0 0 22px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #b9c2bc;
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.045em;
        text-transform: uppercase;
      }

      .eyebrow::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 0 5px var(--accent-soft);
      }

      h1, h2, h3, p { margin-top: 0; }

      h1 {
        max-width: 760px;
        margin-bottom: 24px;
        font-size: clamp(3.1rem, 7vw, 6.6rem);
        line-height: 0.94;
        letter-spacing: -0.065em;
        font-weight: 780;
      }

      @media (min-width: 861px) {
        .hero-tail { display: block; white-space: nowrap; }
      }

      .hero-copy {
        max-width: 670px;
        margin-bottom: 32px;
        color: var(--muted);
        font-size: clamp(1rem, 2vw, 1.16rem);
      }

      .actions { display: flex; flex-wrap: wrap; gap: 10px; }

      .button {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 17px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius-sm);
        background: var(--surface-raised);
        color: var(--text);
        text-decoration: none;
        font-size: 0.92rem;
        font-weight: 700;
        transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
      }

      .button:hover { transform: translateY(-1px); border-color: #56665d; }

      .button.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: var(--accent-ink);
      }

      .button.primary:hover { background: #8be9a0; }
      .hero-note { margin: 18px 0 0; color: var(--subtle); font-size: 0.78rem; }

      .status-panel {
        position: relative;
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: linear-gradient(180deg, rgba(23, 28, 25, 0.96), rgba(16, 19, 17, 0.95));
        padding: 18px;
        box-shadow: var(--shadow);
      }

      .status-panel::before {
        content: "";
        position: absolute;
        inset: -1px;
        z-index: -1;
        border-radius: inherit;
        background: linear-gradient(140deg, rgba(120, 224, 143, 0.22), transparent 44%);
      }

      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 4px 3px 16px;
      }

      .panel-title { color: #d8dfda; font-size: 0.84rem; font-weight: 720; }
      .panel-caption { color: var(--subtle); font-size: 0.75rem; }
      .status-list { display: grid; gap: 9px; }

      .status-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 14px;
        align-items: center;
        min-height: 66px;
        padding: 13px 14px;
        border: 1px solid rgba(57, 69, 63, 0.58);
        border-radius: 13px;
        background: rgba(11, 14, 12, 0.55);
      }

      .status-row strong { display: block; font-size: 0.9rem; }
      .status-row small { display: block; margin-top: 2px; color: var(--subtle); font-size: 0.75rem; }

      .chip {
        min-width: 80px;
        display: inline-flex;
        justify-content: center;
        padding: 5px 9px;
        border: 1px solid;
        border-radius: 999px;
        font-size: 0.69rem;
        font-weight: 760;
        letter-spacing: 0.025em;
      }

      .verified { border-color: rgba(120, 224, 143, 0.32); background: var(--accent-soft); color: #9cebac; }
      .partial { border-color: rgba(233, 207, 138, 0.28); background: var(--warning-soft); color: var(--warning); }
      .unverified { border-color: rgba(168, 174, 184, 0.25); background: var(--unknown-soft); color: #c3c8d0; }
      .section { padding: 86px 0; }

      .section-kicker {
        margin-bottom: 12px;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 760;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h2 {
        max-width: 760px;
        margin-bottom: 16px;
        font-size: clamp(2rem, 4vw, 3.2rem);
        line-height: 1.08;
        letter-spacing: -0.04em;
      }

      .section-lead { max-width: 700px; color: var(--muted); }

      .grid-3 {
        margin-top: 36px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 13px;
      }

      .card {
        min-height: 220px;
        padding: 24px;
        border: 1px solid var(--line);
        border-radius: var(--radius-md);
        background: rgba(18, 22, 20, 0.82);
      }

      .card-index {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        margin-bottom: 42px;
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 800;
      }

      .card h3 { margin-bottom: 8px; font-size: 1.02rem; }
      .card p { margin-bottom: 0; color: var(--muted); font-size: 0.89rem; }

      .evidence {
        display: grid;
        grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr);
        gap: 48px;
        align-items: start;
      }

      .evidence-table {
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: var(--radius-md);
        background: var(--surface-soft);
      }

      .evidence-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 18px;
        align-items: center;
        min-height: 88px;
        padding: 17px 18px;
        border-bottom: 1px solid var(--line);
      }

      .evidence-item:last-child { border-bottom: 0; }
      .evidence-item strong { display: block; font-size: 0.93rem; }
      .evidence-item span.description { display: block; margin-top: 3px; color: var(--subtle); font-size: 0.8rem; }

      .security-box {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: var(--surface);
      }

      .security-copy { padding: 40px; }
      .security-copy p { color: var(--muted); }
      .check-list { margin: 28px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
      .check-list li { position: relative; padding-left: 25px; color: #d5ddd7; font-size: 0.9rem; }
      .check-list li::before { content: "✓"; position: absolute; left: 0; color: var(--accent); font-weight: 850; }

      .report-preview {
        min-height: 100%;
        padding: 34px;
        border-left: 1px solid var(--line);
        background: #0a0d0b;
        color: #bcc7c0;
        font: 0.78rem/1.72 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      .report-preview .dim { color: #647069; }
      .report-preview .safe { color: #8ee6a2; }

      .cta {
        margin: 20px 0 94px;
        padding: 42px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 26px;
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: linear-gradient(135deg, #172019, #101411 58%);
      }

      .cta h2 { margin-bottom: 9px; font-size: clamp(1.65rem, 3vw, 2.4rem); }
      .cta p { margin-bottom: 0; color: var(--muted); }
      .cta .actions { flex-shrink: 0; }
      footer { border-top: 1px solid var(--line); }

      .footer-inner {
        min-height: 100px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        color: var(--subtle);
        font-size: 0.78rem;
      }

      .footer-links { display: flex; flex-wrap: wrap; gap: 16px; }
      .footer-links a { color: var(--muted); text-decoration: none; }
      .footer-links a:hover { color: var(--text); }

      @media (max-width: 860px) {
        :root { --page: min(100% - 30px, 720px); }
        .header-inner { min-height: 66px; }
        nav a:not(.github-link) { display: none; }
        .hero { grid-template-columns: 1fr; gap: 42px; padding: 82px 0 72px; }
        h1 { max-width: 680px; }
        .status-panel { max-width: 620px; }
        .grid-3 { grid-template-columns: 1fr; }
        .card { min-height: 0; }
        .card-index { margin-bottom: 28px; }
        .evidence { grid-template-columns: 1fr; }
        .security-box { grid-template-columns: 1fr; }
        .report-preview { border-left: 0; border-top: 1px solid var(--line); }
        .cta { align-items: flex-start; flex-direction: column; }
      }

      @media (max-width: 520px) {
        :root { --page: calc(100% - 24px); }
        .site-header { position: static; }
        .beta { display: none; }
        nav .github-link { min-height: 40px; padding: 0 11px; }
        .hero { padding-top: 64px; }
        h1 { font-size: clamp(2.75rem, 16vw, 4.4rem); }
        .button { width: 100%; }
        .status-row { grid-template-columns: 1fr; gap: 8px; }
        .chip { justify-self: start; }
        .section { padding: 66px 0; }
        .security-copy, .report-preview { padding: 26px 22px; }
        .cta { margin-bottom: 70px; padding: 28px 22px; }
        .footer-inner { padding: 28px 0; align-items: flex-start; flex-direction: column; }
      }

      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main">本文へ移動</a>
    <header class="site-header">
      <div class="shell header-inner">
        <a class="brand" href="#top" aria-label="Vyline トップへ">
          <span class="brand-mark" aria-hidden="true">V</span>
          <span>Vyline</span>
          <span class="beta">Beta</span>
        </a>
        <nav aria-label="メインナビゲーション">
          <a href="#product">Product</a>
          <a href="#evidence">Evidence</a>
          <a href="#diagnostics">Diagnostics</a>
          <a href="https://nezumi0627.github.io/vyline-api/">API Docs</a>
          <a class="github-link" href="https://github.com/nezumi0627/vyline">GitHub ↗</a>
        </nav>
      </div>
    </header>

    <main id="main">
      <section class="shell hero" id="top" aria-labelledby="hero-title">
        <div>
          <p class="eyebrow">Independent LINE client · Beta</p>
          <h1 id="hero-title">LINEを、もっと<span class="hero-tail">自分の環境に。</span></h1>
          <p class="hero-copy">
            Vyline は Bun・Hono・React と独自の protocol stack で開発中のサードパーティクライアントです。
            できることだけでなく、まだ検証中のことも evidence status と一緒に公開します。
          </p>
          <div class="actions">
            <a class="button primary" href="https://github.com/nezumi0627/vyline">GitHubで見る ↗</a>
            <a class="button" href="https://nezumi0627.github.io/vyline-api/">API Docs</a>
          </div>
          <p class="hero-note">Vyline は LINE の公式クライアントではありません。機能互換性を保証するものではありません。</p>
        </div>

        <aside class="status-panel" aria-label="現在の機能エビデンス">
          <div class="panel-head">
            <span class="panel-title">Current evidence</span>
            <span class="panel-caption">Beta / live development</span>
          </div>
          <div class="status-list">
            <div class="status-row">
              <div><strong>Diagnostics</strong><small>保存・共有・Issue導線</small></div>
              <span class="chip verified">Verified</span>
            </div>
            <div class="status-row">
              <div><strong>Core messaging</strong><small>複数経路を継続検証中</small></div>
              <span class="chip partial">Partial</span>
            </div>
            <div class="status-row">
              <div><strong>Media / E2EE</strong><small>対応範囲を継続拡張中</small></div>
              <span class="chip partial">Partial</span>
            </div>
            <div class="status-row">
              <div><strong>OpenChat / Square</strong><small>公開互換性は未確認</small></div>
              <span class="chip unverified">Unverified</span>
            </div>
          </div>
        </aside>
      </section>

      <section class="section" id="product" aria-labelledby="product-title">
        <div class="shell">
          <p class="section-kicker">Product language</p>
          <h2 id="product-title">静かで、読みやすく、必要な情報だけ。</h2>
          <p class="section-lead">
            Vyline のUIは、派手さより長時間使える落ち着きと操作の分かりやすさを優先しています。
            デスクトップの Design Language と同じ考え方で、Web側も余白・状態・フォーカスを丁寧に扱います。
          </p>
          <div class="grid-3">
            <article class="card">
              <span class="card-index" aria-hidden="true">01</span>
              <h3>Fast iteration</h3>
              <p>Bun + Hono + React + Vite を中心に、実装から検証までの待ち時間を小さく保つ構成です。</p>
            </article>
            <article class="card">
              <span class="card-index" aria-hidden="true">02</span>
              <h3>Own protocol layer</h3>
              <p><code>@vyline/protocol</code> を境界に、Desktop evidence と実装を対応付けながら開発しています。</p>
            </article>
            <article class="card">
              <span class="card-index" aria-hidden="true">03</span>
              <h3>Calm interface</h3>
              <p>共有コンポーネント、安定した狭幅表示、キーボードフォーカスを重視し、装飾は必要な場所だけに絞ります。</p>
            </article>
          </div>
        </div>
      </section>

      <section class="section" id="evidence" aria-labelledby="evidence-title">
        <div class="shell evidence">
          <div>
            <p class="section-kicker">Evidence first</p>
            <h2 id="evidence-title">「ある」ではなく、「どこまで確か」を書く。</h2>
            <p class="section-lead">
              Beta の機能表現は evidence matrix を基準にします。実装が存在しても、実機や再現条件まで確認できていない機能を
              完成扱いにはしません。
            </p>
          </div>
          <div class="evidence-table" role="list" aria-label="Evidence status の説明">
            <div class="evidence-item" role="listitem">
              <div><strong>Diagnostics / Issue reporting</strong><span class="description">保存・削除・export・sanitization・GitHub Issue UX をテスト済み</span></div>
              <span class="chip verified">Verified</span>
            </div>
            <div class="evidence-item" role="listitem">
              <div><strong>Messaging / Media / E2EE</strong><span class="description">主要経路は実装済み。全条件の互換性は継続検証中</span></div>
              <span class="chip partial">Partial</span>
            </div>
            <div class="evidence-item" role="listitem">
              <div><strong>OpenChat / Square</strong><span class="description">調査・統合領域。公開互換性の確証が揃うまでは未検証扱い</span></div>
              <span class="chip unverified">Unverified</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section" id="diagnostics" aria-labelledby="diagnostics-title">
        <div class="shell security-box">
          <div class="security-copy">
            <p class="section-kicker">Diagnostics</p>
            <h2 id="diagnostics-title">不具合報告は、共有する前に整える。</h2>
            <p>
              内部ログと共有用診断情報を分け、共有向けデータは保存時・共有時の両方で sanitization を通します。
              アカウント単位の分離、保持期間、ローテーション、削除・export にも対応します。
            </p>
            <ul class="check-list">
              <li>Diagnostics の ON / OFF と保持設定を永続化</li>
              <li>起動・再起動イベントを記録し、アカウント単位で分離</li>
              <li>secret / token / path / address 系の共有前 redaction</li>
              <li>Issue preview・copy・GitHub prefill と長文 fallback</li>
            </ul>
          </div>
          <div class="report-preview" aria-label="サニタイズ済み診断情報のイメージ">
            <div><span class="dim">03:08:12</span> diagnostics.startup</div>
            <div>account = <span class="safe">anon:7f2…</span></div>
            <div>level = info</div>
            <br />
            <div><span class="dim">03:08:14</span> backend.request</div>
            <div>session = <span class="safe">[REDACTED]</span></div>
            <div>token = <span class="safe">[REDACTED]</span></div>
            <div>path = <span class="safe">[REDACTED_PATH]</span></div>
            <br />
            <div><span class="dim">shareable:</span> <span class="safe">ready</span></div>
          </div>
        </div>
      </section>

      <section class="shell cta" aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">コードも、現在地も、公開して進める。</h2>
          <p>導入方法・開発状況は GitHub から確認できます。API の入出力は Swagger UI で確認できます。</p>
        </div>
        <div class="actions">
          <a class="button primary" href="https://github.com/nezumi0627/vyline">Repository ↗</a>
          <a class="button" href="https://github.com/nezumi0627/vyline/issues">Issues</a>
        </div>
      </section>
    </main>

    <footer>
      <div class="shell footer-inner">
        <span>Vyline · independent third-party client project</span>
        <div class="footer-links">
          <a href="https://github.com/nezumi0627/vyline">GitHub</a>
          <a href="https://nezumi0627.github.io/vyline-api/">API Docs</a>
          <a href="https://github.com/nezumi0627/vyline/issues">Issues</a>
        </div>
      </div>
    </footer>
  </body>
</html>
`,
);
console.log(`Landing page generated at ${outDir}`);
