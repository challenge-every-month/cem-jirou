# 目標管理（Project / Challenge）要件定義書

## 概要

CEM メンバーが月次の目標を登録・編集・削除するための機能を定義する。
Slack コマンド `/cem_new` / `/cem_edit` / `/cem_delete` を入口とし、モーダルを通じて `projects` および `challenges` を操作する。

各 Project は特定の年月（`year` / `month`）に紐づく月次スナップショットとして管理する。
月をまたいで継続したい場合は、UI から複製して新しい月のレコードとして作成する。

> **Note**: ユーザー登録は Lazy Provision により自動処理される（[user-requirements.md](./user-requirements.md) 参照）。

## ユーザストーリー

### ストーリー1: 月次目標の登録

- **である** コミュニティメンバー **として**
- **私は** `/cem_new` から今月の Project と Challenge を登録したい
- **そうすることで** 今月やることを宣言・管理できる

### ストーリー2: 単発タスクの登録

- **である** コミュニティメンバー **として**
- **私は** Project を意識せずに単発の Challenge だけ登録したい
- **そうすることで** 細かい TODO をプロジェクト名の工夫なしに気軽に追加できる

### ストーリー3: 目標の修正

- **である** コミュニティメンバー **として**
- **私は** `/cem_edit` で登録済みの Project / Challenge を修正したい
- **そうすることで** 月初に立てた計画を実態に合わせてアップデートできる

### ストーリー4: 目標の削除

- **である** コミュニティメンバー **として**
- **私は** `/cem_delete` で不要になった Project / Challenge を削除したい
- **そうすることで** 月次のリストをきれいに保てる

### ストーリー5: 来月への引き継ぎ

- **である** コミュニティメンバー **として**
- **私は** 今月の Project / Challenge を来月分として複製したい
- **そうすることで** 継続したい目標を一から入力し直す手間を省ける

## データモデル

```
user_preferences
- id, user_id (FK, UNIQUE)
- markdown_mode      (BOOLEAN, DEFAULT FALSE)  ← /cem_new の入力モード
- personal_reminder  (BOOLEAN, DEFAULT FALSE)  ← 個人DM通知のオプトイン
- viewed_year        (INTEGER, DEFAULT NULL)   ← App Home 表示月（NULL=現在月）
- viewed_month       (INTEGER, DEFAULT NULL)
- created_at, updated_at

projects
- id, user_id (FK), title
- year (INTEGER), month (INTEGER)
- status: draft | published | reviewed
- is_inbox (BOOLEAN)  ← Project 未指定時の受け皿
- created_at, updated_at

challenges
- id, project_id (FK), name
- status: draft | not_started | in_progress | completed | incompleted
- due_on (DATE, nullable)
- review_comment (TEXT, nullable)
- created_at, updated_at
```

## 機能要件（EARS記法）

### 通常要件

- REQ-PRJ-000: システムは Lazy Provision 時に、`user_preferences` レコードをデフォルト値（`markdown_mode=false`、`personal_reminder=false`）で自動作成しなければならない
- REQ-PRJ-001: システムは `POST /projects` リクエストに対して、指定された `year` / `month` に紐づく Project レコードを作成しなければならない
- REQ-PRJ-002: システムは `POST /projects/:id/challenges` リクエストに対して、指定 Project に紐づく Challenge レコードを作成しなければならない
- REQ-PRJ-003: システムは `GET /projects?year=&month=` リクエストに対して、対象ユーザーの指定年月の Project 一覧（Challenge を含む）を返さなければならない
- REQ-PRJ-004: システムは `PATCH /projects/:id` リクエストに対して、Project の `title` / `status` を更新しなければならない
- REQ-PRJ-005: システムは `PATCH /challenges/:id` リクエストに対して、Challenge の `name` / `due_on` / `status` / `review_comment` を更新しなければならない
- REQ-PRJ-006: システムは `DELETE /projects/:id` リクエストに対して、Project および配下の Challenge を全て削除しなければならない
- REQ-PRJ-007: システムは `DELETE /challenges/:id` リクエストに対して、指定 Challenge のみを削除しなければならない

### 条件付き要件

- REQ-PRJ-101: `/cem_new` モーダルで Project タイトルが空欄の場合、システムは `is_inbox=true` の Project（その月に未作成なら自動作成）に Challenge を紐づけなければならない
- REQ-PRJ-102: `is_inbox=true` の Project がその年月に存在しない場合、システムは Challenge 登録と同時に自動作成しなければならない
- REQ-PRJ-103: 他ユーザーが所有する Project / Challenge への操作リクエストがあった場合、システムは `403 Forbidden` を返さなければならない
- REQ-PRJ-104: 存在しない Project / Challenge ID へのリクエストがあった場合、システムは `404 Not Found` を返さなければならない
- REQ-PRJ-105: `reviewed` 状態の Project への編集・削除リクエストがあった場合、システムは `409 Conflict` を返しエラーメッセージを通知しなければならない
- REQ-PRJ-106: Project を削除する際に配下に Challenge が存在する場合、システムは確認ダイアログを表示した上で cascade 削除しなければならない

