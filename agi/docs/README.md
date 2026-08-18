# Lucy / AGI 文档索引

按你要做的事选一篇即可。

| 文档 | 给谁用 |
| --- | --- |
| [cursor-local-lucy04.md](cursor-local-lucy04.md) | **本机 Cursor 落地**（先看这篇） |
| [prompts-lucy04.md](prompts-lucy04.md) | 复制给本机 Cursor Agent 的提示词 |
| [claude-code-lucy04.md](claude-code-lucy04.md) | 本机 Claude Code CLI 外接 lucy04 |

相关文件：

- 控制面：`agi/`，默认 `http://127.0.0.1:8787`
- MCP：`agi/scripts/lucy-mcp.mjs`（工具 `ask_lucy` / `lucy_pool` / `lucy_transcript`）
- Cursor MCP 示例：`agi/examples/cursor.mcp.json`
- 环境变量示例：`agi/.env.lucy04.example`
- lucy04：`bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621`

不要把 `ANTHROPIC_BASE_URL` 指到控制面，也不要接 `/v1/messages`。
