# インフラストラクチャ 設計書

## 概要
本プロジェクトの基盤となる Hono + Vite 8 + Cloudflare Workers の構成を定義する。
従来の `create-cloudflare` スキャフォールディングをベースにしつつ、Vite 8 の最新機能を活用し、pnpm に最適化した構成にする。

## アーキテクチャ図
```mermaid
flowchart TD
    subgraph Local
        A[src/index.ts (Hono)] --> B[Vite 8 (Build/Dev)]
        B --> C[Vitest (Test)]
    end
    subgraph Cloudflare
        B --> D[Wrangler]
        D --> E[Cloudflare Workers]
        E --> F[Users]
    end
    subgraph Project_Rules
        G[.agents/] --> A
        G --> B
    end
```

## 主要コンポーネント

### 1. アプリケーション層 (Hono)
- **エントリーポイント**: `src/index.ts`
- **特徴**: 軽量、マルチランタイム対応。Cloudflare Workers への最適化が強力。
- **ボイラープレート**: 標準的な `new Hono()` 構成に加え、Slack App 開発を見越したミドルウェアの拡張性を確保する。

### 2. ビルド・開発エンジン (Vite 8)
- **設定ファイル**: `vite.config.ts`
- **プラグイン**: `@cloudflare/vitest-pool-workers` (Workers 環境でのテスト用)
- **役割**: TypeScript のトランスパイル、ホットリロード、デプロイ用バンドルの生成。

### 3. デプロイ・実行環境 (Cloudflare Workers)
- **設定ファイル**: `wrangler.toml`
- **ツール**: `wrangler` CLI
- **役割**: ローカルエミュレーション (Wrangler dev) および、本番環境への安全なデプロイ。

## ファイル構成
```text
/
├── .agents/ (SSoT)
├── docs/ (スペック・設計)
├── src/
│   └── index.ts (Hono Main)
├── tests/
│   └── index.test.ts (Vitest)
├── package.json (Scripts, Deps)
├── tsconfig.json (TS Config)
├── vite.config.ts (Vite Config)
└── wrangler.toml (Cloudflare Config)
```

## 依存関係 (主要ライブラリ)
- **hono**: コアフレームワーク
- **vite**: ビルドツール
- **wrangler**: Cloudflare デプロイ
- **vitest**: テストランナー

## 実行フロー (開発時)
1. `pnpm dev`: Vite サーバが起動し、Wrangler を通じてローカルで Cloudflare Workers 環境をエミュレートする。
2. `pnpm build`: Vite 8 が Workers 用に単一のJSファイルを生成する。
3. `pnpm deploy`: Wrangler が生成されたファイルを Cloudflare にアップロードする。
