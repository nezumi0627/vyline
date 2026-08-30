# API / RPC Mapping

最終更新: 2026-08-31

Vyline の HTTP BFF、service/domain、LINE transport/RPC の対応を evidence-backed な範囲だけ記録する。推測で domain mapping や request/response type を埋めない。

## Transport boundaries

| transport | endpoint / path | role | type / evidence rule |
| --- | --- | --- | --- |
| Talk Thrift | `/S4` | TalkService 系 RPC。message/chat/settings/profile の主要操作 | stack wrapper と Desktop symbol の双方で確認できたもののみ mapping |
| Relation Thrift | `/RE4` | RelationService。contact/profile relation 系 | `RelationService_*_pargs/presult` + relation stack wrapper |
| Square Thrift | `/SQ1` | Square/OpenChat protocol | protocol baseline は存在。現 product chain への接続は未確認 |
| Login | `/api/v3p/rs` | `loginV2`, `confirmE2EELogin` 等 | `packages/protocol/src/login/patchLogin.ts` / transport patch evidence |
| RSA bootstrap | `/api/v3/TalkService.do` | `getRSAKeyInfo` | login transport evidence |
| OBS | LINE object storage endpoints | image/video/audio/file upload/download | media service/evidence。単一 Thrift RPC と同一視しない |
| Album REST | `legy-jp.line-apps.com`, `obs-jp.line-apps.com`, `/ext/album/api/v6/...` | Album metadata + photo operations | REST implementation chain |
| Timeline / Note REST | `/ext/note/nt/api/v57/...` | Note create/update/delete/get/list/like/comment/share/media | REST implementation chain |

## BFF scope

LINE BFF は原則 `backend/src/api/line.ts` の `/line/:accountId/...`。`:accountId` が account scope であり、service へ同 ID を渡して session/client を分離する。

OpenAPI は `backend/src/api/openapi.line.ts`。通常 HTTP route は実 BFF と機械比較し、WebSocket upgrade の `/line/{accountId}/call/ws` は `backend/src/index.ts` に実体があるため別扱いとする。

## Evidence-backed mappings

