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

Optional: `AGI_CONTROL_TOKEN` (Bearer auth), `AGI_MAX_IN_FLIGHT` (default 100), `AGI_PORT` (8787), `AGI_BIND` (127.0.0.1), `AGI_TRANSPORT` (`official` or `mock`), `AGI_SESSION_MODE` (`fresh` default, or `continue`).

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
