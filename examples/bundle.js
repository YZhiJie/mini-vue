// src/reactivity/effect.ts
var activeEffect;
var effectStack = [];
function track(target, key) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) {
    targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
  }
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, deps = /* @__PURE__ */ new Set());
  }
  if (!deps.has(activeEffect)) {
    deps.add(activeEffect);
    activeEffect.deps.add(deps);
  }
}
function trigger(target, key) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  const deps = depsMap.get(key);
  if (!deps) return;
  const effectsToRun = new Set(deps);
  effectsToRun.forEach((effect2) => runEffect(effect2));
}
function runEffect(effect2) {
  if (effect2 === activeEffect) return;
  if (effect2.options.scheduler) {
    effect2.options.scheduler(effect2);
    return;
  }
  effect2.run();
}
function effect(fn, options = {}) {
  const _effect = Object.assign(() => _effect.run(), {
    options,
    deps: /* @__PURE__ */ new Set(),
    dirty: false,
    active: true,
    run() {
      if (!_effect.active) {
        return fn();
      }
      cleanup(_effect);
      activeEffect = _effect;
      effectStack.push(_effect);
      try {
        return fn();
      } finally {
        effectStack.pop();
        activeEffect = effectStack[effectStack.length - 1];
      }
    }
  });
  if (!options.lazy) {
    _effect.run();
  }
  return _effect;
}
function cleanup(effect2) {
  const { deps } = effect2;
  if (deps.size !== 0) {
    for (const dep of [...deps]) {
      dep.delete(effect2);
    }
    deps.clear();
  }
}

// src/reactivity/reactive.ts
var targetMap = /* @__PURE__ */ new WeakMap();
function isObject(value) {
  return typeof value === "object" && value !== null;
}
var reactiveMap = /* @__PURE__ */ new WeakMap();
function reactive(target) {
  if (isReactive(target)) {
    return target;
  }
  return createReactiveObject(target);
}
function createReactiveObject(target) {
  const existing = reactiveMap.get(target);
  if (existing) {
    return existing;
  }
  const proxy = new Proxy(target, {
    get(target2, key, receiver) {
      if (key === ReactiveFlags.IS_REACTIVE) return true;
      if (key === ReactiveFlags.RAW) return target2;
      const res = Reflect.get(target2, key, receiver);
      track(target2, key);
      if (isObject(res)) {
        return reactive(res);
      }
      return res;
    },
    set(target2, key, value, receiver) {
      const oldValue = Reflect.get(target2, key, receiver);
      const result = Reflect.set(target2, key, value, receiver);
      if (!Object.is(oldValue, value)) {
        trigger(target2, key);
      }
      return result;
    },
    deleteProperty(target2, key) {
      const hadKey = Reflect.has(target2, key);
      const result = Reflect.deleteProperty(target2, key);
      if (hadKey) {
        trigger(target2, key);
      }
      return result;
    }
  });
  reactiveMap.set(target, proxy);
  return proxy;
}
var ReactiveFlags = {
  IS_REACTIVE: "__v_isReactive",
  RAW: "__v_raw"
};
function isReactive(value) {
  return isObject(value) && Boolean(value[ReactiveFlags.IS_REACTIVE]);
}

// src/reactivity/ref.ts
var RefImpl = class {
  constructor(value) {
    /**
     * 依赖集合：ref 的"属性"只有 value 一个，所以不需要 targetMap 三层结构，
     * 自己持有一个 Set 就够了。对应 Vue 源码 RefImpl.dep。
     */
    this.dep = /* @__PURE__ */ new Set();
    this.__v_isRef = true;
    this._rawValue = value;
    this._value = convert(value);
  }
  get value() {
    if (activeEffect) {
      this.dep.add(activeEffect);
      activeEffect.deps.add(this.dep);
    }
    return this._value;
  }
  set value(newValue) {
    if (Object.is(this._rawValue, newValue)) return;
    this._rawValue = newValue;
    this._value = convert(newValue);
    for (const effect2 of [...this.dep]) {
      if (effect2 === activeEffect) continue;
      if (effect2.options.scheduler) {
        effect2.options.scheduler(effect2);
      } else {
        effect2.run();
      }
    }
  }
};
function convert(value) {
  return isObject(value) ? reactive(value) : value;
}
function ref(value) {
  return new RefImpl(value);
}
function isRef(value) {
  return isObject(value) && value.__v_isRef === true;
}

