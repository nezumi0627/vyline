# Vyline MCP Server

Vyline can run as a local Model Context Protocol server over stdio. MCP clients launch the process; Vyline does not open a network listener.

## Start

From the repository root:

```powershell
bun run mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "vyline": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "E:/projects/Vyline"
    }
  }
}
```

The process reads saved accounts from Vyline's local token store. It does not print tokens, passwords, or message encryption metadata. Select an `accountId` explicitly for account-specific tools.

## Tools

| Tool | Data source | Network |
|---|---|---|
| `list_accounts` | Local saved account list | No |
| `get_profile` | Selected account profile | Yes, if not cached |
| `get_contact_profile` | Selected contact | Yes, if not cached |
| `list_chats` | Selected account chat list | Yes |
| `get_chat_history` | Local SQLite by default | Only with `refresh: true` |
| `get_read_receipts` | Latest cached outgoing messages and LINE receipt state | Yes |

History page sizes are capped at 100 messages and receipt lookups at 100. History responses omit raw `contentMetadata`, which can contain encryption material or private URLs.

## Security boundary

- stdio grants the connected MCP host the same local account access as the Vyline process. Connect only MCP clients you trust.
- LINE data tools do not send messages, revoke messages, mark chats read, or change settings. Online tools may establish a session and save a refreshed local session token when the MCP process exits.
- The server does not bind to a network interface. Remote HTTP MCP is not enabled.
- MCP protocol output uses stdout; application logs go to stderr.
- Online tools use only the explicitly selected saved account and disable background session watchers.

For an offline history read, call `get_chat_history` without `refresh`. Call `list_chats`, profile tools, or `get_read_receipts` only when a live LINE lookup is needed.
