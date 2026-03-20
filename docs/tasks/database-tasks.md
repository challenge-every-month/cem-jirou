# データベース接続・バージョンAPI 構築タスク

## 概要
Cloudflare D1 (SQLite) のセットアップ、スキーマ定義、および Hono による API エンドポイントの実装作業手順を定義する。

## タスク一覧

### フェーズ 1: データベース (D1) のプロビジョニング
- [ ] TASK-301: `wrangler d1 create database-name` でデータベースを作成
- [ ] TASK-302: `wrangler.toml` に D1 バインディング設定を追加
- [ ] TASK-303: `schema.sql` の作成（version テーブル定義）
- [ ] TASK-304: ローカル環境での `wrangler d1 execute` によるマイグレーション実行確認

### フェーズ 2: API (Hono) の実装
- [ ] TASK-401: Hono の型定義 (`Bindings`) への D1 バインディングの追加
- [ ] TASK-402: `GET /version` エンドポイントの実装（DB 取得）
- [ ] TASK-403: `POST /version` エンドポイントの実装（DB 更新）

### フェーズ 3: 品質管理・検証
- [ ] TASK-501: DB 操作を含む Vitest テスト (`tests/version.test.ts`) の作成
- [ ] TASK-502: `pnpm dev` を用いたローカル環境での実機確認
- [ ] TASK-503: 本番環境 (D1 remote) へのデプロイと動作確認

### フェーズ 4: 最終確認
- [ ] TASK-601: ロードマップの更新と、次ステップ（Slack 連携）へのブリッジ作成

## 進行状況
- **未着手**: 100%
- **開発中**: 0%
- **完了**: 0%
