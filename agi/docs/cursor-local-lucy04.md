# 本机用 Cursor 落地：外接 lucy04

在你自己的电脑上用 **Cursor Desktop** 完成这件事，不要依赖 Cloud Agent VM 的公网地址。

```text
本机 Cursor 聊天
        │  优先 MCP ask_lucy；没有 MCP 就 curl /v1/lucy/ask
        ▼
本机 agi 控制面  http://127.0.0.1:8787
        │  CURSOR_API_KEY → https://api.cursor.com
        ▼
lucy04   bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621
```

提示词全集：[prompts-lucy04.md](prompts-lucy04.md)。  
若还要用 Claude Code CLI：再看 [claude-code-lucy04.md](claude-code-lucy04.md)。

## 硬性约束

- 只走官方 Cloud Agents，不接 Anthropic `/v1/messages`，不设 `ANTHROPIC_BASE_URL`。
- `CURSOR_API_KEY` 只给 `npm start`，不要写进 git，不要发给 MCP 以外的网站。
- lucy04 同时只能一个 run。忙时等它结束。
- 不要对 `lucy-copy-*` 走官方 follow-up（legacy 400）。

## 一次性落地（约 4 步）

### 1. 打开仓库

用 Cursor 打开本仓库根目录（里面有 `agi/` 和 `cat-mouse/`）。Node 22+。

### 2. 准备本机环境变量

复制 `agi/.env.lucy04.example` 为 `agi/.env.lucy04`（已 gitignore），填入：

```bash
CURSOR_API_KEY=crsr_你的官方key          # https://cursor.com/dashboard/api
AGI_CONTROL_TOKEN=用 openssl rand -hex 24 生成
AGI_TRANSPORT=official
AGI_LUCY_POOL=official
AGI_SESSION_MODE=continue
AGI_BIND=127.0.0.1
AGI_PORT=8787
AGI_URL=http://127.0.0.1:8787
LUCY_TARGET=lucy04
LUCY_CONVERSATION_ID=cursor-lucy04
```

### 3. 启动控制面

Cursor 终端 A：

```bash
cd agi
set -a && source .env.lucy04 && set +a
npm ci
npm start
```

终端 B 验收：

```bash
cd agi && set -a && source .env.lucy04 && set +a
curl -s "$AGI_URL/v1/fleet/lucy04" -H "authorization: Bearer $AGI_CONTROL_TOKEN"
curl -s "$AGI_URL/v1/lucy/ask" \
  -H "authorization: Bearer $AGI_CONTROL_TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json' \
  -d "{\"question\":\"Reply with exactly: LUCY04 OK\",\"stream\":false,\"pool\":\"official\",\"target\":\"lucy04\",\"conversationId\":\"$LUCY_CONVERSATION_ID\"}"
```

`agentId` 必须是 `bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621`，ask 应 `lucyName=lucy04` 且 `succeeded`。

### 4. 接到 Cursor MCP

把 `agi/examples/cursor.mcp.json` 抄到本机 **用户级** `~/.cursor/mcp.json`（或 Cursor Settings → MCP），把 `args` 里的路径改成你机器上的**绝对路径**，`AGI_CONTROL_TOKEN` 与 `.env.lucy04` 一致。

重启 Cursor。Settings → MCP 里 `lucy04` 应为绿。新开 Agent 聊天，说：

> 调用 ask_lucy，问 lucy04：只回 LUCY04 OK

应看到工具调用，而不是 Cursor 自己编答案。

没有 MCP 时，本机 Agent 按 [prompts-lucy04.md](prompts-lucy04.md) 里的「无 MCP 回退」用 curl 打 `/v1/lucy/ask`。

## 日常

1. 终端 A 保持 `npm start`。
2. Cursor 新开聊天，用「日常问 lucy04」提示词。
3. 同一 `conversationId=cursor-lucy04` 会钉在 lucy04 上。

简单题大约 5–8 秒整段返回（官方 Fable 5 Max thinking）。MCP 等整段，不是 SSE。
