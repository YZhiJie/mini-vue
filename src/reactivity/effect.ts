/**
 * effect.ts —— 依赖收集（track）与依赖触发（trigger）的核心
 *
 * 对应 Vue3 源码：@vue/reactivity/src/effect.ts
 * 关键概念：
 * - activeEffect：当前正在运行的 effect，track 时把"谁在读"记录下来
 * - effectStack：处理嵌套 effect，执行完后恢复外层 effect
 * - cleanup：每次 effect 重新执行前，先把它从所有旧依赖集合里移除，
 *   再重新收集。这样分支切换（if/else 读不同属性）不会留下死依赖。
 */
import { targetMap, type EffectFn, type EffectOptions } from "./reactive";

/**当前正在执行的 effect（对应 Vue 源码的 activeEffect） */
export let activeEffect: EffectFn | undefined;

/**
 * effect 栈：处理嵌套 effect 的场景。
 * 如果只用一个 activeEffect 变量，内层 effect 执行完会把 activeEffect 置空，
 * 外层 effect 后续的属性读取就收集不到依赖了。所以需要栈结构：执行前入栈，
 * 执行完后出栈并把 activeEffect 恢复为栈顶（即外层 effect）。
 */
const effectStack: EffectFn[] = [];

/**
 * 依赖收集：在 Proxy 的 get 拦截中调用。
 * 把 activeEffect 记录到 targetMap[target][key] 中。
 */
export function track(target: object, key: PropertyKey): void {
  if (!activeEffect) return;

  let depsMap = targetMap.get(target);
  if (!depsMap) {
    // 第一层：对象 -> 属性依赖表
    targetMap.set(target, (depsMap = new Map()));
  }
  let deps = depsMap.get(key);
  if (!deps) {
    // 第二层：属性 -> effect 集合
    depsMap.set(key, (deps = new Set()));
  }
  if (!deps.has(activeEffect)) {
    deps.add(activeEffect);
    // 双向记录：effect 也记住"我被哪些集合收留了"，cleanup 时用
    activeEffect.deps.add(deps);
  }
}

/**
 * 依赖触发：在 Proxy 的 set/deleteProperty 拦截中调用。
 * 找到依赖该属性的所有 effect 并重新执行。
 */
export function trigger(target: object, key: PropertyKey): void {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;

  const deps = depsMap.get(key);
  if (!deps) return;

  // 复制一份再遍历：如果 effect 执行过程中又有 set 触发 trigger，
  // 直接遍历原 Set 会因为"边遍历边新增"导致死循环（Vue 源码同样的处理）
  const effectsToRun = new Set(deps);
  effectsToRun.forEach((effect) => runEffect(effect));
}

/**执行一个 effect：先 cleanup（解决分支切换依赖残留），再重新执行并收集依赖 */
function runEffect(effect: EffectFn): void {
  // 不重复执行自己：effect 内部同时读写同一属性时会递归触发自己（Vue 源码的防递归判断）
  if (effect === activeEffect) return;

  // 如果配置了 scheduler，就把"何时重新执行"交给调用方
  // （watch/computed/组件更新都靠它实现异步批量更新等高级行为）
  if (effect.options.scheduler) {
    effect.options.scheduler(effect);
    return;
  }
  effect.run();
}

/**
 * 创建一个响应式副作用：fn 内部读取响应式数据时会自动收集依赖，
 * 依赖变化时 fn 会重新执行。
 */
export function effect(fn: () => unknown, options: EffectOptions = {}): EffectFn {
  const _effect: EffectFn = Object.assign(() => _effect.run(), {
    options,
    deps: new Set<Set<EffectFn>>(),
    dirty: false,
    active: true,
    run() {
      if (!_effect.active) {
        // effect 被 stop 后不再响应，但仍要执行一次保证结果正确
        return fn();
      }
      // 先把自己从所有旧依赖中移除（cleanup），再重新收集
      // 为什么：effect 这次执行可能不再读取某个旧属性（分支切换），
      // 不清理的话旧属性的 set 仍会触发本 effect，造成多余更新
      cleanup(_effect);
      activeEffect = _effect;
      effectStack.push(_effect);
      try {
        return fn();
      } finally {
        effectStack.pop();
        // 恢复为外层 effect（嵌套场景），保证外层剩余的读取仍能被正确 track
        activeEffect = effectStack[effectStack.length - 1];
      }
    },
  });
  if (!options.lazy) {
    _effect.run();
  }
  return _effect;
}

/**stop：让 effect 永久失活，从所有依赖集合中移除 */
export function stop(effect: EffectFn): void {
  if (effect.active) {
    cleanup(effect);
    effect.active = false;
    effect.options.onStop?.();
  }
}

/**cleanup：把 effect 从它记录的所有依赖集合中移除，并清空记录 */
export function cleanup(effect: EffectFn): void {
  // 为什么从 deps 里拷贝再删：遍历过程中要删除元素，直接遍历会跳过元素
  const { deps } = effect;
  if (deps.size !== 0) {
    for (const dep of [...deps]) {
      dep.delete(effect);
    }
    deps.clear();
  }
}
