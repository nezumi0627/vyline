/**
 * VylineSession — ログイン済み Client のドメイン facade
 *
 * backend は VylineClient (= stack Client) を保持したまま、
 * プロフィール / チャット管理などは session.* 経由で呼べる。
 *
 * UI は変更しない。BFF がこの facade を使う。
 */

import type { Client } from "./types.js";
import { ChatDomain } from "./chat.js";
import { ContactsDomain } from "./contacts.js";
import { ProfileDomain } from "./profile.js";
import { TalkDomain } from "./talk.js";

import { CallDomain } from "./call.js";

export class VylineSession {
  readonly talk: TalkDomain;
  readonly profile: ProfileDomain;
  readonly chat: ChatDomain;
  readonly contacts: ContactsDomain;
  readonly call: CallDomain;

  constructor(readonly client: Client) {
    this.talk = new TalkDomain(client);
    this.profile = new ProfileDomain(client);
    this.chat = new ChatDomain(client);
    this.contacts = new ContactsDomain(client);
    this.call = new CallDomain(client);
  }

  get authToken(): string {
    return this.client.authToken;
  }

  get mid(): string | undefined {
    return this.client.base.profile?.mid;
  }

  /** 既存コード互換: 生 Client */
  get raw(): Client {
    return this.client;
  }
}

export function wrapSession(client: Client): VylineSession {
  return new VylineSession(client);
}
