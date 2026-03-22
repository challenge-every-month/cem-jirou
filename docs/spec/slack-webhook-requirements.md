# Slack Webhook / Middleware 要件定義書

## 概要

Hono on Cloudflare Workers で Slack からのリクエストを受け付けるエンドポイントと Middleware を定義する。
元実装（`.legacy/cem-app`）は Slack Bolt + Express を使用していたが、本実装では Hono で署名検証・ルーティングを自前実装する。

**エンドポイント構成：**

```
POST /slack/commands      ← スラッシュコマンド
POST /slack/interactions  ← ボタン・モーダル等のインタラクション
POST /slack/events        ← Events API（app_home_opened 等）
scheduled handler         ← Cron Triggers（HTTP 非経由）
```

## 機能要件（EARS記法）

### Slack 署名検証 Middleware

- REQ-WH-001: `/slack/*` 配下の全エンドポイントに、Slack 署名検証 Middleware を適用しなければならない
- REQ-WH-002: Middleware は `X-Slack-Signature` と `X-Slack-Request-Timestamp` ヘッダーを検証しなければならない
- REQ-WH-003: タイムスタンプが現在時刻から ±5 分以上ずれている場合、`403 Forbidden` を返しリプレイアタックを防がなければならない
- REQ-WH-004: HMAC-SHA256（`v0:{timestamp}:{rawBody}`）を `SLACK_SIGNING_SECRET` で計算し、`X-Slack-Signature` と一致しない場合 `403 Forbidden` を返さなければならない
- REQ-WH-005: Middleware は署名検証のために raw body（未パース）を読み取らなければならない

### スラッシュコマンド（`POST /slack/commands`）

- REQ-WH-011: システムは `command` フィールドの値に応じて各ハンドラーにルーティングしなければならない

| command | ハンドラー |
|---------|-----------|
| `/cem_new` | Project / Challenge 登録モーダルを開く |
| `/cem_edit` | Multi-step 編集モーダルを開く |
| `/cem_delete` | 削除確認モーダルを開く |
| `/cem_publish` | 表明処理を実行 |
| `/cem_progress` | 進捗報告モーダルを開く |
| `/cem_review` | 振り返りモーダルを開く |
| `/cem_settings` | preferences 設定モーダルを開く |

- REQ-WH-012: スラッシュコマンドへのレスポンスは **3 秒以内** に `200 OK` を返さなければならない
- REQ-WH-013: モーダルを開く処理は `views.open` API を同期的に呼び出さなければならない（3 秒以内に完了させる必要があるため）
- REQ-WH-014: DB 書き込みなど重い処理は `c.executionCtx.waitUntil()` に逃がし、レスポンス後に非同期実行しなければならない
- REQ-WH-015: 未知のコマンドが届いた場合、`unknown command` とエフェメラル通知して `200 OK` を返さなければならない

### インタラクション（`POST /slack/interactions`）

- REQ-WH-021: システムは `payload.type` に応じてハンドラーにルーティングしなければならない

| type | 用途 |
|------|------|
| `block_actions` | ボタン・セレクト・オーバーフローメニュー |
| `view_submission` | モーダル送信 |
| `view_closed` | モーダルキャンセル |

- REQ-WH-022: `block_actions` は `action_id` のプレフィックスでハンドラーを振り分けなければならない
- REQ-WH-023: `view_submission` は `callback_id` でハンドラーを振り分けなければならない
- REQ-WH-024: インタラクションへのレスポンスも **3 秒以内** に `200 OK` を返さなければならない
- REQ-WH-025: App Home 再描画（`views.publish`）が必要な操作は、DB 更新後に `waitUntil()` 内で実行してもよい

### Events API（`POST /slack/events`）

