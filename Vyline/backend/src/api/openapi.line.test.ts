import { expect, test } from "bun:test";
import { lineOpenApiSpec } from "./openapi.line.js";

test("BFF OpenAPI documents implemented binary upload and restore routes", () => {
  const paths = lineOpenApiSpec.paths as Record<string, Record<string, any>>;
  expect(
    paths["/line/{accountId}/profile/image"]?.post.requestBody.content["image/*"],
  ).toBeDefined();
  expect(
    paths["/line/{accountId}/profile/background"]?.post.requestBody.content["image/*"],
  ).toBeDefined();
  expect(
    paths["/line/{accountId}/chats/{chatMid}/picture"]?.post.requestBody.content["image/*"],
  ).toBeDefined();
  expect(
    paths["/line/{accountId}/vyline/saved-media/{chatMid}/{messageId}/restore"]?.post,
  ).toBeDefined();

  const batch = (lineOpenApiSpec.components as any).schemas.MediaBatchRequest;
  expect(batch.properties.items.maxItems).toBe(32);
  expect(
    (lineOpenApiSpec.components as any).schemas.MediaBatchItem.properties.dataBase64.maxLength,
  ).toBe(15_000_000);
});
