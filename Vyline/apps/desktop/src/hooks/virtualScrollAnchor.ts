/** Adjust scrollTop by an anchor row's offset change to keep its viewport position stable. */
export function adjustScrollTopForAnchor(
  scrollTop: number,
  previousAnchorTop: number,
  nextAnchorTop: number,
): number {
  return Math.max(0, scrollTop + nextAnchorTop - previousAnchorTop);
}

export function isAtScrollEnd(scrollHeight: number, clientHeight: number, scrollTop: number): boolean {
  // A small tolerance covers fractional CSS pixels without stealing a user's
  // intentional scroll just above the newest message.
  return scrollHeight - clientHeight - scrollTop <= 1;
}
