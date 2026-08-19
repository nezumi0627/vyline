/**
 * @module Vyline loose types
 */
export type LooseType = any;
export type LooseArray = LooseType[];
export type LooseObject<Must extends Record<PropertyKey, LooseType> = {}> = Record<
  PropertyKey,
  LooseType
> &
  Must;
export type LooseFunction<
  Args extends LooseType[] = LooseType[],
  Ret extends LooseType = LooseType,
> = (...args: Args) => Ret;
export type LoosePrimitive = string | number | boolean | null | undefined;
