export function olderMessageRequest(anchor: { id: string; createdTime: number }) {
  return {
    beforeMessageId: anchor.id,
    beforeDeliveredTime: anchor.createdTime,
  };
}
