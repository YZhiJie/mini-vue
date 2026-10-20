/**
 * reactivity 核心测试：依赖收集与触发、嵌套对象、cleanup 分支、
 * effect 选项、ref、computed、watch
 */
import { describe, it, expect, vi } from "vitest";
import {
  reactive,
  toRaw,
  isReactive,
  targetMap,
  effect,
  stop,
  ref,
  computed,
  watch,
} from "../src";

describe("reactive：依赖收集与触发", () => {
  it("effect 首次执行收集依赖，依赖变化时重新执行", () => {
    const obj = reactive({ count: 0 });
    let dummy: number | undefined;
    effect(() => {
      dummy = obj.count;
    });
    expect(dummy).toBe(0);
    obj.count = 1;
    expect(dummy).toBe(1);
  });

  it("值未变化时不触发（Object.is 比较）", () => {
    const obj = reactive({ n: 1 });
    const fn = vi.fn(() => obj.n);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    obj.n = 1; // 相同值
    expect(fn).toHaveBeenCalledTimes(1);
    obj.n = NaN;
    expect(fn).toHaveBeenCalledTimes(2);
    obj.n = NaN; // NaN 与 NaN 相等
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("不同属性互不干扰：只触发依赖该属性的 effect", () => {
    const obj = reactive({ a: 1, b: 2 });
    const fnA = vi.fn(() => obj.a);
    const fnB = vi.fn(() => obj.b);
    effect(fnA);
    effect(fnB);
    obj.a = 10;
    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("依赖按 WeakMap<target, Map<key, Set<effect>>> 三层结构存储", () => {
    const obj = reactive({ a: 1 });
    const runner = effect(() => obj.a);
    const depsMap = targetMap.get(toRaw(obj));
    expect(depsMap).toBeInstanceOf(Map);
    const dep = depsMap!.get("a");
    expect(dep).toBeInstanceOf(Set);
    expect(dep!.has(runner)).toBe(true);
  });
});

describe("reactive：嵌套对象", () => {
  it("嵌套对象懒代理，深层属性变化触发 effect", () => {
    const obj = reactive({ nested: { deep: { count: 0 } } });
    // get 时才递归代理（懒代理），且走缓存
    expect(isReactive(obj.nested)).toBe(true);
    let dummy: number | undefined;
    effect(() => {
      dummy = obj.nested.deep.count;
    });
    obj.nested.deep.count = 42;
    expect(dummy).toBe(42);
  });

  it("重复代理返回缓存，toRaw 可还原原始对象", () => {
    const raw = { a: 1 };
    const p1 = reactive(raw);
    const p2 = reactive(raw);
    expect(p1).toBe(p2); // 同一 raw 只有一个 proxy
    expect(p1).not.toBe(raw);
    expect(toRaw(p1)).toBe(raw);
    expect(isReactive(p1)).toBe(true);
    expect(isReactive(raw)).toBe(false);
    expect(reactive(p1)).toBe(p1); // 代理再代理返回自身
  });
});

describe("effect 栈与 cleanup", () => {
  it("cleanup：分支切换后，不再依赖的属性变化不触发 effect", () => {
    const obj = reactive({ flag: true, a: "a", b: "b" });
    let dummy: string | undefined;
    const runner = effect(() => {
      dummy = obj.flag ? obj.a : obj.b;
    });
    expect(dummy).toBe("a");
    // 依赖了 flag 和 a 两个属性
    expect(runner.deps.size).toBe(2);
    obj.flag = false;
    expect(dummy).toBe("b");
    // 关键断言：切换分支后 a 已被 cleanup 掉，修改 a 不应触发重执行
    obj.a = "changed";
    expect(dummy).toBe("b");
    obj.b = "new-b";
    expect(dummy).toBe("new-b");
  });

  it("effect 栈：嵌套 effect 时内层不影响外层的依赖收集", () => {
    const obj = reactive({ x: 0, y: 0 });
    let outer: number | undefined;
    let inner: number | undefined;
    effect(() => {
      effect(() => {
        inner = obj.y;
      });
      // 若没有栈结构，此处 activeEffect 为空，obj.x 收集不到外层依赖
      outer = obj.x;
    });
    expect(outer).toBe(0);
    expect(inner).toBe(0);
    obj.x = 1;
    expect(outer).toBe(1);
    obj.y = 2;
    expect(inner).toBe(2);
  });

  it("lazy：创建时不执行，手动调用 runner 才执行", () => {
    const obj = reactive({ n: 1 });
    const fn = vi.fn(() => obj.n);
    const runner = effect(fn, { lazy: true });
    expect(fn).not.toHaveBeenCalled();
    runner();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scheduler：依赖变化时改由 scheduler 调度，不直接执行 effect", () => {
    const obj = reactive({ n: 1 });
    const fn = vi.fn(() => obj.n);
    const scheduled = vi.fn();
    const runner = effect(fn, { scheduler: scheduled });
    expect(fn).toHaveBeenCalledTimes(1);
    obj.n = 2;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledWith(runner);
    runner(); // 手动执行仍可拿到最新值
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stop：停止后不再响应依赖变化", () => {
    const obj = reactive({ n: 1 });
    const fn = vi.fn(() => obj.n);
    const runner = effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    stop(runner);
    obj.n = 2;
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("ref", () => {
  it("value 读取收集依赖，写入触发更新，相同值不触发", () => {
    const count = ref(0);
    const fn = vi.fn(() => count.value);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    count.value = 5;
    expect(fn).toHaveBeenCalledTimes(2);
    count.value = 5;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("对象值内部转 reactive，深层属性可响应", () => {
    const state = ref({ n: 1 });
    expect(isReactive(state.value)).toBe(true);
    const fn = vi.fn(() => state.value.n);
    effect(fn);
    state.value.n = 2;
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("computed：lazy 与 dirty 脏标记", () => {
  it("惰性求值：不读取不执行；依赖不变读缓存；依赖变化仅在读取时重算", () => {
    const obj = reactive({ n: 1 });
    const getter = vi.fn(() => obj.n * 2);
    const c = computed(getter);
    expect(getter).not.toHaveBeenCalled(); // lazy：创建不执行
    expect(c.value).toBe(2);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(c.value).toBe(2);
    expect(getter).toHaveBeenCalledTimes(1); // 缓存生效
    obj.n = 2;
    expect(getter).toHaveBeenCalledTimes(1); // 只标记 dirty，不立刻重算
    expect(c.value).toBe(4);
    expect(getter).toHaveBeenCalledTimes(2); // 读取时才重算
  });

  it("多个 effect 复用同一 computed，不重复计算", () => {
    const obj = reactive({ n: 1 });
    const getter = vi.fn(() => obj.n + 1);
    const c = computed(getter);
    let v1: number | undefined;
    let v2: number | undefined;
    effect(() => {
      v1 = c.value;
    });
    effect(() => {
      v2 = c.value;
    });
    // 第二个 effect 读取时直接复用第一个的计算结果
    expect(getter).toHaveBeenCalledTimes(1);
    obj.n = 10;
    // 触发两个 effect，但 getter 只因第一个 effect 重算一次
    expect(getter).toHaveBeenCalledTimes(2);
    expect(v1).toBe(11);
    expect(v2).toBe(11);
  });
});

describe("watch", () => {
  it("侦听 getter 函数，变化时回调拿到新旧值", () => {
    const obj = reactive({ n: 1 });
    const cb = vi.fn();
    watch(() => obj.n, cb);
    obj.n = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(2, 1, expect.any(Function));
  });

  it("immediate：创建时立即执行一次，旧值为 undefined", () => {
    const obj = reactive({ n: 1 });
    const cb = vi.fn();
    watch(() => obj.n, cb, { immediate: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1, undefined, expect.any(Function));
  });

  it("deep：深度侦听 reactive 对象的嵌套属性", () => {
    const obj = reactive({ nested: { count: 0 } });
    const cb = vi.fn();
    watch(obj, cb);
    obj.nested.count = 1;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("onCleanup：下次回调触发前执行上一次注册的清理函数", () => {
    const obj = reactive({ n: 1 });
    const cleanup = vi.fn();
    const cb = vi.fn(
      (_val: number, _old: number | undefined, onCleanup: (fn: () => void) => void) => {
        onCleanup(cleanup);
      },
    );
    watch(() => obj.n, cb);
    obj.n = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    obj.n = 3;
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("watch 返回停止函数，停止后不再触发", () => {
    const obj = reactive({ n: 1 });
    const cb = vi.fn();
    const stopWatch = watch(() => obj.n, cb);
    stopWatch();
    obj.n = 2;
    expect(cb).not.toHaveBeenCalled();
  });
});
