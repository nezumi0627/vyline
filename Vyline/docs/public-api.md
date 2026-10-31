# Public API

The `/v1` API uses bearer tokens with `read` and `write` scopes. Each token is bound to exactly one active Vyline account; it cannot list or access other accounts.

## Create a token

Set `VYLINE_API_ADMIN_SECRET` before starting the backend. Use HTTPS whenever the API is reachable beyond loopback, typically by placing it behind a trusted TLS reverse proxy.

```bash
curl -X POST https://vyline.example/v1/tokens \
  -H "Authorization: Bearer $VYLINE_API_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-bot","accountId":"<active-account-id>","scopes":["read"]}'
```

The plaintext token is returned once. Store it in a secret manager. Choose `read` unless the integration must send messages; `write` grants message sending for the bound account.

```bash
curl https://vyline.example/v1/accounts/<active-account-id>/chats \
  -H "Authorization: Bearer $VYLINE_API_TOKEN"
```

Tokens created before account binding have no account and are rejected by account routes. Create a replacement token with an explicit `accountId`, then revoke the old token through `DELETE /v1/tokens/{token}`.

The token store keeps only a SHA-256 digest. The administrator secret is separate from API tokens and must not be reused as an API bearer token.
