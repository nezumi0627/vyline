import { describe, expect, it } from "bun:test";
import { isReadOperationType, isReceiveMessageOperationType } from "./talkOperationTypes";

describe("Talk operation type classification", () => {
  it("keeps SEND_MESSAGE (25) out of receive and read paths", () => {
    expect(isReceiveMessageOperationType("25")).toBe(false);
    expect(isReadOperationType("25")).toBe(false);
  });

  it("recognizes the protocol receive-message code", () => {
    expect(isReceiveMessageOperationType("26")).toBe(true);
  });

  it("recognizes read notifications and watermarks", () => {
    expect(isReadOperationType("55")).toBe(true);
    expect(isReadOperationType("28")).toBe(true);
    expect(isReadOperationType("91")).toBe(true);
  });
});
