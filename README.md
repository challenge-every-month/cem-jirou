# cem-jirou (Challenge Every Month - 次朗)

[![Technology - Cloudflare Workers](https://img.shields.io/badge/Technology-Cloudflare_Workers-F38020?logo=cloudflare-workers&logoColor=white)](https://workers.cloudflare.com/)
[![Framework - Hono](https://img.shields.io/badge/Framework-Hono-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Database - Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare_D1-0051C3?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)

## 🌟 概要
`cem-jirou` は、[Challenge Every Month](https://github.com/challenge-every-month) コミュニティ向けの次世代型 Slack TODO / 目標管理 App です。

`/Users/aqui/Repositories/github.com/challenge-every-month/cem-app` の正統進化版として、最新のサーバーレススタックを採用し、さらなる低遅延・高パフォーマンスを実現します。

## 🚀 特徴
- **Serverless First**: Cloudflare Workers により、コールドスタートなしの爆速レスポンス。
- **Modern Tech Stack**: Hono (Web Framework) + D1 (SQL Database) による、シンプルかつ強力なバックエンド。
- **Monthly Focus**: 「毎月挑戦する」というコミュニティの文化をサポートするように最適化された目標管理フロー。
- **Zero Cost**: Cloudflare Free Tier の範囲内で全ての機能を運用可能。

## 📚 ドキュメント
詳細な仕様については以下を参照してください。

- [機能要件 (Functional Requirements)](./docs/specs/functional_requirements.md)
- [技術要件 (Technical Requirements)](./docs/specs/technical_requirements.md)

## 🛠 開発スタック
- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Framework**: Hono
- **Database**: Cloudflare D1
- **Tooling**: Wrangler

## ⌨️ 主要コマンド
- `/cem_register`: ユーザー登録
- `/cem_new`: 目標登録
- `/cem_publish`: 目標公開
- `/cem_progress`: 進捗報告
- `/cem_review`: 振り返り

---
Generated with ✨ Twin-Orbit (Yang & In) ✨
