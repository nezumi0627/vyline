import type { SquareStore } from "../storage/squareStore.js";

export class SquareDisabledError extends Error {
  readonly code = "SQUARE_DISABLED";
  readonly status = 403;

  constructor() {
    super("OpenChat beta is disabled for this account");
    this.name = "SquareDisabledError";
  }
}

export class SquareRoomUnavailableError extends Error {
  readonly code = "SQUARE_ROOM_NOT_JOINED";
  readonly status = 404;

  constructor() {
    super("Square room is not in the joined-room cache");
    this.name = "SquareRoomUnavailableError";
  }
}

/** Must run before obtaining a Square RPC or REST client. */
export async function withSquareEnabled<T>(
  store: SquareStore,
  operation: () => Promise<T>,
): Promise<T> {
  if (!store.isEnabled()) throw new SquareDisabledError();
  return await operation();
}
