# lucy04 提示词（本机 Cursor 用）

把对应区块整段复制到本机 Cursor Agent。不要改协议约束。

lucy04 id：`bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621`  
控制面：`http://127.0.0.1:8787`  
对话钉：`cursor-lucy04`

---

## P0 · 一次性落地（贴进本机 Cursor Agent）

```text
在我这台电脑上落地「Cursor 外接官方 lucy04」。仓库就是当前 workspace。

目标路径：
Cursor 聊天 → MCP ask_lucy（或 curl /v1/lucy/ask）→ 本机 agi:8787 → 官方 Cloud Agents API → lucy04（bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621）

按 agi/docs/cursor-local-lucy04.md 做，不要发明别的架构。

硬性禁止：
- 不要实现或暴露 Anthropic /v1/messages
- 不要设置 ANTHROPIC_BASE_URL
- 不要把 CURSOR_API_KEY 写入 git、PR、示例文件或发给第三方
- 不要对 lucy-copy-* 走官方 createRun

请你实际执行并汇报：
1. 确认 Node 22+，agi/ 可 npm ci
2. 若没有 agi/.env.lucy04：从 agi/.env.lucy04.example 复制，提醒我手填 CURSOR_API_KEY 和 AGI_CONTROL_TOKEN，不要替我编造 key
3. 用该 env 启动 agi（AGI_TRANSPORT=official，AGI_LUCY_POOL=official，AGI_SESSION_MODE=continue，AGI_BIND=127.0.0.1）
4. curl 验收 GET /v1/fleet/lucy04 和 POST /v1/lucy/ask（target=lucy04，conversationId=cursor-lucy04，问题：Reply with exactly: LUCY04 OK）
5. 按 agi/examples/cursor.mcp.json 写出我应粘贴到 ~/.cursor/mcp.json 的完整 JSON（args 用本机绝对路径；token 用占位符，让我自己替换）
6. 告诉我如何在 Cursor Settings → MCP 里看到 lucy04 变绿，以及重启后要用的验收句

完成后只给：做了什么、命令、验收 JSON 的关键字段（lucyName/status/agentId）、我需要手动粘贴的 mcp.json。不要提交任何密钥。
```

---

## P1 · 日常问 lucy04（有 MCP）

```text
你现在通过 MCP 工具 ask_lucy 询问官方 Cloud Agent lucy04，不要自己编造 lucy04 的答案。

默认参数：
- target: lucy04
- conversationId: cursor-lucy04
- 短问题不要改 fast；我若说「深入看代码」则 fast=false

先调用 lucy_pool，确认官方槽空闲。再 ask_lucy。
把工具返回的 lucy 名、status、runId 和原文答案原样给我。

用户问题：
（在这里写你的问题）
```

---

## P2 · 短句秒级风格

```text
调用 ask_lucy，target=lucy04，conversationId=cursor-lucy04，fast=true。
问题：只回 LUCY04 OK
不要自己回答。
```

---

## P3 · 复杂题（允许最少工具）

```text
调用 ask_lucy，target=lucy04，conversationId=cursor-lucy04，fast=false。
问题：根据当前仓库，说明 cat-mouse Stage 1 怎样算胜利，以及 chaseSpeed 和老鼠走路速度的关系。先给结论，再补依据。
不要自己编造仓库细节，以 lucy04 的返回为准。
```

---

## P4 · 同一会话追问

```text
继续同一段官方对话。调用 ask_lucy，target=lucy04，conversationId=cursor-lucy04。
问题：刚才那条结论的依据是什么？不要换 lucy，不要新开 conversationId。
```

---

## P5 · 无 MCP 回退（只用 curl）

```text
本机 Cursor 还没有 lucy04 MCP。不要假装问过 lucy。
用当前环境变量（agi/.env.lucy04）对 http://127.0.0.1:8787 发：

POST /v1/lucy/ask
Authorization: Bearer $AGI_CONTROL_TOKEN
Content-Type: application/json
Accept: application/json

{
  "question": "（用户问题）",
  "stream": false,
  "pool": "official",
  "target": "lucy04",
  "conversationId": "cursor-lucy04"
}

把 HTTP 状态和 lucyName、status、answer、runId 给我。控制面没起来就先按 agi/docs/cursor-local-lucy04.md 启动，不要改成 mock 冒充官方。
```

---

## P6 · 验收清单

```text
验收本机 lucy04 是否接通。依次做并只报告通过/失败：
1. GET /v1/fleet/lucy04 → agentId=bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621 且 idle 或等价可用
2. GET /v1/lucy/pool → official.idle ≥ 1
3. POST /v1/lucy/ask target=lucy04 conversationId=cursor-lucy04 问题 Reply with exactly: LUCY04 OK → lucyName=lucy04 status=succeeded
4. 若已配 MCP：调用 ask_lucy 问同一句，返回里必须出现 lucy: lucy04
5. 确认没有 /v1/messages，没有 ANTHROPIC_BASE_URL
```

---

## P7 · 故障排查

```text
lucy04 连不上。按下面查，不要改协议、不要加 Claude 中转：
1. 本机 8787 是否是 agi npm start（official + 有 CURSOR_API_KEY）
2. MCP / curl 的 AGI_CONTROL_TOKEN 是否与启动控制面的一致
3. ~/.cursor/mcp.json 里 lucy-mcp.mjs 是否绝对路径，Cursor 是否已重启
4. 若 409 lucy04 is busy：等当前 run 结束，不要换到 lucy-copy
5. 把失败的 HTTP 状态、error.code、error.message 原样给我
```
