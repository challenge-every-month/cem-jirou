# ユーザー管理 要件定義書

## 概要

CEM（Challenge Every Month）コミュニティ向けの小規模 Slack App として、ユーザー登録は明示的なコマンドを必要とせず、**Lazy Provision パターン**を採用する。
いずれかの `/cem_*` コマンドを初めて実行した時点、または App Home を初めて開いた時点で、Slack のユーザー情報を元に自動的にユーザーレコードを作成する。

> **Note**: ドメイン上の呼称は「挑戦者（Challenger）」だが、実装レイヤー（DB・API）では `users` / `User` を使用する。

## ユーザストーリー

### ストーリー1: 初回コマンド時の自動登録

- **である** 新規コミュニティメンバー **として**
- **私は** 登録手続きを意識せずにいきなり `/cem_new` などのコマンドを使いたい
- **そうすることで** 摩擦なく即座に CEM アプリを使い始められる

### ストーリー2: 2 回目以降の透過的な利用

- **である** 登録済みメンバー **として**
- **私は** コマンドを打つたびに自分のユーザーレコードが自動的に参照されてほしい
- **そうすることで** 登録状態を意識せずに目標管理に集中できる

## 機能要件（EARS記法）

### 通常要件

- REQ-USR-001: システムはいずれかの `/cem_*` コマンド受信時、`slack_user_id` を用いてユーザーの存在確認を行わなければならない
- REQ-USR-002: システムはユーザーが未登録の場合、自動的に `users` テーブルへレコードを作成しなければならない（Lazy Provision）
- REQ-USR-003: システムはユーザー作成時に `slack_user_id`・`user_name`・`created_at` を記録しなければならない
- REQ-USR-003a: システムはユーザー作成と同時に `user_preferences` レコードをデフォルト値で作成しなければならない（`markdown_mode=false`、`viewed_year=NULL`、`viewed_month=NULL`）
- REQ-USR-004: システムは `GET /users/:slack_user_id` リクエストに対して、該当ユーザーの登録情報を返さなければならない

### 条件付き要件

- REQ-USR-101: 同一 `slack_user_id` のユーザーが既に存在する場合、システムは新規作成せず既存レコードをそのまま使用しなければならない
- REQ-USR-102: Slack の署名検証（`SLACK_SIGNING_SECRET`）が失敗した場合、システムは `403 Forbidden` を返しリクエストを拒否しなければならない
- REQ-USR-103: `slack_user_id` がリクエストに含まれない場合、システムは `400 Bad Request` を返さなければならない
- REQ-USR-104: DB への書き込みが失敗した場合、システムは `500 Internal Server Error` を返しエラーを記録しなければならない

### 状態要件

- REQ-USR-201: Lazy Provision 処理（ユーザー検索 or 作成）は、各コマンドハンドラーの本処理より先に完了していなければならない

### 制約要件

- REQ-USR-401: `slack_user_id` はテーブル上で UNIQUE 制約を持たなければならない
- REQ-USR-402: Lazy Provision を含む DB 操作は `c.executionCtx.waitUntil()` ではなく、**コマンド処理の同期フロー内**で完了しなければならない（後続処理が `user_id` を必要とするため）
- REQ-USR-403: API レスポンスは JSON 形式で返さなければならない

## 非機能要件

### パフォーマンス

- NFR-USR-001: Lazy Provision（`SELECT` + 必要に応じて `INSERT`）は 100ms 以内に完了しなければならない
- NFR-USR-002: Slack コマンドへの全体レスポンスは Slack の 3 秒制限内に収まらなければならない

### セキュリティ

- NFR-USR-101: Slack リクエストは全て `SLACK_SIGNING_SECRET` による署名検証を通過しなければならない
- NFR-USR-102: ユーザーの内部 ID（`id`）は外部レスポンスに含めてはならない

## Edge ケース

### エラー処理

- EDGE-USR-001: `user_name` が空文字列または null の場合、`slack_user_id` をフォールバック名として使用する
- EDGE-USR-002: 並行リクエストによる UNIQUE 制約違反（race condition）は冪等処理として扱い、既存レコードを返す

### 境界値

- EDGE-USR-101: `user_name` が 255 文字を超える場合、255 文字に切り詰めて保存する
- EDGE-USR-102: `slack_user_id` が 255 文字を超える場合、`400 Bad Request` を返す

## 受け入れ基準

### 機能テスト

- [ ] 未登録ユーザーが `/cem_new` などを初めて実行すると、自動的に `users` レコードが作成されること
- [ ] 同一ユーザーが 2 回コマンドを実行しても、`users` レコードが重複作成されないこと
- [ ] `GET /users/:slack_user_id` で登録済みユーザーの情報が取得できること
- [ ] `GET /users/:slack_user_id` で未登録ユーザーを指定すると `404 Not Found` が返ること
- [ ] Slack 署名が不正なリクエストは `403 Forbidden` が返ること

### 非機能テスト

- [ ] Lazy Provision の DB 処理が 100ms 以内に完了すること
- [ ] レスポンスボディに内部 ID（`id`）が含まれないこと
