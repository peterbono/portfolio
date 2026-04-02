# JobTracker SaaS — Claude Rules

## ABSOLUTE RULE: Never bypass the product

**NEVER manually perform actions that the SaaS pipeline is designed to automate.**

This means:
- NEVER use WebSearch/WebFetch to find job listings — that's what scout-boards.ts does
- NEVER use Playwright/Chrome MCP to fill ATS forms — that's what the bot adapters do
- NEVER scrape career pages manually — that's what the pipeline sources do
- NEVER check Gmail for confirmations manually — that's what GmailSyncBridge does

**If the pipeline can't do something, FIX THE PIPELINE CODE.**

The correct workflow is:
1. Run the bot from the dashboard (or trigger via API)
2. Observe failures in the bot activity logs
3. Launch product-team-debug agents to fix root causes
4. Re-run the bot and verify the fix works
5. Repeat until the pipeline succeeds autonomously

## Project structure

- Frontend: React + Vite + TypeScript
- Backend: Trigger.dev tasks (scout, qualify, apply)
- Database: Supabase (PostgreSQL)
- Deploy: Vercel auto-deploy from git push (tracker-app-lyart.vercel.app)
- Bot adapters: src/bot/adapters/ (Lever, Greenhouse, Workable, LinkedIn Easy Apply)

## Deploy

- NEVER deploy with `vercel` CLI from this directory (creates parasitic projects)
- ALWAYS deploy via `git push origin main` — Vercel auto-deploys from the repo
- Production URL: https://tracker-app-lyart.vercel.app
