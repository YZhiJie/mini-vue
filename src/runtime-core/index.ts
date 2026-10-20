/**
 * runtime-core 模块入口
 */
export { createVNode, h, createTextVNode, isSameVNodeType, Text, ShapeFlags } from "./vnode";
export type { VNode, VNodeProps } from "./vnode";
export {
  createComponentInstance,
  createRenderContext,
  resolveProps,
  setupComponent,
  updateProps,
} from "./component";
export type { Component, ComponentInstance, RenderContext } from "./component";
export { patch, render, resetContainer } from "./renderer";
export { createApp } from "./apiCreateApp";
export type { App } from "./apiCreateApp";
