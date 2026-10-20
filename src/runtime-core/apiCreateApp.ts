/**
 * apiCreateApp.ts —— createApp 的实现
 *
 * 对应 Vue3 源码：@vue/runtime-core/src/apiCreateApp.ts
 * createApp(根组件) 返回一个带 mount 方法的对象，形成链式调用。
 */
import { createVNode } from "./vnode";
import type { Component, ComponentInstance, RenderContext } from "./component";
import { render } from "./renderer";

export interface App {
  mount(rootContainer: string | Element): ComponentInstance;
}

export function createApp(rootComponent: Component): App {
  return {
    mount(rootContainer) {
      // 支持选择器字符串与 DOM 元素两种入参（对应 Vue 的 normalizeContainer）
      const container =
        typeof rootContainer === "string"
          ? document.querySelector(rootContainer)
          : rootContainer;
      if (!container) {
        throw new Error(`mount 失败：找不到容器 ${String(rootContainer)}`);
      }
      const vnode = createVNode(rootComponent);
      render(vnode, container);
      // 返回实例（对应 Vue 返回组件公共代理，这里直接返回实例便于测试调试）
      return vnode.component!;
    },
  };
}

export type { Component, RenderContext };
