# 技術要件 (Technical Requirements)

## 1. システム構成
Cloudflareのサーバーレスエコシステムをフル活用し、低コスト・高パフォーマンス・ゼロメンテナンスな運用を目指します。

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Background Tasks**: `c.executionCtx.waitUntil()` & Cloudflare Queues
- **Scheduled Tasks**: Cloudflare Cron Triggers (リマインダー送付用)

## 2. インフラストラクチャ
### 2.1 Slack API 連携
- **Endpoint**: HonoによるWebhookエンドポイント。
- **Response Time**: Slackの3秒制限を遵守するため、重い処理は `waitUntil` に逃がして即座に `200 OK` を返却。
- **Security**: `SLACK_SIGNING_SECRET` を用いた署名検証を Hono Middleware で実施。

### 2.2 データストレージ (D1)
SQLiteベースのマネージドデータベース。

#### テーブル設計 (案)
##### `challengers` (ユーザー)
| Column | Type | Description |
| :--- | :--- | :--- |
| id | INTEGER (PK) | 内部ID |
| slack_user_id | TEXT (UNIQUE) | SlackのユーザーID |
| user_name | TEXT | Slackの表示名 |
| created_at | DATETIME | 登録日時 |

##### `projects` (プロジェクト/月間目標のグループ)
| Column | Type | Description |
| :--- | :--- | :--- |
| id | INTEGER (PK) | 内部ID |
| challenger_id | INTEGER (FK) | `challengers.id` |
| title | TEXT | プロジェクト名 |
| target_month | TEXT | 対象月 (YYYY-MM) |
| status | TEXT | 'draft', 'published' |
| created_at | DATETIME | 作成日時 |

##### `challenges` (具体的なタスク)
| Column | Type | Description |
| :--- | :--- | :--- |
| id | INTEGER (PK) | 内部ID |
| project_id | INTEGER (FK) | `projects.id` |
| content | TEXT | 目標内容 |
| status | TEXT | 'pending', 'completed' |
| due_at | DATETIME | 完了予定日 |
| review_comment | TEXT | 振り返り時のコメント |
| created_at | DATETIME | 作成日時 |

## 3. 実装の要諦
### 3.1 Slack応答制限対策 (3秒ルール)
- **`c.executionCtx.waitUntil()`**: 
    - Slackへのレスポンス後に即座に行うDB更新などの処理。
    - リクエストコンテキスト内での実行となるため、短時間で終わる処理に限定。
- **Cloudflare Queues**:
    - リバース通知や、外部APIコールなどWorkersの実行制限を超える懸念がある非同期処理に使用。
- **Cron Triggers**:
    - 全ユーザーを対象とした定期的なリマインダーのスキャンと送信に使用。

## 4. データアクセス・運用
- **Migrations**: `wrangler d1 migrations` を使用してスキーマ管理をコード化。
- **CLI/GUI**: `wrangler d1 execute` による操作、またはダッシュボードのData Explorer。
- **Logging**: `wrangler tail` によるリアルタイムログ監視、または外部への `waitUntil` 転送。
