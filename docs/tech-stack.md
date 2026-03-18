# Project Technical Stack

## Core
- **Runtime**: Node.js (LTS v22+)
- **Package Manager**: pnpm (v10+)
- **Language**: TypeScript (v5.9+)

## Web Services / API
- **Framework**: Hono (v4.12+)
- **Deployment**: Cloudflare Workers
- **Build Tool**: Vite 8

## Tooling & Infrastructure
- **CLI**: Wrangler (v4.75+)
- **Testing**: Vitest (v4.1+) with `@cloudflare/vitest-pool-workers`
- **Environment Management**: `.env` and `wrangler.toml`

## AI & SDD
- **Framework**: @dyoshikawa/tsumiki (Kairo SDD)
- **Agent Policy**: IN-YANG (Antigravity) with `.agents/` unified config
- **Rule Management**: Manual symlinking of `.agents/` to tool-specific dirs
