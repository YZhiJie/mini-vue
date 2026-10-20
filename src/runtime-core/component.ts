/**
 * component.ts —— 有状态组件的实例与初始化
 *
 * 对应 Vue3 源码：@vue/runtime-core/src/component.ts
 * "有状态组件"（stateful component）指 setup 返回状态对象、组件上另写 render
 * 的形式（区别于函数式组件）。渲染副作用（effect）在 renderer.ts 中建立，
 * 这样渲染器可以把 patch 传进来，避免两个模块运行时循环依赖。
 */
import { reactive } from "../reactivity";
import { isRef } from "../reactivity/ref";
import type { VNode, VNodeProps } from "./vnode";

/**
 * 组件的形状：props 声明用字符串数组（教学简化，Vue 中是对象并含校验与
 * 默认值）。setup 接收解析后的 props，返回状态对象或直接返回 render 函数。
 */
export interface Component {
  name?: string;
  /**声明的 prop 名列表，父组件传入的多余属性不进入实例 props（attrs 透传未实现） */
  props?: string[];
  setup?: (props: Record<string, unknown>) => Record<string, unknown> | ((ctx: RenderContext) => VNode);
  render?: (ctx: RenderContext) => VNode;
}

export type RenderContext = Record<string, unknown>;

export interface ComponentInstance {
  type: Component;
  /**当前组件对应的 vnode */
  vnode: VNode;
  /**响应式 props：被 render 读取后自动建立依赖，父组件更新时自动重渲染 */
  props: Record<string, unknown>;
  /**setup 返回的状态对象 */
  setupState: Record<string, unknown> | null;
  /**最终使用的渲染函数：setup 返回函数则优先用之，否则用组件的 render */
  render: (ctx: RenderContext) => VNode;
  /**当前渲染出的子树，更新时作为 patch 的旧节点 */
  subTree: VNode | null;
  isMounted: boolean;
  /**渲染 effect 的手动执行入口 */
  update: (() => void) | null;
}

export function createComponentInstance(vnode: VNode): ComponentInstance {
  return {
    type: vnode.type as Component,
    vnode,
    props: {},
    setupState: null,
    render: () => {
      throw new Error("组件缺少 render 函数");
    },
    subTree: null,
    isMounted: false,
    update: null,
  };
}

/**
 * props 解析：只取组件声明过的属性。
 * 为什么做成 reactive：render 中读取 props 会收集依赖，父组件更新传入新值时
 * （对实例 props 做 set/delete），render effect 自动重新执行——这是"组件更新"
 * 的响应式来源，等价于 Vue 中 shallowReactive 的 instance.props。
 */
export function resolveProps(instance: ComponentInstance, rawProps: VNodeProps): void {
  const declared = instance.type.props ?? [];
  const resolved: Record<string, unknown> = {};
  for (const key of declared) {
    if (key in rawProps) {
      resolved[key] = rawProps[key];
    }
  }
  instance.props = reactive(resolved);
}

/**组件更新时用新 vnode 的属性刷新响应式 props，触发 render effect */
export function updateProps(instance: ComponentInstance, rawProps: VNodeProps): void {
  const declared = instance.type.props ?? [];
  const next: Record<string, unknown> = {};
  for (const key of declared) {
    if (key in rawProps) {
      next[key] = rawProps[key];
    }
  }
  // 逐 key set/delete 走 reactive 触发；值未变的 key 不会触发（Object.is 判断）
  for (const key of Object.keys(instance.props)) {
    if (!(key in next)) {
      delete instance.props[key];
    }
  }
  for (const [key, value] of Object.entries(next)) {
    instance.props[key] = value;
  }
}

/**执行 setup，确定 setupState 与最终 render（对应源码 setupStatefulComponent） */
export function setupComponent(instance: ComponentInstance): void {
  const { setup, render } = instance.type;
  if (setup) {
    const setupResult = setup(instance.props);
    if (typeof setupResult === "function") {
      // setup 返回函数：视为 render 函数（对应 Vue 的行为）
      instance.render = setupResult as ComponentInstance["render"];
      return;
    }
    instance.setupState = setupResult ?? {};
  }
  instance.render = (render ?? instance.render) as ComponentInstance["render"];
}

/**
 * 渲染上下文：render(ctx) 中的 ctx。
 * 用 Proxy 合并 setupState 与 props 的读取，并把 setup 返回的 ref 自动解包
 * （对应 Vue 的 instance.proxy / PublicInstanceProxyHandlers）。
 * 读取 ref 的 .value 会触发 ref 的 track，从而让渲染 effect 收集到依赖。
 */
export function createRenderContext(instance: ComponentInstance): RenderContext {
  return new Proxy({} as RenderContext, {
    get(_target, key: string) {
      const state = instance.setupState;
      if (state && key in state) {
        const value = state[key];
        return isRef(value) ? value.value : value;
      }
      return instance.props[key];
    },
    has(_target, key: string) {
      return (instance.setupState && key in instance.setupState) || key in instance.props;
    },
  });
}