### 状態要件

- REQ-PRJ-201: Challenge の `status` が `not_started` / `in_progress` / `completed` / `incompleted` のいずれかである場合、システムは `/cem_publish` 以降の操作として扱い、`draft` への巻き戻しを禁止しなければならない

### オプション要件

- REQ-PRJ-301: システムは今月の Project / Challenge を翌月（または任意の年月）に複製する機能を提供してもよい

### 制約要件

- REQ-PRJ-401: `year` は 2020 以上の整数、`month` は 1〜12 の整数でなければならない
- REQ-PRJ-402: Project の `title` は 100 文字以内でなければならない
- REQ-PRJ-403: Challenge の `name` は 200 文字以内でなければならない
- REQ-PRJ-404: 1 Project あたりの Challenge 数は 20 件以内とする
- REQ-PRJ-405: Slack コマンドへのレスポンス（モーダルオープン）は 3 秒以内に完了しなければならない

### `/cem_new` モーダル入力仕様

`user_preferences.markdown_mode` の値によってモーダルの UI が切り替わる。

**標準モード（`markdown_mode=false`、デフォルト）**
- Project タイトル入力欄（任意）
- Challenge 入力欄（複数行、1行1件）
- 各 Challenge の期日ピッカー（任意）

**マークダウンモード（`markdown_mode=true`）**
- 単一の大きなテキストエリア
- 以下のフォーマットで入力：

```
# Project タイトル（省略時は inbox 扱い）
- Challenge 名 @due
- Challenge 名

# 別の Project
- Challenge 名 @due
```

**インライン期日（`@`）パース仕様**

| 記法 | 解釈 | 例 |
|------|------|----|
| `@15` | 対象年月の 15 日 | `@15` → `2026-03-15` |
| `@03-15` | 対象年の 3 月 15 日 | `@03-15` → `2026-03-15` |
| `@2026-03-15` | 完全指定 | そのまま |

- REQ-PRJ-406: マークダウンモードのテキストは上記パース仕様に従い、Project / Challenge / due_on に分解されなければならない
- REQ-PRJ-407: `PATCH /users/:slack_user_id/preferences` リクエストで `markdown_mode` を切り替えられなければならない

## 非機能要件

### パフォーマンス

- NFR-PRJ-001: Project 一覧取得（Challenge 含む）は 300ms 以内に完了しなければならない
- NFR-PRJ-002: Project / Challenge の作成・更新・削除は 200ms 以内に完了しなければならない

### セキュリティ

- NFR-PRJ-101: 全リクエストは Slack 署名検証を通過しなければならない
- NFR-PRJ-102: ユーザーは自分の Project / Challenge のみ操作可能でなければならない

### 保守性

- NFR-PRJ-201: Project / Challenge 操作ロジックは `src/handlers/projects/` および `src/handlers/challenges/` に分離しなければならない

## Edge ケース

### エラー処理

- EDGE-PRJ-001: モーダル送信後に DB 書き込みが失敗した場合、Slack にエラーメッセージをエフェメラル通知する
- EDGE-PRJ-002: 同一年月・同一タイトルの Project が既に存在する場合は警告を出すが、作成は許可する（タイトル重複は禁止しない）

### 境界値

- EDGE-PRJ-101: `month=0` や `month=13` など不正な年月値は `400 Bad Request` とする
- EDGE-PRJ-102: Challenge が 0 件の Project は作成を許可する（後から追加可能）

## 受け入れ基準

### 機能テスト

- [ ] `/cem_new` 実行でモーダルが開き、Project + Challenge を登録できること
- [ ] Project タイトル空欄で登録すると `is_inbox=true` の Project に Challenge が追加されること
- [ ] 同月に2回 Project タイトル空欄で登録しても `is_inbox` Project が重複作成されないこと
- [ ] `GET /projects?year=2026&month=3` で当月の Project 一覧（Challenge 含む）が返ること
- [ ] `/cem_edit` で Project タイトル・Challenge 名・期日を変更できること
- [ ] `/cem_delete` で Project を削除すると配下の Challenge も削除されること
- [ ] 他ユーザーの Project への操作が `403` で拒否されること
- [ ] `reviewed` 状態の Project への編集が `409` で拒否されること

### 非機能テスト

- [ ] Project 一覧取得が 300ms 以内に完了すること
- [ ] Challenge 数が上限（20件）を超えた登録が拒否されること
- [ ] `markdown_mode=false`（デフォルト）で標準フォームモーダルが開くこと
- [ ] `markdown_mode=true` で単一テキストエリアのモーダルが開くこと
- [ ] `@15` / `@03-15` / `@2026-03-15` が正しく `due_on` にパースされること
- [ ] Lazy Provision 時に `user_preferences` が `markdown_mode=false` で自動作成されること
