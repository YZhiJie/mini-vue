/**
 * 组件测试：setup 返回状态 / setup 返回 render 函数 / props 与组件更新
 */
import { describe, it, expect } from "vitest";
import { h, ref, createApp, type Component } from "../src";

function createContainer(): HTMLDivElement {
  return document.createElement("div");
}

describe("组件 setup", () => {
  it("setup 返回状态对象：render 使用状态渲染，事件触发响应式更新", () => {
    const App: Component = {
      setup() {
        const count = ref(0);
        const increment = () => {
          count.value++;
        };
        return { count, increment };
      },
      render(ctx) {
        return h("div", null, [
          h("span", { class: "count" }, String(ctx.count)),
          h("button", { class: "inc", onClick: ctx.increment as () => void }, "+1"),
        ]);
      },
    };
    const container = createContainer();
    const instance = createApp(App).mount(container);
    expect(instance.isMounted).toBe(true);

    const span = container.querySelector(".count")!;
    expect(span.textContent).toBe("0");
    (container.querySelector(".inc") as HTMLButtonElement).click();
    // 教学版同步更新：状态变化直接触发渲染 effect 重新 patch
    expect(span.textContent).toBe("1");
  });

  it("setup 直接返回 render 函数", () => {
    const App: Component = {
      setup() {
        const msg = ref("hello");
        return () => h("p", { class: "msg" }, msg.value);
      },
    };
    const container = createContainer();
    createApp(App).mount(container);
    expect(container.querySelector(".msg")!.textContent).toBe("hello");
  });

  it("props 传递：父组件状态变化 -> 新 props -> 子组件响应式重渲染", () => {
    const Child: Component = {
      props: ["message"],
      render(ctx) {
        return h("p", { class: "child" }, String(ctx.message));
      },
    };
    const msg = ref("first");
    const Parent: Component = {
      setup() {
        return { msg };
      },
      render(ctx) {
        return h("div", null, [h(Child, { message: ctx.msg as string })]);
      },
    };
    const container = createContainer();
    createApp(Parent).mount(container);
    const childEl = container.querySelector(".child")!;
    expect(childEl.textContent).toBe("first");

    // 父状态变化触发父重渲染，传给子组件的新 props 自动触发子组件更新
    msg.value = "second";
    expect(childEl.textContent).toBe("second");
  });

  it("未声明的 props 不进入实例 props（简化版 props 解析）", () => {
    const captured: Record<string, unknown>[] = [];
    const Child: Component = {
      props: ["declared"],
      setup(props) {
        captured.push(props);
        return {};
      },
      render() {
        return h("i", { class: "child" }, "x");
      },
    };
    const Parent: Component = {
      render: () => h("div", null, [h(Child, { declared: "yes", extra: "ignored" })]),
    };
    const container = createContainer();
    createApp(Parent).mount(container);
    // setup 只收到声明过的 props，多余属性不透传（与 Vue 的 attrs 机制不同）
    expect(captured[0]).toEqual({ declared: "yes" });
    expect(container.querySelector(".child")).not.toBeNull();
  });

  it("createApp 支持选择器字符串挂载", () => {
    const root = document.createElement("div");
    root.id = "mount-target";
    document.body.appendChild(root);
    const App: Component = {
      render: () => h("b", null, "mounted"),
    };
    createApp(App).mount("#mount-target");
    expect(document.querySelector("#mount-target b")!.textContent).toBe("mounted");
    root.remove();
  });
});
