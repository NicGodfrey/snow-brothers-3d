# lucy04 提示词（丢给 Claude Code 代操作）

你不会命令行：只复制，不要自己改。

lucy04：`bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621`  
控制面：`http://127.0.0.1:8787`  
对话钉：`claude-code-lucy04`

**第一次落地：把 `agi/docs/paste-to-claude-code.txt` 全文贴进 Claude Code。** 下面 P0 与该文件相同，备忘用。

---

## P0 · 全权代操作（第一次用，贴进 Claude Code）

见 `agi/docs/paste-to-claude-code.txt`（整文件复制）。

---

## P1 · 日常问 lucy04（MCP 配好之后，新开的 claude 窗口）

```text
通过 MCP 工具 ask_lucy 问官方 lucy04，不要自己编答案。
target=lucy04，conversationId=claude-code-lucy04。
先 lucy_pool，再 ask_lucy。把 lucy 名、status、runId 和原文答案给我。

用户问题：
（写你的问题）
```

---

## P2 · 短句

```text
调用 ask_lucy，target=lucy04，conversationId=claude-code-lucy04，fast=true。
问题：只回 LUCY04 OK
不要自己回答。
```

---

## P3 · 复杂题

```text
调用 ask_lucy，target=lucy04，conversationId=claude-code-lucy04，fast=false。
问题：根据仓库说明 cat-mouse Stage 1 怎样算胜利。先结论后依据。
以 lucy04 返回为准。
```

---

## P4 · 追问（同一只 lucy04）

```text
继续 conversationId=claude-code-lucy04，target=lucy04，调用 ask_lucy。
问题：刚才那条结论的依据是什么？不要换 lucy。
```

---

## P5 · 代我验收

```text
我不会验。你代跑：
1. GET /v1/fleet/lucy04 → agentId=bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621
2. POST /v1/lucy/ask target=lucy04 conversationId=claude-code-lucy04 问 Reply with exactly: LUCY04 OK → lucyName=lucy04 status=succeeded
3. claude mcp get lucy04 必须存在
4. 不要出现 /v1/messages 或 ANTHROPIC_BASE_URL
只报通过/失败和 error 原文。
```

---

## P6 · 代我排错

```text
lucy04 连不上。你来查、你来修，不要让我敲命令：
1. 8787 是不是 official 的 npm start，.env.lucy04 里有 CURSOR_API_KEY
2. MCP 的 AGI_CONTROL_TOKEN 是否与 .env.lucy04 一致
3. lucy-mcp.mjs 是否绝对路径，claude mcp list 是否有 lucy04
4. 409 busy 就等，不要改打 lucy-copy
5. 修好后再用 P5 验一遍
```
