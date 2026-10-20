/**
 * computed.ts —— 计算属性的实现（lazy + dirty 脏标记）
 *
 * 对应 Vue3 源码：@vue/reactivity/src/computed.ts
 *
 * 核心设计（dirty 机制）：
 * 1. computed 内部持有一个 lazy 的 effect（runner），只有第一次读取 .value 才执行 getter；
 * 2. 依赖变化时，scheduler 不立刻重算，只把 dirty 置回 true（脏了）；
 * 3. 下次读取 .value 时发现 dirty 为 true 才真正重算。
 * 这样实现了"依赖变化才重算"和"不读取就不重算"两个目标。
 */
import { effect, activeEffect } from "./effect";
import { type EffectFn } from "./reactive";

export interface ComputedRef<T> {
  readonly value: T;
}

export function computed<T>(getter: () => T): ComputedRef<T> {
  let _value: T;
  /**脏标记：true 表示缓存的值已过期，需要重算 */
  let dirty = true;

  /**
   * 订阅者集合：读取过这个 computed 的外部 effect。
   * 当 computed 变脏时要通知它们重新执行。
   */
  const subscribers: Set<EffectFn> = new Set();

  // 内部 runner：真正执行 getter 的 effect。
  // lazy: true —— 创建时不执行；scheduler —— 依赖变化时只标记脏，不重算。
  const runner = effect(getter, {
    lazy: true,
    scheduler: () => {
      // 只有从干净变脏的那一刻才通知订阅者，避免依赖抖动导致重复通知
      if (!dirty) {
        dirty = true;
        for (const sub of [...subscribers]) {
          // 防自触发：订阅者自身执行过程中触发的变化不再通知它自己
          if (sub === activeEffect) continue;
          if (sub.options.scheduler) {
            sub.options.scheduler(sub);
          } else {
            sub.run();
          }
        }
      }
    },
  });

  const computedRef = {
    __v_isRef: true,
    get value(): T {
      // 读取时：脏了才重算，否则直接返回缓存（这就是"缓存"的实现）
      if (dirty) {
        // runner() 会执行 getter 并收集 getter 内部的依赖
        _value = runner() as T;
        dirty = false;
      }
      // 手动 track：把正在读取 .value 的外部 effect 记为订阅者，
      // 这样外部 effect 依赖的是 computed 本身，而不是 computed 的内部依赖
      if (activeEffect) {
        subscribers.add(activeEffect);
        activeEffect.deps.add(subscribers);
      }
      return _value;
    },
  };

  return computedRef as ComputedRef<T>;
}
