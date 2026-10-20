/**
 * renderer.ts —— 渲染器：vnode -> DOM 的挂载与更新（patch）
 *
 * 对应 Vue3 源码：@vue/runtime-core/src/renderer.ts
 * DOM 操作函数集中在文件底部（Vue 中抽象为 runtime-dom 的 nodeOps，
 * 使 runtime-core 可以跨平台）。教学版直接操作 DOM。
 */
import { effect } from "../reactivity";
import {
  ShapeFlags,
  Text,
  isSameVNodeType,
  type VNode,
} from "./vnode";
import {
  createComponentInstance,
  createRenderContext,
  resolveProps,
  setupComponent,
  updateProps,
  type ComponentInstance,
} from "./component";

/**DOM 操作集合：对应 Vue runtime-dom 的 nodeOps */
const nodeOps = {
  createElement: (tag: string): Element => document.createElement(tag),
  createText: (text: string): Text => document.createTextNode(text),
  setElementText: (el: Element, text: string): void => {
    // 直接覆盖 textContent：顺带清空旧子节点，比先删再加更简单
    el.textContent = text;
  },
  setText: (node: Text, text: string): void => {
    node.nodeValue = text;
  },
  insert: (child: Node, parent: Node, anchor: Node | null): void => {
    // insertBefore 的 anchor 为 null 时等价于 appendChild
    parent.insertBefore(child, anchor);
  },
  remove: (child: Node): void => {
    child.parentNode?.removeChild(child);
  },
};

/**className 命中率高的 camelCase 转 kebab-case（style 对象用） */
function toKebab(key: string): string {
  return key.replace(/([A-Z])/g, "-$1").toLowerCase();
}

/**属性打补丁：class/style/事件/普通属性（对应源码 runtime-dom 的 patchProp） */
function patchProp(el: Element, key: string, prevValue: unknown, nextValue: unknown): void {
  if (key === "key") return; // key 只用于 diff 复用，不渲染
  if (key === "class") {
    el.className = nextValue == null ? "" : String(nextValue);
  } else if (key === "style") {
    if (nextValue && typeof nextValue === "object") {
      // 对象 style 整体重建（简化：未做 style 增量 diff，见 README）
      const css = Object.entries(nextValue as Record<string, unknown>)
        .map(([k, v]) => `${toKebab(k)}: ${String(v)}`)
        .join("; ");
      el.setAttribute("style", css);
    } else if (nextValue == null || nextValue === false) {
      el.removeAttribute("style");
    } else {
      el.setAttribute("style", String(nextValue));
    }
  } else if (key.startsWith("on") && typeof nextValue === "function") {
    // 事件：on 开头按事件名绑定；先解绑旧函数再绑新函数，避免重复触发
    const event = key.slice(2).toLowerCase();
    if (typeof prevValue === "function") {
      el.removeEventListener(event, prevValue as EventListener);
    }
    el.addEventListener(event, nextValue as EventListener);
  } else if (nextValue == null || nextValue === false) {
    el.removeAttribute(key);
  } else {
    // 布尔 true 输出空值属性（如 disabled），其余转字符串
    el.setAttribute(key, nextValue === true ? "" : String(nextValue));
  }
}

/**
 * patch：核心调度入口。
 * n1 为 null 表示挂载；n1 类型与 n2 不同则卸载后按新挂载处理（Vue 同款策略）。
 * anchor 用于 children diff 时控制插入位置（插到 anchor 之前）。
 */
export function patch(n1: VNode | null, n2: VNode, container: Node, anchor: Node | null = null): void {
  if (n1 === n2) return;
  if (n1 && !isSameVNodeType(n1, n2)) {
    unmount(n1);
    n1 = null;
  }
  const { type } = n2;
  if (type === Text) {
    processText(n1, n2, container, anchor);
  } else if (typeof type === "string") {
    processElement(n1, n2, container, anchor);
  } else {
    processComponent(n1, n2, container, anchor);
  }
}

function processText(n1: VNode | null, n2: VNode, container: Node, anchor: Node | null): void {
  if (n1 == null) {
    n2.el = nodeOps.createText(n2.children as string);
    nodeOps.insert(n2.el, container, anchor);
  } else {
    const el = (n2.el = n1.el!);
    if (n1.children !== n2.children) {
      nodeOps.setText(el as Text, n2.children as string);
    }
  }
}

function processElement(n1: VNode | null, n2: VNode, container: Node, anchor: Node | null): void {
  if (n1 == null) {
    mountElement(n2, container, anchor);
  } else {
    patchElement(n1, n2);
  }
}

