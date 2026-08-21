import { AssertionError, strict as assertStrict } from "node:assert";
import { inspect, isDeepStrictEqual } from "node:util";

type AsyncOrSync<T> = T | Promise<T>;

function normalizeMessage(message: unknown): string | undefined {
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function formatValue(value: unknown): string {
  return inspect(value, { depth: 5, breakLength: 120 });
}

function createAssertionError(message: string): AssertionError {
  return new AssertionError({
    message,
    stackStartFn: assert,
  });
}

export function assert(value: unknown, message?: string): asserts value {
  assertStrict.ok(value, message);
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw createAssertionError(message ?? `Values are not equal.\n\nActual: ${formatValue(actual)}\nExpected: ${formatValue(expected)}`);
  }
}

export function assertNotEquals<T>(actual: T, expected: T, message?: string): void {
  if (isDeepStrictEqual(actual, expected)) {
    throw createAssertionError(message ?? `Expected values to differ, but both were ${formatValue(actual)}`);
  }
}

export function assertMatch(actual: string, expected: RegExp, message?: string): void {
  if (!expected.test(actual)) {
    throw createAssertionError(message ?? `Expected ${formatValue(actual)} to match ${expected}`);
  }
}

export function assertInstanceOf<T>(value: unknown, ctor: new (...args: any[]) => T, message?: string): asserts value is T {
  if (!(value instanceof ctor)) {
    throw createAssertionError(message ?? `Expected value to be instance of ${ctor.name}`);
  }
}

export function assertThrows(
  fn: () => unknown,
  ErrorClass?: new (...args: any[]) => Error,
  msgIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (ErrorClass && !(error instanceof ErrorClass)) {
      throw createAssertionError(`Expected ${ErrorClass.name}, got ${(error as Error)?.constructor?.name ?? typeof error}`);
    }
    const expectedMessage = normalizeMessage(msgIncludes);
    if (expectedMessage && !(error instanceof Error && error.message.includes(expectedMessage))) {
      throw createAssertionError(`Expected error message to include ${expectedMessage}`);
    }
    return error as Error;
  }
  throw createAssertionError("Expected function to throw");
}

export async function assertRejects(
  fnOrPromise: AsyncOrSync<unknown> | (() => AsyncOrSync<unknown>),
  ErrorClass?: new (...args: any[]) => Error,
  msgIncludes?: string,
): Promise<Error> {
  try {
    const result = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
    await result;
  } catch (error) {
    if (ErrorClass && !(error instanceof ErrorClass)) {
      throw createAssertionError(`Expected ${ErrorClass.name}, got ${(error as Error)?.constructor?.name ?? typeof error}`);
    }
    const expectedMessage = normalizeMessage(msgIncludes);
    if (expectedMessage && !(error instanceof Error && error.message.includes(expectedMessage))) {
      throw createAssertionError(`Expected error message to include ${expectedMessage}`);
    }
    return error as Error;
  }
  throw createAssertionError("Expected promise to reject");
}
