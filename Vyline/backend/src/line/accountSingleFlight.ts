/** Coalesce concurrent restore attempts for the same account. */
export function runAccountSingleFlight<T>(
  pendingByAccount: Map<string, Promise<T>>,
  accountId: string,
  work: () => Promise<T>,
): Promise<T> {
  const pending = pendingByAccount.get(accountId);
  if (pending) return pending;

  const task = Promise.resolve().then(work);
  pendingByAccount.set(accountId, task);
  void task
    .finally(() => {
      if (pendingByAccount.get(accountId) === task) pendingByAccount.delete(accountId);
    })
    .catch(() => undefined);
  return task;
}
