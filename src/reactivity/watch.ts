/**
 * watch.ts —— 侦听器的实现
 *
 * 对应 Vue3 源码：@vue/runtime-core/src/apiWatch.ts（底层复用 @vue/reactivity）
 *
 * 实现思路：watch 本质是"一个 lazy effect + scheduler"。
 * - effect 负责收集 source 的依赖；
 * - 依赖变化时不直接跑回调，而是通过 scheduler 调度 job（对比旧值、执行回调）；
 * - 这就是 scheduler 概念最典型的应用：把"响应式触发"和"业务执行"解耦。
 */
import { effect, stop } from "./effect";
import { isObject, isReactive } from "./reactive";
import { isRef } from "./ref";

export interface WatchOptions {
  /**首次立即执行回调（oldValue 为 undefined） */
  immediate?: boolean;
  /**深度遍历 source，收集嵌套对象所有属性的依赖 */
  deep?: boolean;
  /**回调的第三个参数，注册清理函数（下次触发前 / stop 时执行） */
  onCleanup?: (cleanupFn: () => void) => void;
}

type WatchSource<T> = () => T;
type CleanupRegistrator = (cleanupFn: () => void) => void;
type WatchCallback<T> = (newValue: T, oldValue: T | undefined, onCleanup: CleanupRegistrator) => void;

export type WatchStopHandle = () => void;

/**
 * 递归遍历对象所有属性：deep 的本质就是"把每个嵌套属性都读一遍"，
 * 读到就会 track，从而收集整棵树上的依赖。
 */
function traverse(value: unknown, seen: Set<unknown> = new Set()): unknown {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    traverse((value as Record<string, unknown>)[key], seen);
  }
  return value;
}

export function watch<T>(
  source: WatchSource<T> | { value: T } | object,
  cb: WatchCallback<T>,
  options: WatchOptions = {},
): WatchStopHandle {
  let getter: () => unknown;
  let deep = options.deep ?? false;

  if (isRef(source)) {
    // ref：侦听 .value 的变化
    getter = () => (source as { value: unknown }).value;
  } else if (isReactive(source)) {
    // reactive 对象：Vue 的行为是强制 deep（读一遍所有属性才能收集依赖）
    getter = () => source;
    deep = true;
  } else if (typeof source === "function") {
    // getter 函数：最灵活的形式
    getter = source as WatchSource<T>;
  } else {
    console.warn("watch 的 source 需要 是 ref / reactive / getter 函数");
    getter = () => source;
  }

  if (deep) {
    const baseGetter = getter;
    getter = () => traverse(baseGetter());
  }

  /**上一次回调注册的清理函数，下次触发前执行 */
  let cleanup: (() => void) | null = null;
  const onCleanup: CleanupRegistrator = (fn) => {
    cleanup = fn;
  };

  const job = () => {
    // 先执行上一次注册的清理（对应 Vue 源码：runCb 前先 run cleanup）
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    const newValue = runner();
    // deep 模式下对象引用可能没变但内容变了，所以只要 deep 就触发
    if (deep || !Object.is(newValue, oldValue)) {
      cb(newValue as T, oldValue as T | undefined, onCleanup);
      oldValue = newValue;
    }
  };

  // 核心：effect + lazy + scheduler
  // 依赖变化时 effect 不会自己重跑，而是把控制权交给 job
  const runner = effect(getter, {
    lazy: true,
    scheduler: job,
  });

  let oldValue: unknown;
  if (options.immediate) {
    // immediate：不等依赖变化，创建时立即执行一次
    job();
  } else {
    // 否则先跑一次 getter，建立依赖并拿到旧值
    oldValue = runner();
  }

  // 返回停止侦听的函数
  return () => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    stop(runner);
  };
}
