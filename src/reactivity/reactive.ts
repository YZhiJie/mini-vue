/**
 * reactive.ts —— 响应式对象的实现
 *
 * 对应 Vue3 源码：@vue/reactivity/src/reactive.ts
 * 核心思路：用 Proxy 拦截对象的 get/set，在 get 中做依赖收集（track），
 * 在 set 中做依赖触发（trigger）。Reflect 是为了让函数内部的 this / 默认行为
 * 与代理行为保持一致（比如 getter 中访问 this.xxx 也能被拦截到）。
 */

// 循环引用说明：effect.ts 需要本文件的 targetMap/isObject，
// 本文件需要 effect.ts 的 track/trigger。两者都只在运行时（函数调用时）互相使用，
// ESM 的活绑定 + 函数提升可以安全处理这种循环。
import { track, trigger } from "./effect";

/**effect 的运行时形态（类型定义放在这里是因为 targetMap 需要它） */
export interface EffectFn {
  (): unknown;
  /**重新执行：cleanup 旧依赖 -> 执行 fn -> 重新收集依赖 */
  run: () => unknown;
  /**effect 的配置，scheduler 用于 trigger 时替代直接执行 */
  options: EffectOptions;
  /**
   * 记录"所有收集了这个 effect 的依赖集合"。
   * cleanup 时遍历它把自己从每个依赖集合中删除，这是解决分支切换残留依赖的关键。
   */
  deps: Set<Set<EffectFn>>;
  /**computed 用的脏标记：依赖变化时置为 true */
  dirty: boolean;
  /**effect 是否处于激活状态（被 stop / 作为 runner 复用时可能关闭） */
  active: boolean;
}

export interface EffectOptions {
  lazy?: boolean;
  scheduler?: (effect: EffectFn) => void;
  onStop?: () => void;
}

/**
 * 依赖存储的三层结构（对应 Vue 源码中的 targetMap）：
 *
 *   WeakMap<target, Map<key, Set<Effect>>>
 *      对象  ->   属性  ->   依赖该属性的 effect 集合
 *
 * 用 WeakMap 的原因：当响应式对象没有任何引用被销毁时，
 * 它对应的依赖表也能被垃圾回收，避免内存泄漏。
 */
export const targetMap = new WeakMap<object, Map<PropertyKey, Set<EffectFn>>>();

export function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

/**缓存原始对象 -> 代理对象，保证同一个 raw 只有一个 proxy 实例 */
const reactiveMap = new WeakMap<object, object>();

/**
 * 创建响应式代理。
 * 注意懒代理技巧：只有真正读取嵌套对象的属性时（get 触发时），
 * 才对嵌套对象调用 reactive，而不是初始化时递归代理整棵对象树。
 * 这样可以避免初始化开销，也符合 Vue3 的行为。
 */
export function reactive<T extends object>(target: T): T {
  // 已是代理则直接返回，避免重复包一层
  if (isReactive(target)) {
    return target;
  }
  return createReactiveObject(target);
}

function createReactiveObject<T extends object>(target: T): T {
  const existing = reactiveMap.get(target);
  // 重复代理返回缓存：保证两次 reactive(obj) 是同一个 proxy（引用相等）
  if (existing) {
    return existing as T;
  }
  const proxy = new Proxy(target, {
    get(target, key, receiver) {
      // 拦截元信息读取（对应 Vue 源码中 baseHandlers 里的 ReactiveFlags 分支）
      if (key === ReactiveFlags.IS_REACTIVE) return true;
      if (key === ReactiveFlags.RAW) return target;

      const res = Reflect.get(target, key, receiver);
      // 只在存在 activeEffect 时收集依赖；非 effect 上下文中的读取不需要 track
      track(target, key);
      // 嵌套对象懒代理：读取到对象属性时才递归 reactive
      if (isObject(res)) {
        return reactive(res as object) as typeof res;
      }
      return res;
    },
    set(target, key, value, receiver) {
      const oldValue = Reflect.get(target, key, receiver);
      const result = Reflect.set(target, key, value, receiver);
      // 值真正变化时才触发。Object.is 已把 NaN 视为与自身相等（比 === 更严格），
      // 与 Vue 源码 hasChanged 的实现一致
      if (!Object.is(oldValue, value)) {
        trigger(target, key);
      }
      return result;
    },
    deleteProperty(target, key) {
      const hadKey = Reflect.has(target, key);
      const result = Reflect.deleteProperty(target, key);
      // 删除属性等价于把 key 置为 undefined，同样要触发依赖
      if (hadKey) {
        trigger(target, key);
      }
      return result;
    },
  });
  reactiveMap.set(target, proxy);
  return proxy;
}

// 用对象常量而非 enum：esbuild 单文件转译时无法跨文件内联 const enum
export const ReactiveFlags = {
  IS_REACTIVE: "__v_isReactive",
  RAW: "__v_raw",
} as const;

export type ReactiveFlagsKey = (typeof ReactiveFlags)[keyof typeof ReactiveFlags];

/**获取响应式代理背后的原始对象（对应 Vue 源码的 toRaw） */
export function toRaw<T extends object>(observed: T): T {
  const raw = (observed as T & { [ReactiveFlags.RAW]?: T })[ReactiveFlags.RAW];
  return raw ? toRaw(raw) : observed;
}

export function isReactive(value: unknown): boolean {
  return (
    isObject(value) &&
    Boolean((value as { [ReactiveFlags.IS_REACTIVE]?: boolean })[ReactiveFlags.IS_REACTIVE])
  );
}
