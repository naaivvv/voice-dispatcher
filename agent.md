# Agent Instructions

## Persistent Context

This repository is the **Stateful Voice-to-Voice Logistics Dispatcher** described in [PROJECT.md](PROJECT.md). Treat that file as the product brief and source of truth for the app's purpose.

The implementation plan lives in [ROADMAP.md](ROADMAP.md). Treat that file as the active build queue. Work through it one step at a time, in order, unless the user explicitly asks to jump ahead or revise the plan.

## App Purpose

Build a real-time AI dispatcher for logistics, delivery, and non-emergency transport operations. The system should support natural voice conversations with drivers, maintain session context, update route and ETA state, and stream realistic dispatcher voice responses.

The core outcome is an operational backend that can:

- Accept driver communication over real-time connections.
- Preserve dispatch-session context across turns.
- Update driver, route, ETA, and conversation data in the database.
- Orchestrate AI behavior through LangChain and backend functions.
- Generate dispatcher speech through ElevenLabs.
- Handle low-latency streaming and interruptions as the roadmap matures.

## Current Stack

- Runtime: Node.js with TypeScript.
- Server: Express and `ws`.
- Database: Supabase client and SQL schema in `src/db`.
- Voice: ElevenLabs TTS in `src/voice`.
- AI orchestration target: LangChain and OpenAI-compatible LLM provider.
- Configuration: `.env` locally, `.env.example` for documented variables.

## Scope Rules

- Keep the backend focused on the dispatcher workflow. Avoid adding unrelated product areas, dashboards, marketing pages, or broad platform abstractions unless the roadmap calls for them.
- Prefer the existing TypeScript structure under `src/` before introducing new directories.
- Keep route, driver, ETA, session, and conversation concepts aligned with [PROJECT.md](PROJECT.md) and [ROADMAP.md](ROADMAP.md).
- Treat live driver and dispatch state as operational data. Favor explicit types, clear persistence boundaries, and audit-friendly behavior.
- Do not commit secrets. Add new required environment variables to `.env.example` only with placeholder values.
- Do not edit `.env` unless the user explicitly asks.
- Do not remove user work or rewrite unrelated modules while implementing a roadmap step.

## Implementation Workflow

When asked to continue the build:

1. Read [PROJECT.md](PROJECT.md) for product intent.
2. Read [ROADMAP.md](ROADMAP.md) and identify the next incomplete step.
3. Inspect the current codebase to determine what has already been implemented.
4. State the step being implemented and the files likely to change.
5. Make focused code changes that complete that step's deliverables.
6. Update or add tests when the change affects behavior that can be tested.
7. Run the relevant checks, usually:
   - `npm run typecheck`
   - `npm run build`
8. Summarize what changed, what was verified, and what roadmap step should come next.

If a roadmap task is partially complete, finish the missing parts instead of duplicating existing work.

## Coding Rules

- Use strict TypeScript and keep exported interfaces/types explicit.
- Prefer small service modules with clear responsibility.
- Keep network provider integrations isolated behind service wrappers.
- Validate required environment variables at startup or service construction.
- Return useful errors without leaking secrets.
- Use async/await consistently for I/O.
- Keep WebSocket message contracts typed.
- Keep database access in `src/db` or a clearly named data/service layer.
- Keep voice-provider logic in `src/voice`.
- Add comments only for non-obvious control flow or integration details.

## Database Rules

- Keep schema changes in `src/db/schema.sql` unless a migrations system is added.
- Preserve existing table intent: drivers, routes/deliveries, dispatch sessions, ETA logs, and conversation history.
- Use Supabase service functions for database operations rather than scattering raw queries through unrelated modules.
- Treat route/ETA updates as state changes that should be traceable.

## Voice And AI Rules

- ElevenLabs is the preferred TTS provider for dispatcher responses.
- LangChain is the intended orchestration layer for memory, intent handling, and tool/function calls.
- AI actions that mutate operational state must go through explicit backend functions.
- The dispatcher persona should be concise, calm, operational, and confirmation-oriented.
- The agent should confirm critical changes such as ETA updates, route completion, or escalation to a human dispatcher.

## Workspace Context With `@`

Use workspace references to keep prompts grounded:

- `@PROJECT.md` for the product brief and app purpose.
- `@ROADMAP.md` for the current implementation sequence.
- `@src` for the current backend code.
- `@src/db/schema.sql` for database shape.
- `@.env.example` for configuration contract.
- `@agent.md` for these persistent rules.

When prompting an AI agent, include the relevant `@` files instead of pasting stale context.

## Saved Prompt Workflows

### Continue Roadmap

Use when asking the agent to implement the next roadmap item.

```text
Use @agent.md, @PROJECT.md, and @ROADMAP.md as persistent context.
Inspect @src and identify the next incomplete roadmap step.
Implement only that step, keep changes scoped, update .env.example if configuration changes, and run npm run typecheck plus npm run build.
Summarize the completed step and the next recommended step.
```

### Implement Specific Step

Use when targeting one roadmap step explicitly.

```text
Use @agent.md, @PROJECT.md, @ROADMAP.md, and @src.
Implement ROADMAP Step [number/name] only.
First inspect what already exists, then fill the missing deliverables without duplicating completed work.
Run the relevant checks and summarize changed files.
```

### Review Current Progress

Use when you want a status check before more implementation.

```text
Use @agent.md, @PROJECT.md, @ROADMAP.md, and @src.
Review the repository against the roadmap.
Report which steps appear complete, partially complete, or not started.
List the highest-value next task and any risks or missing verification.
Do not make code changes.
```

### Add Provider Integration

Use when adding or refining integrations such as ElevenLabs, Supabase, OpenAI, or LangChain.

```text
Use @agent.md, @PROJECT.md, @ROADMAP.md, @src, and @.env.example.
Add or refine the requested provider integration.
Keep provider-specific code isolated, validate required environment variables, avoid secrets, and update .env.example with placeholders for any new settings.
Run npm run typecheck and npm run build.
```

### Debug And Fix

Use when something fails.

```text
Use @agent.md and @src.
Reproduce or inspect the reported issue.
Make the smallest fix that addresses the root cause.
Run the relevant check or command that proves the fix.
Explain the cause, the fix, and any remaining risk.
```

## Done Criteria

A roadmap step is done when:

- Its listed deliverables are implemented or intentionally deferred with a clear reason.
- TypeScript checks pass.
- Build passes.
- Environment variables are documented in `.env.example`.
- The final response names the completed roadmap step and the next likely step.
