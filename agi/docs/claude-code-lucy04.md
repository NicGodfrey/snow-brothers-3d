# 用 Claude Code 外接 lucy04

这条路径是：

```text
你的电脑上的 Claude Code
        │  MCP stdio（ask_lucy / lucy_pool / lucy_transcript）
        ▼
本机 agi 控制面  http://127.0.0.1:8787
        │  官方 Cloud Agents API
        ▼
lucy04   bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621
```

不要把 `ANTHROPIC_BASE_URL` 指到这个控制面。Claude Code 的聊天协议是 Anthropic Messages；lucy04 是 Cursor Cloud Agent。中间用 **MCP** 桥，不伪装成官方 Claude。

## 0. 你需要准备什么

| 东西 | 作用 |
| --- | --- |
| [Claude Code](https://code.claude.com/docs) CLI | 你日常用的 `claude` |
| Node.js 22+ | 跑控制面和 MCP |
| 本仓库 | `agi/` |
| [Cursor API key](https://cursor.com/dashboard/api) | 控制面拿它去调官方 `https://api.cursor.com` |
| 可选：`AGI_CONTROL_TOKEN` | 本机 loopback 可以不设；一旦对公网 bind 就必须设 |

lucy04 已经是官方槽，follow-up `createRun` 可用。不要对 Task 复制体（`lucy-copy-*`）走这条官方路径。

## 1. 本机拉起控制面（钉死官方池）

在**你自己的电脑**上做，不要依赖某台 Cloud Agent VM 的公网地址。

```bash
git clone https://github.com/NicGodfrey/snow-brothers-3d.git
cd snow-brothers-3d/agi
npm ci

export CURSOR_API_KEY='crsr_你的官方key'
export AGI_TRANSPORT=official
export AGI_LUCY_POOL=official
export AGI_SESSION_MODE=continue
export AGI_BIND=127.0.0.1
export AGI_PORT=8787
# 本机可省略 token；若要和 Claude Code 一样带鉴权：
export AGI_CONTROL_TOKEN="$(openssl rand -hex 24)"
printf '%s\n' "$AGI_CONTROL_TOKEN"   # 下一步 MCP 要用，先抄下来

npm start
```

另开一个终端确认控制面和 lucy04 都活着：

```bash
export AGI_CONTROL_TOKEN='上一步抄下来的'   # 若没设 token 就不要加 -H

curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/v1/lucy/pool \
  -H "authorization: Bearer $AGI_CONTROL_TOKEN"
curl -s http://127.0.0.1:8787/v1/fleet/lucy04 \
  -H "authorization: Bearer $AGI_CONTROL_TOKEN"
```

`/v1/lucy/pool` 里 `official.idle` 应 ≥ 1。`/v1/fleet/lucy04` 的 `agentId` 必须是 `bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621`，`status` 为 `idle`。

先手打一轮，确认官方 run 通：

```bash
curl -s http://127.0.0.1:8787/v1/lucy/ask \
  -H "authorization: Bearer $AGI_CONTROL_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -d '{
    "question":"Reply with exactly: LUCY04 OK",
    "stream": false,
    "pool": "official",
    "target": "lucy04",
    "conversationId": "claude-code-lucy04"
  }'
```

应返回 `"lucyName":"lucy04"`、`"status":"succeeded"`。同一 `conversationId` 再问会继续钉在 lucy04。

## 2. 把 lucy04 接到 Claude Code（MCP）

控制面保持运行。在**任意工作目录**执行（把路径换成你机器上的绝对路径）：

```bash
# Linux / macOS
REPO="$HOME/snow-brothers-3d"          # 改成你的克隆路径
export AGI_URL="http://127.0.0.1:8787"
export AGI_CONTROL_TOKEN='和 npm start 相同的 token，没有就空着'
export LUCY_TARGET=lucy04
export LUCY_CONVERSATION_ID=claude-code-lucy04

claude mcp add --scope user --transport stdio lucy04 \
  --env AGI_URL="$AGI_URL" \
  --env AGI_CONTROL_TOKEN="$AGI_CONTROL_TOKEN" \
  --env LUCY_TARGET=lucy04 \
  --env LUCY_CONVERSATION_ID=claude-code-lucy04 \
  -- node "$REPO/agi/scripts/lucy-mcp.mjs"
```

Windows（PowerShell）：

```powershell
$repo = "$env:USERPROFILE\snow-brothers-3d"
$env:AGI_URL = "http://127.0.0.1:8787"
$env:LUCY_TARGET = "lucy04"
$env:LUCY_CONVERSATION_ID = "claude-code-lucy04"

claude mcp add --scope user --transport stdio lucy04 `
  --env AGI_URL=$env:AGI_URL `
  --env AGI_CONTROL_TOKEN=$env:AGI_CONTROL_TOKEN `
  --env LUCY_TARGET=lucy04 `
  --env LUCY_CONVERSATION_ID=claude-code-lucy04 `
  -- node "$repo\agi\scripts\lucy-mcp.mjs"
```

等价的用户级配置（`~/.claude.json` 的 `mcpServers`，或项目根 `.mcp.json`）如下。项目级请用 `${AGI_CONTROL_TOKEN}`，不要把 key 写进 git。

```json
{
  "mcpServers": {
    "lucy04": {
      "type": "stdio",
      "command": "node",
      "args": ["/绝对路径/snow-brothers-3d/agi/scripts/lucy-mcp.mjs"],
      "env": {
        "AGI_URL": "http://127.0.0.1:8787",
        "AGI_CONTROL_TOKEN": "${AGI_CONTROL_TOKEN}",
        "LUCY_TARGET": "lucy04",
        "LUCY_CONVERSATION_ID": "claude-code-lucy04"
      }
    }
  }
}
```

检查：

```bash
claude mcp list
claude mcp get lucy04
```

应看到 `lucy04` 为 stdio，命令是 `node …/lucy-mcp.mjs`。

然后**新开**一个 Claude Code 会话（已打开的窗口不会自动加载刚加的 MCP）：

```bash
cd 你的项目
claude
```

在 Claude Code 里执行 `/mcp`，确认 `lucy04` 已连接，工具为：

| 工具 | 作用 |
| --- | --- |
| `ask_lucy` | 问 lucy04（可改 `target`） |
| `lucy_pool` | 看官方槽空闲 |
| `lucy_transcript` | 读 `conversationId` 历史 |

## 3. 在 Claude Code 里怎么用

直接说人话即可，例如：

- 「用 lucy04 回答：现在仓库里 Stage 1 能不能通关？」
- 「问 lucy04：只回 LIVE OK」
- 「同一段对话继续问 lucy04：刚才那个结论的依据是什么？」
- 「看一下 lucy 池子里 lucy04 忙不忙」

Claude Code 会调 `ask_lucy`。默认：

- `target=lucy04`
- `conversationId=claude-code-lucy04`（多轮同一只 lucy，官方 workspace 还在）
- 短问题 `latency=fast`（不读仓库、不动工具，更快）
- 编码/修复类问题自动 `full`，允许最少工具

强制快答或强制走工具：

> 用 lucy04 回答，fast=true：你好  
> 用 lucy04 回答，fast=false：把 cat-mouse Stage 1 的胜利条件讲清楚

## 4. 不用 MCP 的备用接法

只想在终端里钉 lucy04，不必开 Claude Code：

```bash
cd snow-brothers-3d/agi
export AGI_URL=http://127.0.0.1:8787
export AGI_CONTROL_TOKEN='…'

npm run lucy:chat -- --target lucy04 --conversation claude-code-lucy04 "只回：LUCY04 OK"
```

或继续用上面的 `curl`。`npm run lucy:mcp` 是给 Claude Code 拉起的 stdio 进程，不要当聊天 CLI 用。

## 5. 控制面如果在别的机器上

这台 Cloud Agent VM **没有公网主机名**。要在自己电脑的 Claude Code 里用远程控制面：

```bash
ssh -N -L 8787:127.0.0.1:8787 你的用户@那台机器
```

然后 MCP 的 `AGI_URL` 仍写 `http://127.0.0.1:8787`。远端必须：

```bash
export AGI_BIND=127.0.0.1          # 只给 SSH 隧道，不要 0.0.0.0 除非有 token
export AGI_CONTROL_TOKEN='长随机串'
export CURSOR_API_KEY='crsr_…'
export AGI_LUCY_POOL=official
export AGI_SESSION_MODE=continue
cd agi && npm start
```

若远端 `AGI_BIND=0.0.0.0`，请求必须带 `Authorization: Bearer <token>`，MCP 的 `AGI_CONTROL_TOKEN` 要一致。

## 6. 故障排除

| 现象 | 处理 |
| --- | --- |
| `/mcp` 里 lucy04 红/disconnected | 控制面没起；或 `node` 不在 PATH；或 `lucy-mcp.mjs` 路径不是绝对路径 |
| `ask_lucy` 报 unauthorized | MCP 的 token 和 `npm start` 的 `AGI_CONTROL_TOKEN` 不一致 |
| `lucy04 is busy` / 409 | 同一时刻一个官方 agent 只能一个 run。等当前 run 结束，或换 `conversationId` 仍会钉 lucy04 并继续 409 |
| `no_idle_lucy` | 官方槽都忙。`lucy_pool` 看 idle |
| `legacy workflow that is no longer supported` | 打到了 Task 复制体，不是 lucy04。确认 `target` 是 `lucy04` 且 `pool=official` |
| 要等 5–8 秒 | 正常。官方 Cloud Agent + Fable 5 Max thinking。SSE 首包大约 4 秒；MCP 用 JSON 等整段答完 |
| Claude Code 自己在答、没调 lucy | 明确说「用 lucy04 / 调用 ask_lucy」；检查 `/mcp` 是否已连接 |
| 想改 `ANTHROPIC_BASE_URL` | 不要。那个是 Claude 中转，这个控制面没有 `/v1/messages` |

## 7. 安全

- `CURSOR_API_KEY` 只给跑 `npm start` 的进程，不要发给 Claude Code，也不要发给任何验真网站。
- `AGI_CONTROL_TOKEN` 只给本机 MCP 和 curl。
- 不要把真实 token 写进已提交的 `.mcp.json`。

## 8. 一页对照

```bash
# 终端 A：控制面
cd agi
export CURSOR_API_KEY=… AGI_TRANSPORT=official AGI_LUCY_POOL=official
export AGI_SESSION_MODE=continue AGI_BIND=127.0.0.1
npm start

# 终端 B：只做一次
claude mcp add --scope user --transport stdio lucy04 \
  --env AGI_URL=http://127.0.0.1:8787 \
  --env LUCY_TARGET=lucy04 \
  --env LUCY_CONVERSATION_ID=claude-code-lucy04 \
  -- node /绝对路径/agi/scripts/lucy-mcp.mjs

# 终端 B：日常
claude
# 然后说：用 lucy04 回答：……
```