function mountElement(vnode: VNode, container: Node, anchor: Node | null): void {
  const el = (vnode.el = nodeOps.createElement(vnode.type as string));
  const { props, children, shapeFlag } = vnode;
  if (props) {
    for (const key in props) {
      patchProp(el, key, null, props[key]);
    }
  }
  if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
    nodeOps.setElementText(el, children as string);
  } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    for (const child of children as VNode[]) {
      patch(null, child, el);
    }
  }
  nodeOps.insert(el, container, anchor);
}

function patchElement(n1: VNode, n2: VNode): void {
  // 复用旧 DOM：新 vnode 的 el 指向旧节点的 el（这是 diff 复用的本质）
  const el = (n2.el = n1.el) as Element;
  const oldProps = n1.props;
  const newProps = n2.props;
  for (const key in newProps) {
    if (!Object.is(oldProps[key], newProps[key])) {
      patchProp(el, key, oldProps[key], newProps[key]);
    }
  }
  for (const key in oldProps) {
    if (!(key in newProps)) {
      patchProp(el, key, oldProps[key], null);
    }
  }
  patchChildren(n1, n2, el);
}

function patchChildren(n1: VNode, n2: VNode, container: Node): void {
  const prevShape = n1.shapeFlag;
  const nextShape = n2.shapeFlag;
  if (nextShape & ShapeFlags.TEXT_CHILDREN) {
    // 新文本：旧的数组子节点先全部卸载
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
      unmountChildren(n1.children as VNode[]);
    }
    if (n1.children !== n2.children) {
      nodeOps.setElementText(container as Element, n2.children as string);
    }
  } else if (nextShape & ShapeFlags.ARRAY_CHILDREN) {
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
      // 数组 -> 数组：进入 diff
      diffArrayChildren(n1.children as VNode[], n2.children as VNode[], container);
    } else {
      // 文本/空 -> 数组：先清空文本，再挂载数组
      if (prevShape & ShapeFlags.TEXT_CHILDREN) {
        nodeOps.setElementText(container as Element, "");
      }
      for (const child of n2.children as VNode[]) {
        patch(null, child, container);
      }
    }
  } else {
    // 新 children 为空
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
      unmountChildren(n1.children as VNode[]);
    } else if (prevShape & ShapeFlags.TEXT_CHILDREN) {
      nodeOps.setElementText(container as Element, "");
    }
  }
}

/**
 * 数组 children 的 diff：双端对比简化版。
 *
 * S1/S2：头尾同步（类型与 key 相同的直接 patch 复用，这是"双端对比"）；
 * S3/S4：一边遍历完后的纯新增 / 纯删除；
 * S5  中段乱序：按 key 建 Map 复用 + 移动，找不到就挂载，旧节点未复用则卸载。
 *
 * 与真 Vue 的差别（重要）：Vue 用"最长递增子序列（LIS）"计算哪些节点可以
 * 不动，只移动必须移动的节点；这里简化为"每个复用节点都移动到 anchor 前"，
 * 结果正确但移动次数不是最优，最坏 O(n) 次 DOM 移动。
 */
function diffArrayChildren(c1: VNode[], c2: VNode[], container: Node): void {
  let i = 0;
  let e1 = c1.length - 1;
  let e2 = c2.length - 1;

  // S1: 头部同步
  while (i <= e1 && i <= e2 && isSameVNodeType(c1[i], c2[i])) {
    patch(c1[i], c2[i], container);
    i++;
  }
  // S2: 尾部同步
  while (i <= e1 && i <= e2 && isSameVNodeType(c1[e1], c2[e2])) {
    patch(c1[e1], c2[e2], container);
    e1--;
    e2--;
  }
  // S3: 旧的已遍历完，新的还有剩余 -> 全部是新增
  if (i > e1) {
    // anchor 取剩余新节点之后第一个节点（尾部同步段已挂载，可作为插入锚点）
    const anchor = e2 + 1 < c2.length ? c2[e2 + 1].el : null;
    while (i <= e2) {
      patch(null, c2[i], container, anchor);
      i++;
    }
    return;
  }
  // S4: 新的已遍历完，旧的还有剩余 -> 全部是删除
  if (i > e2) {
    while (i <= e1) {
      unmount(c1[i]);
      i++;
    }
    return;
  }
  // S5: 中段乱序
  const oldMiddle = c1.slice(i, e1 + 1);
  const newMiddle = c2.slice(i, e2 + 1);
  // key -> 旧中段下标 的映射：有 key 时按 key 映射复用
  const keyToOldIndex = new Map<string | number, number>();
  oldMiddle.forEach((vnode, index) => {
    if (vnode.key != null) keyToOldIndex.set(vnode.key, index);
  });
  // 中段之后的第一个节点一定已挂载（S2 同步过），作为所有插入的锚点
  const anchor = e2 + 1 < c2.length ? c2[e2 + 1].el : null;
  const reused = new Array<boolean>(oldMiddle.length).fill(false);

  for (const vnode of newMiddle) {
    const oldIndex = vnode.key != null ? keyToOldIndex.get(vnode.key) : undefined;
    if (oldIndex !== undefined) {
      reused[oldIndex] = true;
      patch(oldMiddle[oldIndex], vnode, container, anchor);
      // patch 复用了旧 DOM，这里把它移动到锚点前（按新顺序逐个就位）
      nodeOps.insert(vnode.el!, container, anchor);
    } else {
      // 无 key 或 key 匹配不上：简化处理为挂载新节点
      patch(null, vnode, container, anchor);
    }
  }
  reused.forEach((isReused, index) => {
    if (!isReused) unmount(oldMiddle[index]);
  });
}

