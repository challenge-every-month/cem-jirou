# 仕組み
汎用APIをつくる
- username + key で認証
slackフロントエンドは
- slack情報から user と key を特定して内部的に ↑ のAPIを叩く

# roadmap
- health チェック hono のセットアップ
- version 返す API これでDBとの接続
  - 更新もか？ 
- user認証、設定
- API
- Slackフロント
- webフロント
