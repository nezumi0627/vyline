export async function processOperationBatch<T>(
  operations: readonly T[],
  process: (operation: T) => Promise<void>,
  commit: () => Promise<void>,
  publish?: () => Promise<void>,
): Promise<void> {
  for (const operation of operations) await process(operation);
  await commit();
  await publish?.();
}
