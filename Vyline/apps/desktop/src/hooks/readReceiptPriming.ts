export function createReadReceiptPrimer(refresh: () => void) {
  let primed = false;
  return (hasOwnMessage: boolean, visible: boolean) => {
    if (primed || !hasOwnMessage || !visible) return;
    primed = true;
    refresh();
  };
}
