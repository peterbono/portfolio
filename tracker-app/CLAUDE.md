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

## Product team: /product-team-debug (22 agents, 6 departments)

Invoke `/product-team-debug` for ANY bug, feature, or improvement. It spawns parallel specialist agents.

### Agent Roster

| Dept | Agents |
|------|--------|
| **Strategy** | CEO/Visionary, Growth Strategist, Revenue Analyst, Market Research, Customer Success |
| **Product** | Product Strategist, UX Designer, UI Designer, UX Writer |
| **Engineering** | Tech Architect, Frontend, Backend, Extension Specialist, Infra/DevOps, Performance |
| **Quality** | QA/Test, Security, Accessibility |
| **Data** | AI/ML Engineer, Data Engineer, Analytics Engineer |
| **Operations** | Code Reviewer, Documentation Writer |

### When to spawn

| Scenario | Minimum Agents |
|----------|---------------|
| New feature | CEO + Product + UX + Frontend + Backend + Test |
| Bug fix | Frontend/Backend + Test + Code Review |
| UI polish | UI Designer + Frontend + Accessibility |
| Pipeline failure | Backend + Frontend + QA + Performance |
| Extension bug | Extension + Frontend + QA |
| Prompt tuning | AI/ML + Test |
| Pricing | CEO + Growth + Revenue + Frontend |

**ALWAYS spawn MORE agents than the minimum if it helps quality.**

### Triggers
- User says: "invoque l'equipe", "product team", "debug avec les agents", "lance les agents"
- Or: any bug/issue/feature → auto-invoke
- Agents run in PARALLEL, write actual code fixes, return root cause + fix + files changed
- After all agents return: review conflicts → build → `git push` → verify on prod

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
