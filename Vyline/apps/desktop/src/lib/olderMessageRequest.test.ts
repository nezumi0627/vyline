import { expect, test } from "bun:test";
import { olderMessageRequest } from "./olderMessageRequest.js";

test("requests an older page from the backend rather than forcing local-only mode", () => {
  expect(olderMessageRequest({ id: "123456789012345678", createdTime: 1_700_000_000_000 })).toEqual({
    beforeMessageId: "123456789012345678",
    beforeDeliveredTime: 1_700_000_000_000,
  });
});
