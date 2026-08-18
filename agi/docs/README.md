# Lucy / AGI 文档索引

**不会操作：** 打开 Claude Code，把 [paste-to-claude-code.txt](paste-to-claude-code.txt) **全文粘贴**，只在它向你要时提供 `CURSOR_API_KEY`。

| 文档 | 给谁用 |
| --- | --- |
| [paste-to-claude-code.txt](paste-to-claude-code.txt) | **只贴这一份**，Claude Code 全权代做 |
| [prompts-lucy04.md](prompts-lucy04.md) | 配好之后的日常/验收提示词 |
| [claude-code-lucy04.md](claude-code-lucy04.md) | 给会自己跑命令的人看的说明书 |
| [cursor-local-lucy04.md](cursor-local-lucy04.md) | 若改用 Cursor Desktop MCP 再看 |

相关文件：

- 控制面：`agi/`，默认 `http://127.0.0.1:8787`
- MCP：`agi/scripts/lucy-mcp.mjs`（工具 `ask_lucy` / `lucy_pool` / `lucy_transcript`）
- Cursor MCP 示例：`agi/examples/cursor.mcp.json`
- 环境变量示例：`agi/.env.lucy04.example`
- lucy04：`bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621`

不要把 `ANTHROPIC_BASE_URL` 指到控制面，也不要接 `/v1/messages`。
