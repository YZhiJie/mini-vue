/**
 * 计数器示例：演示 reactive -> 渲染 effect -> patch 的完整链路
 * 使用前先执行 pnpm run build:example 生成 bundle.js
 */
import { createApp, h, ref, type Component } from "../src";

const App: Component = {
  setup() {
    const count = ref(0);
    return {
      count,
      increment: () => {
        count.value++;
      },
      decrement: () => {
        count.value--;
      },
    };
  },
  render(ctx) {
    return h("div", { class: "counter" }, [
      h("h1", null, "mini-vue 计数器"),
      h("p", { class: "value" }, String(ctx.count)),
      h("div", { class: "actions" }, [
        h("button", { onClick: ctx.decrement as () => void }, "-1"),
        h("button", { onClick: ctx.increment as () => void }, "+1"),
      ]),
    ]);
  },
};

createApp(App).mount("#app");
