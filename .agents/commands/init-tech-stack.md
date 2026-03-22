# init-tech-stack

## 目的

プロジェクトで使用する技術スタック（ランタイム、パッケージマネージャー、言語、フレームワーク、ライブラリ等）を明確化し、`docs/tech-stack.md` を作成する。

## 前提条件

- プロジェクトの基本的な方向性が決まっている
- `docs/` ディレクトリが存在する（なければ作成）

## 実行内容

1. **技術スタックの特定**
   - 使用する言語（TypeScript 等）とそのバージョン
   - ランタイム（Node.js 等）
   - パッケージマネージャー（pnpm 等）
   - コアフレームワーク（Hono 等）
   - ビルドツール（Vite 等）
   - デプロイ先（Cloudflare Workers 等）
   - テストツール（Vitest 等）

2. **ファイルの作成**
   - `docs/tech-stack.md` として保存
   - 各カテゴリごとに構造化して記述

3. **反映**
   - `AGENTS.md` の開発フローと不整合がないか確認し、必要に応じて更新する

## 出力フォーマット

```markdown
# Project Technical Stack

## Core
- **Runtime**: {Runtime}
- **Package Manager**: {Package Manager}
- **Language**: {Language}

## Web Services / API
- **Framework**: {Framework}
- **Deployment**: {Deployment}
- **Build Tool**: {Build Tool}

## Tooling & Infrastructure
- **CLI**: {CLI Tools}
- **Testing**: {Testing Framework}
- **Environment Management**: {Env Management}

## AI & SDD
- **Framework**: {SDD Framework}
- **Agent Policy**: {Agent Policy}
```

## 実行後の確認

- `docs/tech-stack.md` が作成されたことを報告
- 主要な依存関係を要約して表示