function unmountChildren(children: VNode[]): void {
  for (const child of children) {
    unmount(child);
  }
}

function unmount(vnode: VNode): void {
  if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
    // 组件卸载：递归卸载其子树（真实 Vue 还会触发 onUnmounted 等生命周期）
    const subTree = vnode.component?.subTree;
    if (subTree) unmount(subTree);
  } else if (vnode.el) {
    nodeOps.remove(vnode.el);
  }
}

/* --------------------------- 组件处理 --------------------------- */

function processComponent(n1: VNode | null, n2: VNode, container: Node, anchor: Node | null): void {
  if (n1 == null) {
    mountComponent(n2, container, anchor);
  } else {
    updateComponent(n1, n2);
  }
}

function mountComponent(vnode: VNode, container: Node, anchor: Node | null): void {
  const instance = createComponentInstance(vnode);
  vnode.component = instance;
  resolveProps(instance, vnode.props);
  setupComponent(instance);
  setupRenderEffect(instance, container, anchor);
}

function updateComponent(n1: VNode, n2: VNode): void {
  const instance = n1.component!;
  n2.component = instance;
  instance.vnode = n2;
  // 先给个兜底 el：若 props 没有触发重渲染，新 vnode 沿用旧 DOM
  n2.el = n1.el;
  // 响应式 props：值有变化的 key 会自动触发 render effect 重渲染
  updateProps(instance, n2.props);
}

/**
 * 组件的渲染副作用：这是"响应式系统"与"运行时"的连接点。
 * effect 包住 render + patch：render 里读取的响应式状态（setupState 里的
 * ref、instance.props）成为依赖，状态变化时 effect 重新执行完成组件更新。
 * （Vue 中这里还有 scheduler + queueJob 做异步批量更新，教学版同步执行。）
 */
function setupRenderEffect(instance: ComponentInstance, container: Node, anchor: Node | null): void {
  const ctx = createRenderContext(instance);
  const renderEffect = effect(() => {
    if (!instance.isMounted) {
      // 初次挂载：render 得到子树后递归 patch
      const subTree = instance.render(ctx);
      instance.subTree = subTree;
      patch(null, subTree, container, anchor);
      // 组件 vnode 的 el 指向子树根节点，供父级 diff 与 anchor 使用
      instance.vnode.el = subTree.el;
      instance.isMounted = true;
    } else {
      // 更新：旧子树 -> 新子树 做 patch
      const subTree = instance.render(ctx);
      patch(instance.subTree!, subTree, container);
      instance.vnode.el = subTree.el;
      instance.subTree = subTree;
    }
  });
  // update 暴露手动重渲染入口（测试与调试用）
  instance.update = () => renderEffect.run();
}

/* --------------------------- 顶层渲染入口 --------------------------- */

/**记录每个容器当前渲染的 vnode，用于后续更新（对应源码的 container._vnode） */
const containerVNodeMap = new WeakMap<Node, VNode>();

export function render(vnode: VNode, container: Node): void {
  const prev = containerVNodeMap.get(container) ?? null;
  if (prev) {
    patch(prev, vnode, container);
  } else {
    patch(null, vnode, container);
  }
  containerVNodeMap.set(container, vnode);
}

/**测试辅助：清空记录，允许对同一容器重新 mount */
export function resetContainer(container: Node): void {
  containerVNodeMap.delete(container);
}
