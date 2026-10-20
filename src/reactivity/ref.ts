/**
 * ref.ts —— 基础类型 / 单值响应式的实现
 *
 * 对应 Vue3 源码：@vue/reactivity/src/ref.ts
 *
 * 为什么需要 ref：Proxy 只能代理对象，无法拦截 `let count = 1` 这种原始值
 * 的读写。ref 把值包进一个对象的 value 属性上，再借助 getter/setter
 * 手动调用 track/trigger，绕开了 Proxy 的限制。
 *
 * 用 class 的 getter/setter 而不是 Proxy：单个属性没必要用 Proxy 这么重，
 * Vue 源码的 RefImpl 也是这么做的。
 */
import { activeEffect } from "./effect";
import { reactive, isObject, isReactive, type EffectFn } from "./reactive";

export interface Ref<T = unknown> {
  value: T;
}

export class RefImpl<T> implements Ref<T> {
  private _value: T;
  /**保存原始值，用于新旧值比较 */
  public _rawValue: T;
  /**
   * 依赖集合：ref 的"属性"只有 value 一个，所以不需要 targetMap 三层结构，
   * 自己持有一个 Set 就够了。对应 Vue 源码 RefImpl.dep。
   */
  public dep: Set<EffectFn> = new Set();
  public readonly __v_isRef = true;

  constructor(value: T) {
    this._rawValue = value;
    // 对象值内部转 reactive：让 ref({ a: 1 }).value.a++ 也能响应
    // 对应 Vue 源码的 toReactive（内部就是 conditional reactive()）
    this._value = convert(value);
  }

  get value(): T {
    // 手动 track：把当前 effect 加入自己的 dep（对应 Vue 源码的 trackRefValue）
    // activeEffect 是 effect.ts 导出的活绑定，getter 执行时总能读到当前值
    if (activeEffect) {
      this.dep.add(activeEffect);
      // 反向记录：cleanup 时要把自己从 dep 中删掉，必须让 effect 知道这个集合
      activeEffect.deps.add(this.dep);
    }
    return this._value;
  }

  set value(newValue: T) {
    // 用原始值比较：新旧值是同一个对象（或相等的原始值）时不触发
    if (Object.is(this._rawValue, newValue)) return;
    this._rawValue = newValue;
    // 新值是对象时也要转 reactive，保证整个生命周期行为一致
    this._value = convert(newValue);
    // 手动 trigger（对应 Vue 源码的 triggerRefValue）
    for (const effect of [...this.dep]) {
      // 防自触发：effect 在自己的执行过程中修改了 ref，不再重复执行自己
      if (effect === activeEffect) continue;
      if (effect.options.scheduler) {
        effect.options.scheduler(effect);
      } else {
        effect.run();
      }
    }
  }
}

function convert<T>(value: T): T {
  return isObject(value) ? (reactive(value) as T) : value;
}

export function ref<T>(value: T): Ref<T> {
  return new RefImpl(value) as unknown as Ref<T>;
}

export function isRef(value: unknown): value is Ref {
  return isObject(value) && (value as { __v_isRef?: boolean }).__v_isRef === true;
}

/**unref：是 ref 就取 value，否则原样返回 */
export function unref<T>(value: T | Ref<T>): T {
  return isRef(value) ? value.value : (value as T);
}

/**
 * toRefs：把 reactive 对象的每个属性转成 ref，
 * 常用于 setup 返回时保持解构后的响应性。
 */
export function toRefs<T extends object>(target: T): { [K in keyof T]: Ref<T[K]> } {
  if (!isReactive(target)) {
    console.warn("toRefs 期望接收一个 reactive 对象");
  }
  const result = {} as { [K in keyof T]: Ref<T[K]> };
  for (const key of Object.keys(target) as (keyof T)[]) {
    result[key] = propertyToRef(target, key) as Ref<T[keyof T]>;
  }
  return result;
}

/**
 * 单属性转 ref：getter/setter 转发到原 reactive 对象的属性读写上，
 * 这样解构出来的 ref 依然和源对象保持双向同步。
 */
function propertyToRef<T extends object, K extends keyof T>(target: T, key: K): Ref<T[K]> {
  return {
    get value() {
      return target[key];
    },
    set value(newValue) {
      target[key] = newValue;
    },
  } as Ref<T[K]>;
}
