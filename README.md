# Kaaga: Second Brain

Kaaga (until November 2026 called ReCollect; the repositories keep their names) is a personal learning app that AI agents can work in. You keep notes as docs with real diagrams, revise them on a spaced schedule, and plan the week; Claude (in Claude Code, on claude.ai, or the app's own Ask Kaaga) reads and writes the same docs, plans and records through one tool catalogue, and every change it makes can be undone.

This repository holds the pieces around the app. The app itself lives in two repos:

| Repo | What it is |
|---|---|
| [ReCollect](https://github.com/ramin-010/ReCollect) | The web app: Next.js 16, React 19, a Notion-style block editor on BlockNote with live collaboration (Yjs), React Flow boards, an installable PWA |
| [ReCollect_Backend](https://github.com/ramin-010/ReCollect_Backend) | The API: Express 5 + TypeScript, Prisma 7 on PostgreSQL 17, Hocuspocus for live editing, the Claude API, OAuth 2.1 for MCP clients |
| **ReCollect_SecondBrain** (this one) | The MCP server and agent skills, the design specs the app was built from, and the Android companion |

## What is here

```
mcp/              The Kaaga MCP server (TypeScript, @modelcontextprotocol/sdk)
  src/tools/      66 tools in groups (docs, plan, record, manage…), each with an action level
  skills/         Agent skills: kaaga-notes (notes with diagrams), kaaga-study (a tutor that remembers)
  src/hook.ts     Claude Code hooks that log work sessions to the app
context/specs/    The design specs, each with an "As built" section
android/          The Android companion (wallpaper, lock screen and widget from the day's plan)
prototype/        The first HTML prototype
```

## How agents work with the app

```
 Claude Code ──stdio──► mcp/dist/index.js ──HTTPS + rcl_ token──┐
 claude.ai  ──HTTP /mcp + OAuth 2.1 sign-in──────────────────────┼──► Kaaga API ──► Postgres
 Ask Kaaga (in the app) ──the same catalogue, embedded────────────┘    │
                                                                       └──► live docs (Yjs) in the open editor
```

- **One tool catalogue** serves every client: Claude Code over stdio, claude.ai and other remote clients over Streamable HTTP at `/mcp` (with the MCP authorization spec: protected-resource metadata, PKCE, Client ID Metadata Documents and dynamic registration, rotating refresh tokens), and the app's own Ask Kaaga, which loads the same server in-process.
- **Three action levels**: a read; a change that is logged and can be undone from the app; and anything final or outward (publishing, sharing, emptying the trash), which the agent can only propose and the person taps to run.
- **Docs are blocks, written as Markdown**: agents write a GitHub-style dialect (callouts, toggles, toggle headings, tables, code), ```` ```mermaid ```` diagrams that are checked before anything is stored, and ```` ```canvas ```` boards written as Mermaid flowchart text that the server lays out with ELK. Block tools insert, update, move and delete single blocks while the person is typing in the same doc.

## Running the MCP server

```bash
cd mcp
npm install
npm run build
claude mcp add recollect -e RECOLLECT_URL=http://localhost:8002 -e RECOLLECT_TOKEN=rcl_… -- node <path>/mcp/dist/index.js
```

Make a token in the app (Settings → Agents). The tools, their levels and groups, the Markdown dialect, the skills and the hooks are described in [mcp/README.md](mcp/README.md). Tests: `npm test` (unit), `npm run test:smoke` (against a running API).

## The specs

The app was built spec first. Each spec says what was decided and why, then records what was actually built:

- [ECOSYSTEM_PLAN](context/specs/ECOSYSTEM_PLAN.md): the system design: one catalogue, one picture of the day, code computes and models write, capture that never depends on a model remembering.
- [DOCS_EDITOR_V2_PLAN](context/specs/DOCS_EDITOR_V2_PLAN.md): rebuilding the editor on BlockNote, measured against Notion's behaviour (26 behaviours as Playwright tests), and Ask AI inside a doc.
- [MANAGER_AND_DOCS_PLAN](context/specs/MANAGER_AND_DOCS_PLAN.md): the in-app AI manager, its engine and test set; sharing; the doc backend.
- [AGENT_DIAGRAMS_PLAN](context/specs/AGENT_DIAGRAMS_PLAN.md) and [CANVAS_BLOCK_SPEC](context/specs/CANVAS_BLOCK_SPEC.md): diagrams agents can write well.
- [ALWAYS_ON_SPEC](context/specs/ALWAYS_ON_SPEC.md): the phone, push notifications, remote MCP and its sign-in.
- [ANDROID_APP_SPEC](context/specs/ANDROID_APP_SPEC.md): the Android companion.
- Also: [SYNC_SPINE_SPEC](context/specs/SYNC_SPINE_SPEC.md), [LOOP_COMPLETE_SPEC](context/specs/LOOP_COMPLETE_SPEC.md), [LOOP_V2_SPEC](context/specs/LOOP_V2_SPEC.md), [LEARNING_SPEC](context/specs/LEARNING_SPEC.md), [DB_AND_DASHBOARD_PLAN](context/specs/DB_AND_DASHBOARD_PLAN.md).

## License

MIT, as the app's two repos ([LICENSE](LICENSE)).