// src/runtime-core/vnode.ts
var Text = Symbol("Text");
var ShapeFlags = {
  ELEMENT: 1,
  STATEFUL_COMPONENT: 1 << 1,
  TEXT_CHILDREN: 1 << 2,
  ARRAY_CHILDREN: 1 << 3
};
function createVNode(type, props = null, children = null) {
  const vnode = {
    type,
    props: props ?? {},
    // key 只参与 diff 复用判断，不渲染到 DOM 上
    key: props?.key ?? null,
    shapeFlag: typeof type === "string" || type === Text ? ShapeFlags.ELEMENT : ShapeFlags.STATEFUL_COMPONENT,
    el: null,
    component: null,
    children: null
  };
  normalizeChildren(vnode, children);
  return vnode;
}
var h = createVNode;
function createTextVNode(text) {
  const vnode = {
    type: Text,
    props: {},
    key: null,
    shapeFlag: ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
    el: null,
    component: null,
    children: text
  };
  return vnode;
}
function normalizeChildren(vnode, children) {
  if (typeof children === "string" || typeof children === "number") {
    vnode.shapeFlag |= ShapeFlags.TEXT_CHILDREN;
    vnode.children = String(children);
  } else if (Array.isArray(children)) {
    vnode.shapeFlag |= ShapeFlags.ARRAY_CHILDREN;
    vnode.children = children.map(
      (child) => typeof child === "string" ? createTextVNode(child) : child
    );
  } else if (children != null) {
    vnode.children = children;
  }
}
function isSameVNodeType(n1, n2) {
  return n1.type === n2.type && n1.key === n2.key;
}

// src/runtime-core/component.ts
function createComponentInstance(vnode) {
  return {
    type: vnode.type,
    vnode,
    props: {},
    setupState: null,
    render: () => {
      throw new Error("\u7EC4\u4EF6\u7F3A\u5C11 render \u51FD\u6570");
    },
    subTree: null,
    isMounted: false,
    update: null
  };
}
function resolveProps(instance, rawProps) {
  const declared = instance.type.props ?? [];
  const resolved = {};
  for (const key of declared) {
    if (key in rawProps) {
      resolved[key] = rawProps[key];
    }
  }
  instance.props = reactive(resolved);
}
function updateProps(instance, rawProps) {
  const declared = instance.type.props ?? [];
  const next = {};
  for (const key of declared) {
    if (key in rawProps) {
      next[key] = rawProps[key];
    }
  }
  for (const key of Object.keys(instance.props)) {
    if (!(key in next)) {
      delete instance.props[key];
    }
  }
  for (const [key, value] of Object.entries(next)) {
    instance.props[key] = value;
  }
}
function setupComponent(instance) {
  const { setup, render: render2 } = instance.type;
  if (setup) {
    const setupResult = setup(instance.props);
    if (typeof setupResult === "function") {
      instance.render = setupResult;
      return;
    }
    instance.setupState = setupResult ?? {};
  }
  instance.render = render2 ?? instance.render;
}
function createRenderContext(instance) {
  return new Proxy({}, {
    get(_target, key) {
      const state = instance.setupState;
      if (state && key in state) {
        const value = state[key];
        return isRef(value) ? value.value : value;
      }
      return instance.props[key];
    },
    has(_target, key) {
      return instance.setupState && key in instance.setupState || key in instance.props;
    }
  });
}

