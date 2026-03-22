# 表明・進捗・振り返り 要件定義書

## 概要

月次チャレンジのライフサイクル（公開 → 進捗 → 振り返り）を管理する機能を定義する。
各ステップは App Home のボタン操作、またはスラッシュコマンドの両方から実行できる。
実行結果は指定の Slack チャンネルに投稿され、コミュニティ内での相互承認（ソーシャル・アカウンタビリティ）を促す。

**Challenge status ライフサイクル：**

```
draft → not_started → in_progress → completed
（publish 時）（進捗報告で）      ↘ incompleted（振り返りのみ）
```

**投稿チャンネル：** 環境変数 `SLACK_POST_CHANNEL_ID` で固定設定。

## ユーザストーリー

### ストーリー1: 月初の宣言

- **である** コミュニティメンバー **として**
- **私は** 今月のチャレンジをチャンネルで宣言したい
- **そうすることで** 周囲に目標を公言し、達成へのモチベーションを高められる

### ストーリー2: 月中の進捗報告

- **である** コミュニティメンバー **として**
- **私は** 月の半ばに各チャレンジの進捗状況を報告したい
- **そうすることで** 中間チェックポイントとして現状を把握し、後半の行動を調整できる

### ストーリー3: 月末の振り返り

- **である** コミュニティメンバー **として**
- **私は** 月末に各チャレンジの達成・未達成を確定し振り返りコメントを残したい
- **そうすることで** 月の成果を記録し、次月の計画に活かせる

## 機能要件（EARS記法）

### `/cem_publish` — 表明

- REQ-LFC-001: システムは `/cem_publish` 実行時、または App Home の [📣 今月を宣言する] 押下時に、該当ユーザーの `draft` 状態の Project を `published` に更新しなければならない
- REQ-LFC-002: システムは publish 時に、対象 Project 配下の全 Challenge の status を `not_started` に更新しなければならない
- REQ-LFC-003: システムは publish 時に、以下フォーマットの宣言メッセージを `SLACK_POST_CHANNEL_ID` に投稿しなければならない

```
{user_name} さんが {year}年{month}月の挑戦を表明しました

*{project_title}*
• {challenge_name_1}
• {challenge_name_2}
```

- REQ-LFC-004: `draft` 状態の Project が存在しない場合、システムは「公開できるプロジェクトがありません」とエフェメラル通知しなければならない

### `/cem_progress` — 進捗報告

- REQ-LFC-011: システムは App Home 上の各 Challenge（`not_started` / `in_progress` 状態）に [未着手] / [進行中] / [✅済] ボタンを表示しなければならない
- REQ-LFC-012: システムはボタン押下時に Challenge の status を更新し（`not_started` / `in_progress` / `completed`）、App Home を再描画しなければならない
- REQ-LFC-013: システムは各 Challenge の ⋮ メニューに「💬 コメントを追加」オプションを表示し、押下でコメント入力ミニモーダルを開かなければならない
- REQ-LFC-014: ミニモーダルで入力されたコメントは `challenges.progress_comment` に保存しなければならない
- REQ-LFC-015: システムは `/cem_progress` コマンド実行時に、全 `published` Project の Challenge 進捗をまとめたモーダルを開かなければならない
- REQ-LFC-016: `/cem_progress` モーダル送信時に、以下フォーマットの進捗メッセージをチャンネルに投稿しなければならない

```
{user_name} さんが {year}年{month}月の進捗を報告しました

*{project_title}*
🔴 {challenge_name}（未着手）
🔵 {challenge_name}（進行中）コメント
✅ {challenge_name}（達成済）
```

### `/cem_review` — 振り返り

- REQ-LFC-021: システムは `/cem_review` 実行時、または App Home の [📋 振り返りを完了する] 押下時に、`published` 状態の全 Project の Challenge を一覧するモーダルを開かなければならない
- REQ-LFC-022: モーダルは Challenge ごとに [✅ 達成] / [❌ 未達成] の選択と、Project ごとのレビューコメント（任意）入力フィールドを持たなければならない
- REQ-LFC-023: モーダル送信時に、各 Challenge の status を `completed` / `incompleted` に確定しなければならない
- REQ-LFC-024: モーダル送信時に、対象 Project の status を `reviewed` に更新しなければならない
- REQ-LFC-025: モーダル送信時に、以下フォーマットの振り返りメッセージをチャンネルに投稿しなければならない

