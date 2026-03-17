# インフラストラクチャ 構築タスク

## 概要
Vite 8 + Hono + Cloudflare Workers の開発基盤を構築するための作業手順を定義する。
各タスクは独立しており、逐次的に実行可能であることを目指す。

## タスク一覧

### フェーズ 1: コア環境の初期化
- [ ] TASK-001: `hono`, `vite`, `wrangler`, `vitest` を含む `package.json` の構成
- [ ] TASK-002: TypeScript の設定 (`tsconfig.json`) の最適化
- [ ] TASK-003: `wrangler.toml` の基本設定作成と環境変数の検証

### フェーズ 2: 開発・ビルドパイプラインの構築
- [ ] TASK-101: `vite.config.ts` の作成（Workers 用ビルド設定）
- [ ] TASK-102: 開発サーバ (`pnpm dev`) の起動確認
- [ ] TASK-103: ビルドスクリプト (`pnpm build`) の動作確認

### フェーズ 3: 品質管理（テスト）のセットアップ
- [ ] TASK-201: Vitest の設定（Workers 互換 Pool の設定）
- [ ] TASK-202: 基盤動作確認用のサンプルテスト (`tests/index.test.ts`) の作成
- [ ] TASK-203: `pnpm test` の実行確認

### フェーズ 4: ドキュメント維持と最終確認
- [ ] TASK-301: 実行後の `AGENTS.md` へ、新しい開発・テスト手順の追記
- [ ] TASK-302: 実装の振り返りと今後の拡張ポイントの特定

## 進行状況
- **未着手**: 100%
- **開発中**: 0%
- **完了**: 0%