| capability | BFF / API | service / stack | LINE transport | request / response type evidence | Desktop evidence | timeout / retry |
| --- | --- | --- | --- | --- | --- | --- |
| chat list | `GET /line/:accountId/getMessageBoxes` | `fetchChats` → Talk `getChats` | `/S4` | generated `getChats` args/result where stack wrapper exposes them | `TalkService_getChats_pargs` | unknown |
| send text/message | `POST /line/:accountId/sendMessage` | `sendMessage` → Talk `sendMessage` | `/S4` | wrapper uses send-message option/message structures; do not assume a generated args wrapper where not exposed | `TalkService_sendMessage_pargs`, `line::SendMessageTask::sendMessage` | service-specific behavior; RPC retry policy unknown |
| unsend | `POST /line/:accountId/unsendMessage` | `unsendMessage` → Talk `unsendMessage` | `/S4` | generated `LINEStruct.*_args` / `LINETypes.*_result["success"]` only where wrapper confirms | `TalkService_unsendMessage_pargs`, Desktop unsend implementation symbol | unknown |
| edit message | edit BFF route | `editMessage` → Talk `editMessage` | `/S4` | custom/generated wrapper types as implemented; no speculative schema | `TalkService_editMessage_pargs`, `TalkService_editMessage_presult` | unknown |
| reaction | reaction BFF/service path | `reactToMessage` → Talk `react` | `/S4` | wrapper-confirmed args/result only | `TalkService_react_pargs` | unknown |
| read receipt | `POST /line/:accountId/sendChatChecked` | service → Talk `sendChatChecked` | `/S4` | wrapper-confirmed args/result only | TalkService evidence in stack baseline | unknown |
| create group/chat | `POST /line/:accountId/createChat` | service → Talk `createChat` | `/S4` | wrapper-confirmed args/result only | `TalkService_createChat_pargs`, `TalkService_createChat_presult` | unknown |
| invite members | `POST /line/:accountId/inviteIntoChat/:chatMid` | service → Talk `inviteIntoChat` | `/S4` | wrapper-confirmed args/result only | TalkService invite evidence in stack baseline | unknown |
| announcements | BFF announcement routes | service → Talk announcement RPCs | `/S4` | wrapper-confirmed args/result only | `TalkService_createChatRoomAnnouncement_pargs` and related Talk symbols | unknown |
| profile get | `GET /line/:accountId/getProfile` | service/domain → Talk `getProfile` | `/S4` | wrapper-confirmed args/result | TalkService profile evidence | unknown |
| profile update | `PATCH /line/:accountId/updateProfileAttributes` | service/domain → Talk `updateProfileAttributes` | `/S4` | wrapper-confirmed args/result | TalkService profile-update evidence | unknown |
| contacts batch | contact/member resolution paths | relation wrapper `getContactsV3` | `/RE4` | `LINEStruct.getContactsV3_args`; `LINETypes.getContactsV3_result["success"]` | `RelationService_getContactsV3_pargs`, `RelationService_getContactsV3_presult` | service has contact timeouts/batching; transport retry unknown |
| target profiles | contact/member resolution paths | relation wrapper `getTargetProfiles` | `/RE4` | `LINEStruct.getTargetProfiles_args`; `LINETypes.getTargetProfiles_result["success"]` | `RelationService_getTargetProfiles_pargs`, `RelationService_getTargetProfiles_presult` | unknown |
| contact setting | `PATCH /line/:accountId/updateContactSetting/:mid` | service → Talk `updateContactSetting` | `/S4` | wrapper-confirmed args/result only | TalkService evidence | unknown |
| media flow decision | media send path | Talk `determineMediaMessageFlow` | `/S4` | wrapper-confirmed args/result only | TalkService Desktop evidence in dictionary | unknown |
| media object transfer | media BFF/service paths | media/E2EE/OBS helpers | OBS | HTTP/object payloads, not Thrift args/result | runtime/service evidence | service-dependent; generic retry unknown |
| login RSA info | auth login API → client manager | login transport `getRSAKeyInfo` | `/api/v3/TalkService.do` | login patch implementation | transport evidence | unknown |
| login | `/login/email`, `/login/qr`, `/login/token`, `/restore` | client manager → patched login | `/api/v3p/rs` | `loginV2` / `confirmE2EELogin` implementation types | transport evidence | unknown |
| Album | Album BFF routes | Album service/client | Album REST `/ext/album/api/v6/...` + OBS host | REST request/response models in implementation | not a Talk/Square Desktop RPC mapping | unknown |
| Note | Note BFF routes | Timeline/Note service/client | Timeline REST `/ext/note/nt/api/v57/...` | REST request/response models in implementation | not a Talk/Square Desktop RPC mapping | unknown |
| Call control | `/line/:accountId/call/start`, `/call/end`, `/call/status`; WS `/call/ws` | `callManager` managed session | mixed call backend/protocol; WebSocket PCM is local BFF transport | call session/status types in backend/frontend | live LINE call protocol success not established by this audit | unknown |

## Relation `/RE4` correction

`getContactsV3` と `getTargetProfiles` は Talk `/S4` ではなく RelationService `/RE4` とする。protocol baseline の relation wrapper は `protocolType = 4`, `requestPath = "/RE4"` を持ち、対応する generated type を使用する。

```text
getContactsV3
  request:  LINEStruct.getContactsV3_args
  response: LINETypes.getContactsV3_result["success"]

getTargetProfiles
  request:  LINEStruct.getTargetProfiles_args
  response: LINETypes.getTargetProfiles_result["success"]
```

## Square `/SQ1`

protocol stack HEAD baseline には SquareService `/SQ1` と `getJoinedSquares`, `fetchMyEvents`, `fetchSquareChatEvents`, `sendMessage`, `getSquare`, `getJoinableSquareChats`、create/join/member/admin/thread 系 RPC が存在する。

ただし、現在の worktree で専用の frontend consumer → BFF → backend → SquareService chain を確認できていない。このため API mapping 表に product-level domain/BFF 対応を推測で追加しない。

## Unknown handling

timeout、retry、idempotency、rate-limit、server error semantics は実コードまたは Desktop/runtime evidence が取れた項目だけ記載する。根拠がない場合は `unknown` のまま残す。