```
{user_name} さんが {year}年{month}月の振り返りをしました

*{project_title}*
✅ {challenge_name}
❌ {challenge_name}
{review_comment}
```

- REQ-LFC-026: `published` 状態の Project が存在しない場合、「振り返り対象のプロジェクトがありません」とエフェメラル通知しなければならない

### 条件付き要件

- REQ-LFC-101: `/cem_publish` 実行時に今月のチャレンジが1件も存在しない場合、登録を促すエフェメラル通知を返しなければならない
- REQ-LFC-102: `/cem_review` でステータスが未選択の Challenge がある状態で送信した場合、「全チャレンジの達成・未達成を選択してください」と警告しなければならない
- REQ-LFC-103: 既に `reviewed` 状態の Project に対して `/cem_review` を実行した場合、「既に振り返り済みです」とエフェメラル通知しなければならない

### 制約要件

- REQ-LFC-401: チャンネル投稿先は環境変数 `SLACK_POST_CHANNEL_ID` で一元管理し、コードにハードコードしてはならない
- REQ-LFC-402: チャンネル投稿は Bot として行い、ユーザー名とアイコンは Slack のユーザー情報を使用しなければならない
- REQ-LFC-403: Slack の 3 秒制限を遵守するため、重い処理は `c.executionCtx.waitUntil()` に逃がしてから即時 `200 OK` を返さなければならない

## データモデルへの追加

```sql
-- challenges テーブルに追加
progress_comment TEXT  -- nullable, 進捗コメント（⋮ メニューから入力）
```

（`review_comment` は既存カラム、`progress_comment` を新規追加）

## 非機能要件

### パフォーマンス

- NFR-LFC-001: publish / progress / review 各操作の DB 更新は 300ms 以内に完了しなければならない
- NFR-LFC-002: チャンネル投稿は操作完了から 2 秒以内に行われなければならない

### セキュリティ

- NFR-LFC-101: 全リクエストは Slack 署名検証を通過しなければならない
- NFR-LFC-102: ユーザーは自分の Project / Challenge のみ操作可能でなければならない

## Edge ケース

- EDGE-LFC-001: publish 済みの月に再度 `/cem_publish` した場合、未公開 Project のみを対象にして処理する（published/reviewed は無視）
- EDGE-LFC-002: `/cem_progress` で全 Challenge が既に `completed` の場合、「全チャレンジ達成済みです！」メッセージを表示してそのまま投稿できる
- EDGE-LFC-003: チャンネル投稿が失敗した場合、DB 更新はロールバックせず、ユーザーにエフェメラル通知でエラーを伝える

## 受け入れ基準

### `/cem_publish`
- [ ] draft Project が published に更新され、Challenge が not_started になること
- [ ] 指定チャンネルに宣言メッセージが投稿されること
- [ ] App Home の [📣 今月を宣言する] ボタンからも同じ処理が動くこと
- [ ] draft Project がない場合にエフェメラル通知が返ること

### `/cem_progress`
- [ ] App Home の [未着手][進行中][✅済] ボタンで Challenge status が更新されること
- [ ] ⋮ → 「💬 コメントを追加」でミニモーダルが開き、`progress_comment` が保存されること
- [ ] `/cem_progress` モーダル送信でチャンネルに進捗メッセージが投稿されること

### `/cem_review`
- [ ] モーダルで全 Challenge の達成・未達成を選択して確定できること
- [ ] 送信後に Challenge status が completed / incompleted に確定されること
- [ ] Project status が reviewed に更新されること
- [ ] 振り返りメッセージがチャンネルに投稿されること
- [ ] App Home から振り返り完了後に編集・削除ボタンが消えること
