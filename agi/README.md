# AGI control plane

Official orchestrator for the 101-slot Lucy fleet on `github.com/NicGodfrey/snow-brothers-3d`.

It talks only to [Cursor Cloud Agents API v1](https://cursor.com/docs/cloud-agent/api/endpoints): `POST /v1/agents` and `POST /v1/agents/{id}/runs`. It does not implement or use unofficial Cursor proxies.

## Hard limits

| Layer | Cap | Why |
| --- | --- | --- |
| HTTP admission | 100 in-flight jobs | Requested AGI concurrency |
| Per agent | 1 active run | Official API returns `409 agent_busy` |
| Parent Task spawn | 10 async children | Cursor Cloud Agent hard limit |
| Current official slots | 10 | lucy02, lucy03, lucy04, lucy11–lucy16, lucy18 |

Task-spawned lucy copies (`generalPurpose` + `inherit`, new ids only) live in `data/lucy-copies.json`. They do not share lucy's memory. Official `createRun` on them is the same legacy-workflow 400; resume them from the parent Task tool.

100 concurrent live Cloud Agent runs need 100 distinct official agents. The control plane can admit 100 jobs and queue them onto the slots that actually exist.

## Setup

```bash
export CURSOR_API_KEY='your key from https://cursor.com/dashboard/api'
cd agi
npm ci
npm test
npm start
```

Without `CURSOR_API_KEY` the plane starts in `mock` transport so environment boots and CI stay green.

The fleet is bound to **Claude Fable 5 Max**: `model.id=claude-fable-5` with `thinking=true`, `context=1m`, `effort=max`. Override with `AGI_MODEL_ID` / `AGI_MODEL_PARAMS`.

Optional: `AGI_CONTROL_TOKEN` (Bearer auth; **required** when `AGI_BIND` is not loopback), `AGI_MAX_IN_FLIGHT` (default 100), `AGI_PORT` (8787), `AGI_BIND` (`127.0.0.1` default; `0.0.0.0` for remote), `AGI_TRANSPORT` (`official` or `mock`), `AGI_SESSION_MODE` (`fresh` default, or `continue`), `AGI_MAX_BODY_BYTES` (20 MiB), `AGI_STREAM_IDLE_TIMEOUT_MS` (5 minutes, matching current Claude Code stalled-stream abort; the older watchdog default was 90s via `CLAUDE_STREAM_IDLE_TIMEOUT_MS`).

Every new `/v1/ask` (and the other Q&A routes) starts a **new conversation**: the plane creates a new official agent for that turn and archives the previous one on the slot. Official `POST /v1/agents/{id}/runs` cannot reset chat history. Set `AGI_SESSION_MODE=continue` only if you want follow-up on the same agent.

## Remote Q&A

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/v1/fleet
curl -s -X POST http://127.0.0.1:8787/v1/ask \
  -H 'content-type: application/json' \
  -d '{"question":"What is Stage 1?","target":"lucy02"}'
curl -s -X POST http://127.0.0.1:8787/v1/fanout \
  -H 'content-type: application/json' \
  -d '{"question":"Name one cat-AI risk.","n":8}'
curl -s -X POST http://127.0.0.1:8787/v1/debate \
  -H 'content-type: application/json' \
  -d '{"question":"Should chaseSpeed stay below mouse walk speed?"}'
curl -s -X POST http://127.0.0.1:8787/v1/vote \
  -H 'content-type: application/json' \
  -d '{"question":"Is Stage 1 completable?","n":5}'
```

CLI: `npx tsx src/cli.ts status|ask|fanout|debate|vote|broadcast|specialist|provision`.

`POST /v1/fleet/provision` creates **new** official Cloud Agents for empty or ERROR slots. That spends Cursor Cloud Agent quota. Do not fire all 90 remaining slots until you intend to pay for them.

Task-spawned copies (lucy and lucy01–lucy20) are visible to `GET /v1/agents/{id}` but follow-up `POST /v1/agents/{id}/runs` returns `400` *legacy workflow that is no longer supported*. The scheduler marks those slots `error`. Remote Q&A requires agents created through `POST /v1/agents` (the provision endpoint).

This Cloud Agent VM is not a public internet hostname. Call the plane on localhost inside the VM, or run `agi/` on your own machine with the same official key.

## Remote lucy streaming

`POST /v1/lucy/ask` (alias `POST /v1/lucy/chat`) picks a **random idle lucy** and opens an SSE conversation.

| Rule | Behavior |
| --- | --- |
| Idle pick | Uniform random among idle slots. Pin with `target` or `conversationId`. |
| Large prompt | Upload the whole question in one JSON body (default 20 MiB). The idle watchdog does **not** run during the upload. |
| Stream | `text/event-stream` events: `meta`, `delta`, `thinking`, `heartbeat`, `result`, `error`, `done`. |
| Stall | After the stream opens, **no model tokens** for `AGI_STREAM_IDLE_TIMEOUT_MS` (default 5 minutes, Claude Code 2.1.105+ stalled-stream abort; set `90000` for the older watchdog) aborts the job. Heartbeats keep the TCP connection alive and do **not** reset the timer. |
| Remote | `AGI_BIND=0.0.0.0` plus `AGI_CONTROL_TOKEN`. Requests need `Authorization: Bearer <token>`. |

```bash
export AGI_BIND=0.0.0.0
export AGI_CONTROL_TOKEN='long random token'
npm start

curl -N http://HOST:8787/v1/lucy/ask \
  -H "authorization: Bearer $AGI_CONTROL_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"question":"huge paste or a short question"}'

# or a file-sized prompt
node scripts/lucy-chat.mjs --file prompt.txt
```

`GET /v1/lucy/pool` shows idle/busy counts. `stream: false` returns JSON instead of SSE.

### Which lucy, and how tokens actually arrive

| Pool (`pool` / `AGI_LUCY_POOL`) | Who is picked | Live tokens |
| --- | --- | --- |
| `auto` (default) | Official idle slots when the official transport is up; otherwise copies | Official SSE, or mock/queue for copies |
| `copies` | Original lucy + `lucy-copy-01`…`10` from `data/lucy-copies.json` | **Queue**: Task copies cannot use official `createRun` (legacy-workflow 400). The stream waits; a parent drain posts `POST /v1/lucy/jobs/:id/tokens` then `/complete`. `npm run lucy:drain` lists waiting jobs. Mock transport answers immediately. |
| `official` | Random idle official slot (lucy02, lucy03, …) | Official `createRun` + `GET /v1/agents/{id}/runs/{runId}/stream`. |

This plane does **not** expose an Anthropic `/v1/messages` relay. Tools that probe unofficial Claude midpoints (including cctest.ai) are out of scope and must not receive Cursor API keys.

The older Claude Code watchdog was 90 seconds (`CLAUDE_STREAM_IDLE_TIMEOUT_MS=90000`). Official Cloud Agents often think longer than that before the first token, so this plane defaults to five minutes.