- REQ-WH-031: Slack の URL 検証（`url_verification`）チャレンジに即時応答しなければならない
- REQ-WH-032: `app_home_opened` イベントを受信した場合、Lazy Provision を実行し App Home を描画しなければならない
- REQ-WH-033: Events API のリクエストには **3 秒以内** に `200 OK` を返し、処理は `waitUntil()` に逃がさなければならない

### 条件付き要件

- REQ-WH-101: Lazy Provision（ユーザー存在確認・作成）は、コマンド・インタラクション・イベント全ての入口で実行しなければならない
- REQ-WH-102: Slack が同一リクエストを再送してきた場合（`X-Slack-Retry-Num` ヘッダーが存在する場合）、`200 OK` を即時返却して処理をスキップしなければならない

### 制約要件

- REQ-WH-401: `SLACK_SIGNING_SECRET` と `SLACK_BOT_TOKEN` は Cloudflare Workers Secrets で管理し、コードにハードコードしてはならない
- REQ-WH-402: 署名検証には Web Crypto API（`crypto.subtle`）を使用しなければならない（Node.js の `crypto` モジュールは Workers では利用不可のため）
- REQ-WH-403: ルーティングロジックは `src/routes/slack.ts` に集約しなければならない
- REQ-WH-404: 署名検証 Middleware は `src/middleware/slack-verify.ts` として独立実装しなければならない

## ルーティング構成（実装方針）

```typescript
// src/index.ts
app.use('/slack/*', slackVerifyMiddleware)   // 署名検証

app.post('/slack/commands',      commandRouter)
app.post('/slack/interactions',  interactionRouter)
app.post('/slack/events',        eventRouter)

// scheduled ハンドラー（Cron Triggers）
export default {
  fetch: app.fetch,
  scheduled: cronHandler,
}
```

## 署名検証ロジック

```
1. タイムスタンプ検証
   |現在時刻 - X-Slack-Request-Timestamp| > 300秒 → 403

2. 署名計算
   basestring = "v0:{timestamp}:{rawBody}"
   expected  = "v0=" + HMAC-SHA256(SLACK_SIGNING_SECRET, basestring)

3. 比較（タイミング攻撃対策に timingSafeEqual を使用）
   expected !== X-Slack-Signature → 403
```

## 非機能要件

### パフォーマンス

- NFR-WH-001: 署名検証処理は 10ms 以内に完了しなければならない
- NFR-WH-002: スラッシュコマンド受信から `200 OK` 返却まで 3 秒以内に収めなければならない

### セキュリティ

- NFR-WH-101: 署名比較は定数時間比較（`timingSafeEqual` 相当）を使用し、タイミング攻撃を防がなければならない
- NFR-WH-102: エラーレスポンスに内部スタックトレースや詳細情報を含めてはならない

### 保守性

- NFR-WH-201: `action_id` / `callback_id` の命名規則を統一し、ルーティングを予測可能にしなければならない

## Edge ケース

- EDGE-WH-001: `SLACK_SIGNING_SECRET` が未設定の場合、起動時にエラーを throw してデプロイを失敗させる
- EDGE-WH-002: `views.open` が Slack 側のエラー（レート制限等）で失敗した場合、エフェメラル通知でユーザーに伝える
- EDGE-WH-003: リクエストボディのパースに失敗した場合（不正な JSON 等）、`400 Bad Request` を返す

## 受け入れ基準

- [ ] 署名が正しいリクエストは処理され、不正なリクエストは `403` で拒否されること
- [ ] タイムスタンプが 5 分以上古いリクエストが `403` で拒否されること
- [ ] Slack の `url_verification` チャレンジに正しく応答できること
- [ ] `X-Slack-Retry-Num` ヘッダー付きリクエストが即時 `200` でスキップされること
- [ ] `/cem_new` 等のスラッシュコマンドが 3 秒以内にモーダルを開けること
- [ ] App Home のボタン操作（block_actions）が正しくルーティングされること
- [ ] `app_home_opened` で初回アクセス時に Lazy Provision が実行されること
