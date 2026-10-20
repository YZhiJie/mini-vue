/**
 * renderer 测试：vnode 结构、mount/patch props、key diff 复用与删除
 */
import { describe, it, expect, vi } from "vitest";
import { h, render, ShapeFlags, type VNode } from "../src";

function createContainer(): HTMLDivElement {
  return document.createElement("div");
}

/**把 vnode 数组渲染后返回容器内的根元素（ul 之类） */
function renderRoot(vnode: VNode): HTMLDivElement {
  const container = createContainer();
  render(vnode, container);
  return container;
}

describe("vnode 结构", () => {
  it("h/createVNode 生成 type/props/children/key/shapeFlag 完整的 vnode", () => {
    const vnode = h("div", { id: "x", key: "k" }, "text");
    expect(vnode.type).toBe("div");
    expect(vnode.props.id).toBe("x");
    expect(vnode.key).toBe("k"); // key 单独提取
    expect(vnode.children).toBe("text");
    expect(vnode.shapeFlag & ShapeFlags.ELEMENT).toBeTruthy();
    expect(vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN).toBeTruthy();

    const arrayChild = h("div", null, [h("span")]);
    expect(arrayChild.shapeFlag & ShapeFlags.ARRAY_CHILDREN).toBeTruthy();

    const compVnode = h({ render: () => h("div") });
    expect(compVnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT).toBeTruthy();
  });
});

describe("mount 与 patch：props", () => {
  it("挂载：标签、class、style 对象、事件、文本子节点", () => {
    const onClick = vi.fn();
    const container = renderRoot(
      h("div", { id: "app", class: "box", style: { fontSize: "14px" }, onClick }, "hello"),
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.id).toBe("app");
    expect(el.className).toBe("box");
    expect(el.getAttribute("style")).toContain("font-size: 14px");
    expect(el.textContent).toBe("hello");
    (el as HTMLElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("patch 更新属性、删除旧属性，且复用同一个 DOM 节点", () => {
    const container = createContainer();
    render(h("div", { id: "a", class: "old", title: "t" }, "1"), container);
    const el = container.firstElementChild!;
    render(h("div", { id: "b", class: "new" }, "2"), container);
    expect(container.firstElementChild).toBe(el); // 同类型复用
    expect(el.id).toBe("b");
    expect(el.className).toBe("new");
    expect(el.textContent).toBe("2");
    expect(el.hasAttribute("title")).toBe(false);
  });

  it("事件处理函数更新：旧监听被移除，新监听生效", () => {
    const first = vi.fn();
    const second = vi.fn();
    const container = createContainer();
    render(h("button", { onClick: first }, "btn"), container);
    const btn = container.firstElementChild!;
    render(h("button", { onClick: second }, "btn"), container);
    (btn as HTMLElement).click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("children 类型切换：数组与文本互转", () => {
    const container = createContainer();
    render(h("div", null, [h("span", null, "1"), h("span", null, "2")]), container);
    const el = container.firstElementChild!;
    expect(el.children.length).toBe(2);

    render(h("div", null, "text"), container);
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe("text");

    render(h("div", null, [h("span", null, "3")]), container);
    expect(el.children.length).toBe(1);
    expect(el.textContent).toBe("3");
  });
});

describe("key diff：按 key 映射复用与删除", () => {
  it("乱序更新时复用旧 DOM 节点并正确重排", () => {
    const container = renderRoot(
      h("ul", null, [
        h("li", { key: "a" }, "a"),
        h("li", { key: "b" }, "b"),
        h("li", { key: "c" }, "c"),
      ]),
    );
    const ul = container.firstElementChild!;
    const [a, , c] = Array.from(ul.children);

    render(
      h("ul", null, [
        h("li", { key: "c" }, "c"),
        h("li", { key: "a" }, "a"),
        h("li", { key: "b" }, "b"),
      ]),
      container,
    );
    const children = Array.from(ul.children);
    // DOM 节点按 key 复用（引用相等），顺序被正确移动
    expect(children[0]).toBe(c);
    expect(children[1]).toBe(a);
    expect(children[2].textContent).toBe("b");
  });

  it("删除被移除的 key 节点，新增没有的 key 节点", () => {
    const container = renderRoot(
      h("ul", null, [
        h("li", { key: "a" }, "a"),
        h("li", { key: "b" }, "b"),
        h("li", { key: "c" }, "c"),
      ]),
    );
    const ul = container.firstElementChild!;
    const [a, b, c] = Array.from(ul.children);

    render(
      h("ul", null, [
        h("li", { key: "a" }, "a"),
        h("li", { key: "d" }, "d"),
        h("li", { key: "c" }, "c"),
      ]),
      container,
    );
    expect(ul.children.length).toBe(3);
    expect(ul.children[0]).toBe(a); // a 复用
    expect(ul.children[1].textContent).toBe("d"); // d 新挂载
    expect(ul.children[2]).toBe(c); // c 复用
    expect(Array.from(ul.children).includes(b)).toBe(false); // b 已卸载
  });

  it("头部新增与尾部删除（双端对比命中）", () => {
    const container = renderRoot(
      h("ul", null, [
        h("li", { key: "a" }, "a"),
        h("li", { key: "b" }, "b"),
        h("li", { key: "c" }, "c"),
      ]),
    );
    const ul = container.firstElementChild!;

    render(
      h("ul", null, [
        h("li", { key: "x" }, "x"),
        h("li", { key: "y" }, "y"),
        h("li", { key: "a" }, "a"),
        h("li", { key: "b" }, "b"),
      ]),
      container,
    );
    // a b 复用并前移，c 被删除
    expect(ul.children.length).toBe(4);
    expect(ul.children[3].textContent).toBe("b");
    expect(ul.textContent).toBe("xyab");

    render(
      h("ul", null, [h("li", { key: "x" }, "x"), h("li", { key: "y" }, "y")]),
      container,
    );
    expect(ul.textContent).toBe("xy");
  });
});
