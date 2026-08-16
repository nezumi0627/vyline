import type { LooseType } from "@vyline/loose-types";
type RecordEvent = Record<string, (...args: LooseType[]) => LooseType>;
export declare class TypedEventEmitter<T extends RecordEvent, E extends keyof T = keyof T> {
    listeners: Map<E, T[E][]>;
    on<E2 extends E>(event: E2, ...listeners: T[E2][]): this;
    off<E2 extends E>(event: E2, ...listeners: T[E2][]): this;
    emit<E2 extends E>(event: E2, ...args: Parameters<T[E2]>): this;
    /**
     * This creates a promise that you can use for a single event.
     * @param event A event name
     */
    waitFor<E2 extends E, P = Parameters<T[E2]>>(event: E2): Promise<P>;
}
export {};
