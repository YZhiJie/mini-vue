/**
 * vnode.ts —— 虚拟节点结构与创建
 *
 * 对应 Vue3 源码：@vue/runtime-core/src/vnode.ts
 * shapeFlag 用位运算存储多种状态：一个数字同时表达"是元素还是组件"和
 * "children 是文本还是数组"，比多个布尔字段更省内存，判断用按位与。
 */
import type { Component, ComponentInstance } from "./component";

/**文本节点的特殊 type：diff 与挂载时据此走文本分支 */
export const Text = Symbol("Text");

export const ShapeFlags = {
  ELEMENT: 1,
  STATEFUL_COMPONENT: 1 << 1,
  TEXT_CHILDREN: 1 << 2,
  ARRAY_CHILDREN: 1 << 3,
} as const;

export interface VNodeProps {
  [key: string]: unknown;
  key?: string | number;
}

export interface VNode {
  type: string | typeof Text | Component;
  props: VNodeProps;
  children: VNode[] | string | null;
  key: string | number | null;
  shapeFlag: number;
  /**挂载后指向真实 DOM（元素指向自身，组件指向子树根元素），diff 的锚点 */
  el: Node | null;
  /**组件 vnode 挂载后指向组件实例 */
  component: ComponentInstance | null;
}

// ComponentInstance 定义在 component.ts，这里用 type-only 引入避免运行时循环依赖
export type { ComponentInstance } from "./component";

/**
 * createVNode / h：创建虚拟节点。
 * h 是 Vue 中的惯用别名（hyperscript 的缩写），二者完全等价。
 */
export function createVNode(
  type: VNode["type"],
  props: VNodeProps | null = null,
  children: VNode["children"] | string | number | (VNode | string)[] | null = null,
): VNode {
  const vnode: VNode = {
    type,
    props: props ?? {},
    // key 只参与 diff 复用判断，不渲染到 DOM 上
    key: props?.key ?? null,
    shapeFlag: typeof type === "string" || type === Text ? ShapeFlags.ELEMENT : ShapeFlags.STATEFUL_COMPONENT,
    el: null,
    component: null,
    children: null,
  };
  normalizeChildren(vnode, children);
  return vnode;
}

export const h = createVNode;

export function createTextVNode(text: string): VNode {
  const vnode: VNode = {
    type: Text,
    props: {},
    key: null,
    shapeFlag: ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
    el: null,
    component: null,
    children: text,
  };
  return vnode;
}

/**
 * 归一化 children：
 * 字符串/数字 -> 文本子节点；数组 -> 数组子节点（内部的原始字符串转文本 vnode）。
 * 为什么统一：diff 时只需看 shapeFlag，不用到处 typeof 判断。
 */
function normalizeChildren(
  vnode: VNode,
  children: VNode["children"] | number | (VNode | string)[],
): void {
  if (typeof children === "string" || typeof children === "number") {
    vnode.shapeFlag |= ShapeFlags.TEXT_CHILDREN;
    vnode.children = String(children);
  } else if (Array.isArray(children)) {
    vnode.shapeFlag |= ShapeFlags.ARRAY_CHILDREN;
    vnode.children = children.map((child) =>
      typeof child === "string" ? createTextVNode(child) : child,
    );
  } else if (children != null) {
    vnode.children = children;
  }
}

/**类型与 key 都相同才认为是同一个节点，可以复用 DOM（isSameVNodeType） */
export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  return n1.type === n2.type && n1.key === n2.key;
}
