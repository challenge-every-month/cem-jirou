# Project Overview

## General Guidelines

- Use TypeScript for all new code
- Follow consistent naming conventions
- Write self-documenting code with clear variable and function names
- Prefer composition over inheritance
- Use meaningful comments for complex business logic

## Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use double quotes for strings
- Use trailing commas in multi-line objects and arrays

## Architecture Principles

- Organize code by feature, not by file type
- Keep related files close together
- Use dependency injection for better testability
- Implement proper error handling
- Follow single responsibility principle

## Development Workflow

### Scripts
- `pnpm dev`: Start local development server with Wrangler
- `pnpm test`: Run unit tests with Vitest (Vite 8)
- `pnpm deploy`: Deploy to Cloudflare Workers

### Testing Policy
- Use Vitest and @cloudflare/vitest-pool-workers for testing
- All new features MUST include corresponding unit tests in `tests/`
- Run `pnpm test` before pushing to ensure no regressions