// src/runtime-core/renderer.ts
var nodeOps = {
  createElement: (tag) => document.createElement(tag),
  createText: (text) => document.createTextNode(text),
  setElementText: (el, text) => {
    el.textContent = text;
  },
  setText: (node, text) => {
    node.nodeValue = text;
  },
  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor);
  },
  remove: (child) => {
    child.parentNode?.removeChild(child);
  }
};
function toKebab(key) {
  return key.replace(/([A-Z])/g, "-$1").toLowerCase();
}
function patchProp(el, key, prevValue, nextValue) {
  if (key === "key") return;
  if (key === "class") {
    el.className = nextValue == null ? "" : String(nextValue);
  } else if (key === "style") {
    if (nextValue && typeof nextValue === "object") {
      const css = Object.entries(nextValue).map(([k, v]) => `${toKebab(k)}: ${String(v)}`).join("; ");
      el.setAttribute("style", css);
    } else if (nextValue == null || nextValue === false) {
      el.removeAttribute("style");
    } else {
      el.setAttribute("style", String(nextValue));
    }
  } else if (key.startsWith("on") && typeof nextValue === "function") {
    const event = key.slice(2).toLowerCase();
    if (typeof prevValue === "function") {
      el.removeEventListener(event, prevValue);
    }
    el.addEventListener(event, nextValue);
  } else if (nextValue == null || nextValue === false) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, nextValue === true ? "" : String(nextValue));
  }
}
function patch(n1, n2, container, anchor = null) {
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
function processText(n1, n2, container, anchor) {
  if (n1 == null) {
    n2.el = nodeOps.createText(n2.children);
    nodeOps.insert(n2.el, container, anchor);
  } else {
    const el = n2.el = n1.el;
    if (n1.children !== n2.children) {
      nodeOps.setText(el, n2.children);
    }
  }
}
function processElement(n1, n2, container, anchor) {
  if (n1 == null) {
    mountElement(n2, container, anchor);
  } else {
    patchElement(n1, n2);
  }
}
function mountElement(vnode, container, anchor) {
  const el = vnode.el = nodeOps.createElement(vnode.type);
  const { props, children, shapeFlag } = vnode;
  if (props) {
    for (const key in props) {
      patchProp(el, key, null, props[key]);
    }
  }
  if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
    nodeOps.setElementText(el, children);
  } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    for (const child of children) {
      patch(null, child, el);
    }
  }
  nodeOps.insert(el, container, anchor);
}
function patchElement(n1, n2) {
  const el = n2.el = n1.el;
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
function patchChildren(n1, n2, container) {
  const prevShape = n1.shapeFlag;
  const nextShape = n2.shapeFlag;
  if (nextShape & ShapeFlags.TEXT_CHILDREN) {
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
      unmountChildren(n1.children);
    }
    if (n1.children !== n2.children) {
      nodeOps.setElementText(container, n2.children);
    }
  } else if (nextShape & ShapeFlags.ARRAY_CHILDREN) {
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
      diffArrayChildren(n1.children, n2.children, container);
    } else {
      if (prevShape & ShapeFlags.TEXT_CHILDREN) {
        nodeOps.setElementText(container, "");
      }
      for (const child of n2.children) {
        patch(null, child, container);
      }
    }
  } else {
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
      unmountChildren(n1.children);
    } else if (prevShape & ShapeFlags.TEXT_CHILDREN) {
      nodeOps.setElementText(container, "");
    }
  }
}
function diffArrayChildren(c1, c2, container) {
  let i = 0;
  let e1 = c1.length - 1;
  let e2 = c2.length - 1;
  while (i <= e1 && i <= e2 && isSameVNodeType(c1[i], c2[i])) {
    patch(c1[i], c2[i], container);
    i++;
  }
  while (i <= e1 && i <= e2 && isSameVNodeType(c1[e1], c2[e2])) {
    patch(c1[e1], c2[e2], container);
    e1--;
    e2--;
  }
  if (i > e1) {
    const anchor2 = e2 + 1 < c2.length ? c2[e2 + 1].el : null;
    while (i <= e2) {
      patch(null, c2[i], container, anchor2);
      i++;
    }
    return;
  }
  if (i > e2) {
    while (i <= e1) {
      unmount(c1[i]);
      i++;
    }
    return;
  }
  const oldMiddle = c1.slice(i, e1 + 1);
  const newMiddle = c2.slice(i, e2 + 1);
  const keyToOldIndex = /* @__PURE__ */ new Map();
  oldMiddle.forEach((vnode, index) => {
    if (vnode.key != null) keyToOldIndex.set(vnode.key, index);
  });
  const anchor = e2 + 1 < c2.length ? c2[e2 + 1].el : null;
  const reused = new Array(oldMiddle.length).fill(false);
  for (const vnode of newMiddle) {
    const oldIndex = vnode.key != null ? keyToOldIndex.get(vnode.key) : void 0;
    if (oldIndex !== void 0) {
      reused[oldIndex] = true;
      patch(oldMiddle[oldIndex], vnode, container, anchor);
      nodeOps.insert(vnode.el, container, anchor);
    } else {
      patch(null, vnode, container, anchor);
    }
  }
  reused.forEach((isReused, index) => {
    if (!isReused) unmount(oldMiddle[index]);
  });
}
function unmountChildren(children) {
  for (const child of children) {
    unmount(child);
  }
}
function unmount(vnode) {
  if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
    const subTree = vnode.component?.subTree;
    if (subTree) unmount(subTree);
  } else if (vnode.el) {
    nodeOps.remove(vnode.el);
  }
}
function processComponent(n1, n2, container, anchor) {
  if (n1 == null) {
    mountComponent(n2, container, anchor);
  } else {
    updateComponent(n1, n2);
  }
}
function mountComponent(vnode, container, anchor) {
  const instance = createComponentInstance(vnode);
  vnode.component = instance;
  resolveProps(instance, vnode.props);
  setupComponent(instance);
  setupRenderEffect(instance, container, anchor);
}
function updateComponent(n1, n2) {
  const instance = n1.component;
  n2.component = instance;
  instance.vnode = n2;
  n2.el = n1.el;
  updateProps(instance, n2.props);
}
function setupRenderEffect(instance, container, anchor) {
  const ctx = createRenderContext(instance);
  const renderEffect = effect(() => {
    if (!instance.isMounted) {
      const subTree = instance.render(ctx);
      instance.subTree = subTree;
      patch(null, subTree, container, anchor);
      instance.vnode.el = subTree.el;
      instance.isMounted = true;
    } else {
      const subTree = instance.render(ctx);
      patch(instance.subTree, subTree, container);
      instance.vnode.el = subTree.el;
      instance.subTree = subTree;
    }
  });
  instance.update = () => renderEffect.run();
}
var containerVNodeMap = /* @__PURE__ */ new WeakMap();
function render(vnode, container) {
  const prev = containerVNodeMap.get(container) ?? null;
  if (prev) {
    patch(prev, vnode, container);
  } else {
    patch(null, vnode, container);
  }
  containerVNodeMap.set(container, vnode);
}

// src/runtime-core/apiCreateApp.ts
function createApp(rootComponent) {
  return {
    mount(rootContainer) {
      const container = typeof rootContainer === "string" ? document.querySelector(rootContainer) : rootContainer;
      if (!container) {
        throw new Error(`mount \u5931\u8D25\uFF1A\u627E\u4E0D\u5230\u5BB9\u5668 ${String(rootContainer)}`);
      }
      const vnode = createVNode(rootComponent);
      render(vnode, container);
      return vnode.component;
    }
  };
}

// examples/main.ts
var App = {
  setup() {
    const count = ref(0);
    return {
      count,
      increment: () => {
        count.value++;
      },
      decrement: () => {
        count.value--;
      }
    };
  },
  render(ctx) {
    return h("div", { class: "counter" }, [
      h("h1", null, "mini-vue \u8BA1\u6570\u5668"),
      h("p", { class: "value" }, String(ctx.count)),
      h("div", { class: "actions" }, [
        h("button", { onClick: ctx.decrement }, "-1"),
        h("button", { onClick: ctx.increment }, "+1")
      ])
    ]);
  }
};
createApp(App).mount("#app");
