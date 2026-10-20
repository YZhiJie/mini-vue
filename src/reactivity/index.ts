/**
 * reactivity 模块入口：统一导出公共 API
 */
export {
  reactive,
  toRaw,
  isReactive,
  ReactiveFlags,
  targetMap,
} from "./reactive";
export type { EffectFn, EffectOptions } from "./reactive";
export { effect, stop, track, trigger } from "./effect";
export { ref, isRef, unref, toRefs, RefImpl } from "./ref";
export type { Ref } from "./ref";
export { computed } from "./computed";
export type { ComputedRef } from "./computed";
export { watch } from "./watch";
export type { WatchOptions, WatchStopHandle } from "./watch";
