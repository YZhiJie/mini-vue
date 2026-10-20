/**
 * mini-vue 顶层入口：一个包同时导出 reactivity 与 runtime-core
 * （Vue 官方拆成 @vue/reactivity 和 @vue/runtime-core 两个包，教学版合并）
 */
export * from "./reactivity";
export * from "./runtime-core";
