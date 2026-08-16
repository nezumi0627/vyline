---
name: bug-report-line
description: >-
  Finds bugs in the current workspace and sends a Japanese summary to LINE via
  the line-bot MCP. Use when the user asks to find bugs and send them on LINE,
  says バグをLINEで送って, バグ報告LINE, /bug-line, or similar.
---

# バグ調査 → LINE 送信

## When triggered

1. Investigate bugs in the **current workspace**.
2. Send a concise Japanese summary via LINE MCP (`line-bot` / `user-line-bot`).
3. Also show a short summary in chat.

## Investigate

Prefer this order:

1. If `.git` exists and Bugbot skill/subagent is available → run Bugbot (`Diff: branch changes`, or `uncommitted changes` if the user asked for local-only).
2. Otherwise explore user-facing flows and report concrete correctness bugs (severity / medium / low), with `file:line` when possible.
3. Cap at ~10 findings. Skip pure style nits.

## Send via LINE

1. Discover tools with the LINE MCP server, then call send.
2. Destination（**れんや向け push 固定**）:
   - 必ず `push_text_message` を使う。`broadcast_*` は使わない（ユーザーが明示した場合のみ）。
   - 宛先優先順位:
     1. ユーザーが今回指定した `userId`
     2. MCP env の `DESTINATION_USER_ID`（れんや）
     3. `get_follower_ids`（limit 1–5）で displayName / 文脈から「れんや」を特定できればその id
   - 上記で特定できない場合は **送らず**、チャットで `userId`（`U...`）を確認する。
3. Message body (plain text, ≤5000 chars):

```
🐛 バグ報告 — <repo or folder name>
<YYYY-MM-DD HH:mm>

【high】N件
- file:line — 一言

【medium】N件
- ...

【low】N件
- ...

（指摘なしの場合）問題は見つかりませんでした。
```

4. Split into multiple messages if over the limit (high first).
5. Do not paste channel access tokens or secrets into LINE or chat.

## After send

Reply in chat with: sent / failed, destination mode (**push to れんや**), and a compact severity table of findings.
