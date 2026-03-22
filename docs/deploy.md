# CEM Jirou デプロイメントガイド

## 前提条件

- Cloudflare アカウント（Workers + D1 が使用可能なプラン）
- Slack App の作成済み（Bot Token, Signing Secret を取得済み）
- pnpm v10+ / Node.js LTS v22+

---

## 1. Cloudflare D1 データベースの作成

```bash
# D1 データベースを作成
pnpm wrangler d1 create cem-jirou
```

出力例:
```
✅ Successfully created DB 'cem-jirou'
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

`wrangler.toml` の `database_id` を取得した実際の ID に更新する:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cem-jirou"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← 実際のIDに変更
migrations_dir = "migrations"
```

### マイグレーションの適用

```bash
# 本番環境へ適用
pnpm wrangler d1 migrations apply cem-jirou

# ローカル確認用
pnpm wrangler d1 migrations apply cem-jirou --local
```

---

## 2. Cloudflare Secrets の設定

以下の3つのシークレットを Wrangler CLI で登録する:

```bash
# Slack Signing Secret（App の Basic Information から取得）
pnpm wrangler secret put SLACK_SIGNING_SECRET

# Slack Bot Token（OAuth & Permissions から取得、xoxb- で始まる）
pnpm wrangler secret put SLACK_BOT_TOKEN

# 投稿先の Slack チャンネル ID（チャンネルを右クリック → コピー → チャンネル ID）
pnpm wrangler secret put SLACK_POST_CHANNEL_ID
```

各コマンド実行後、プロンプトが表示されるので値を入力する。

### ローカル開発用 `.dev.vars`

ローカル開発時は `.dev.vars`（`.gitignore` 済み）に記載する:

```bash
# .dev.vars（リポジトリにコミットしないこと）
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_POST_CHANNEL_ID=C0XXXXXXXXX
```

---

## 3. デプロイ

```bash
pnpm deploy
```

デプロイ後、Workers のダッシュボードで URL を確認:
```
https://cem-jirou.<your-subdomain>.workers.dev
```

---

## 4. Slack App の設定

### Event Subscriptions

1. Slack App 管理画面 → **Event Subscriptions** → Enable
2. Request URL: `https://cem-jirou.<your-subdomain>.workers.dev/slack/events`
3. **Subscribe to bot events** に以下を追加:
   - `app_home_opened`

### Slash Commands

以下のスラッシュコマンドを登録:

| Command | Request URL | Description |
|---------|------------|-------------|
| `/cem_new` | `.../slack/commands` | 新規プロジェクト作成 |
| `/cem_publish` | `.../slack/commands` | プロジェクトを公開 |
| `/cem_progress` | `.../slack/commands` | 進捗報告 |
| `/cem_review` | `.../slack/commands` | 月末レビュー |
| `/cem_settings` | `.../slack/commands` | 設定変更 |

### Interactivity & Shortcuts

1. **Interactivity** → Enable
2. Request URL: `https://cem-jirou.<your-subdomain>.workers.dev/slack/interactions`

### App Home

1. **App Home** → Home Tab を **ON**
2. Allow users to send Slash commands from the messages tab → ON

### OAuth & Permissions — Bot Token Scopes

| Scope | 用途 |
|-------|------|
| `chat:write` | チャンネル投稿・DM送信 |
| `im:write` | DM を開始 |
| `users:read` | ユーザー情報取得 |
| `app_mentions:read` | メンション検知（将来拡張用） |

---

## 5. ローカル開発

```bash
# ローカル D1 + Wrangler dev サーバー起動
pnpm dev

# URL 検証チャレンジの確認（ngrok などでトンネリング後）
curl -X POST http://localhost:8787/slack/events \
  -H "Content-Type: application/json" \
  -d '{"type":"url_verification","challenge":"test123"}'
# → {"challenge":"test123"}
```

---

## 6. Cron トリガー確認

`wrangler.toml` に定義済みの6スケジュール（全て UTC、JST = UTC+9）:

| cron (UTC) | JST | 処理 |
|-----------|-----|------|
| `0 0 1 * *` | 毎月1日 9:00 | 月初チャンネル投稿 |
| `0 1 1 * *` | 毎月1日 10:00 | 月初個人DM |
| `0 0 15 * *` | 毎月15日 9:00 | 月中チャンネル投稿 |
| `0 0 25 * *` | 毎月25日 9:00 | 月末チャンネル投稿 |
| `0 1 25 * *` | 毎月25日 10:00 | 月末個人DM |
| `0 0 * * *` | 毎日 9:00 | 期日接近チェック |

### ローカルでの cron テスト

```bash
# Wrangler dev 起動中に別ターミナルで実行
pnpm wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+0+1+*+*"
```
