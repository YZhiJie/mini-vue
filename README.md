# mini-vue

教学级 mini-vue：手写 Vue3 的响应式系统与运行时核心，用于证明"读过 @vue/reactivity 与 @vue/runtime-core 的源码原理，并且能手写实现"。所有代码约 1200 行（含大量解释"为什么"的中文注释），配有 33 个真实通过的测试。

> 学习目的项目，不用于生产环境。概念命名（track/trigger/activeEffect/dirty/scheduler/shapeFlag 等）与 Vue3 源码保持一致，便于对照阅读。

## 特性清单

### reactivity 模块（src/reactivity）

- `reactive`：Proxy + Reflect 拦截 get/set/deleteProperty；嵌套对象懒代理（get 时递归）；重复代理返回缓存（WeakMap）；`ReactiveFlags` / `toRaw` / `isReactive`
- `track` / `trigger`：`WeakMap<target, Map<key, Set<effect>>>` 三层依赖结构；`activeEffect` 用栈处理嵌套 effect；每次执行前 cleanup 防止分支切换的依赖残留
- `effect(fn, options)`：返回 runner；支持 `lazy`、`scheduler`、`stop`
- `ref`：getter/setter 手动 track/trigger（绕开 Proxy 无法代理原始值的限制）；对象值内部转 reactive；`isRef` / `unref` / `toRefs`
- `computed`：lazy + dirty 脏标记，依赖变化才重算，多个 effect 复用同一 computed 不重复计算
- `watch`：基于 effect + scheduler 实现，支持 `deep` / `immediate` / `onCleanup`，返回停止函数

### runtime-core 模块（src/runtime-core）

- `h` / `createVNode`：vnode 含 type/props/children/key/shapeFlag（位标志），文本与数组 children 归一化
- `patch`：元素 diff（props 增删改、class/style/事件处理）；children diff 采用双端对比简化版；有 key 时按 key 映射复用 DOM 节点并移动
- 组件：有状态组件（setup 返回状态对象或 render 函数）、props 声明与解析（响应式 props）、组件响应式更新
- `createApp(App).mount(container)`：支持选择器字符串与 DOM 元素

## 依赖收集：targetMap 三层结构

Proxy 的 get 拦截里调用 `track`，把"当前正在执行的 effect"记录到三层结构中：

```
targetMap (WeakMap)                          为什么用 WeakMap：
 └── target（原始对象）                        对象被销毁时依赖表随之回收，
      └── depsMap (Map)                       避免内存泄漏
           ├── "count" ──> dep (Set<Effect>)  为什么用 Set：去重，
           │                 ├── effect A      且删除/添加都是 O(1)
           │                 └── effect B
           └── "name"  ──> dep (Set<Effect>)
                             └── effect A

track(target, key)：               trigger(target, key)：
  activeEffect 存在时                 找到 dep，拷贝一份再遍历
  把 activeEffect 存进                （防止执行中修改集合导致
  targetMap[target][key]              死循环），逐个重新执行
```

读 `obj.count` 发生 track，写 `obj.count` 发生 trigger——"谁用了这个数据"与"数据变了通知谁"通过同一个 Set 连接起来。

## effect 栈与 cleanup

**为什么要栈？** effect 可以嵌套。如果只用一个全局 `activeEffect` 变量，内层 effect 执行完会把它置空，外层 effect 后续的属性读取就收集不到依赖了：

```
effect(() => {            // 外层
  effect(() => {          // 内层：执行完 activeEffect 变回谁？
    obj.y
  })
  obj.x                   // 这里还在外层 effect 里，必须继续收集到外层
})
```

解决方案：执行前入栈，执行完出栈并把 `activeEffect` 恢复为栈顶（外层 effect）。

**为什么要 cleanup？** 考虑分支切换：

```js
effect(() => {
  dummy = obj.flag ? obj.a : obj.b   // flag=true 时只依赖 flag 和 a
})
```

当 `flag` 变为 false 后，effect 改为依赖 flag 和 b。如果不清理，effect 仍然残留在 a 的依赖集合里，之后修改 `obj.a` 会触发一次毫无意义的重执行。所以每次 effect 重新执行前，先遍历 `effect.deps`（它反向记录了自己被收进了哪些集合）把自己全部删掉，再重新收集。测试中的 `runner.deps.size` 断言可以直接观察到这个行为。

## computed 的 dirty 机制

computed = 一个 lazy 的内部 effect + 一个脏标记：

```
创建 computed(() => obj.n * 2)     不执行 getter（lazy）
读取 c.value（第一次）              dirty=true -> 执行 getter -> 缓存结果 -> dirty=false
读取 c.value（后续）                dirty=false -> 直接返回缓存（getter 不执行）
obj.n 变化                          scheduler 触发：只把 dirty 置回 true，不重算
读取 c.value                        dirty=true -> 重算一次 -> 缓存
```

scheduler 在这里的作用是"把重算的时机推迟到下次读取"，这正是 computed 惰性的来源。多个 effect 依赖同一个 computed 时，它们被记录进 computed 的订阅者集合，依赖变化只通知订阅者重跑，getter 本身只在第一个订阅者读取时重算一次（见测试 `多个 effect 复用同一 computed，不重复计算`）。

## patch 流程

```
patch(n1, n2, container)
 ├─ n1 === n2                     直接返回
 ├─ 类型不同（type 或 key 不同）    unmount(n1)，n1 置空按新挂载处理
 ├─ type === Text                 processText：创建/更新文本节点
 ├─ type 是字符串（元素）
 │   ├─ n1 为空 -> mountElement：createElement -> 挂 props -> 挂 children -> insert
 │   └─ 否则   -> patchElement：
 │       ├─ el = n2.el = n1.el        （复用 DOM 是 diff 的本质）
 │       ├─ props：新的逐个比较更新，旧里没有的删除
 │       └─ patchChildren：
 │           ├─ 新文本        旧数组先卸载，再覆盖 textContent
 │           ├─ 数组 -> 数组   diffArrayChildren（见下）
 │           ├-> 文本/空 -> 数组  清空文本，逐个挂载
 │           └─ 新空          卸载全部
 └─ 其他（组件）
     ├─ n1 为空 -> mountComponent：创建实例 -> resolveProps -> setup -> 渲染 effect
     └─ 否则   -> updateComponent：更新响应式 props（自动触发子组件渲染 effect）
```

children 数组 diff（双端对比简化版）：

```
c1=[a,b,c]  c2=[x,y,a,b]

S1 头部同步：从头开始，类型+key 相同就 patch          a vs x 不同，停
S2 尾部同步：从尾开始，类型+key 相同就 patch          c vs b 不同，停
S3 纯新增：旧的遍历完、新的还有 -> 全部挂载
S4 纯删除：新的遍历完、旧的还有 -> 全部卸载
S5 中段乱序：旧中段建 key -> index 映射，
   新中段逐个查表：命中 -> patch 复用并移动到锚点前；
   未命中 -> 挂载新节点；最后卸载旧中段未被复用的节点
   （例：c1 中段 [a,b,c] -> c2 中段 [x,y,a,b]，a、b 复用，c 卸载，x、y 挂载）
```

**与真 Vue 的差别**：Vue 在 S5 用"最长递增子序列（LIS）"算出哪些节点不用动，只移动必须移动的节点；本实现把每个复用节点都移动到锚点前，结果正确但移动次数不是最优（最坏 O(n) 次 DOM 移动）。另外无 key 的中段节点直接卸载重建，不做索引位置复用。

## 组件更新的响应式链路

```
setup 返回 { count }（ref）
   -> render(ctx) 中 ctx.count 自动解包并读取 ref.value
      -> ref 的 getter track 住当前渲染 effect
         -> count.value++ 触发 scheduler/trigger
            -> 渲染 effect 重新执行 render + patch(subTree, newSubTree)
```

父组件传给子组件的 props 同理：`instance.props` 是 reactive 对象，render 读取时收集依赖，父组件更新传入新值时子组件自动重渲染。

## 如何跑测试

```bash
pnpm install
pnpm test        # vitest run，33 个测试
```

测试覆盖：依赖收集与触发、嵌套懒代理、重复代理缓存、cleanup 分支、effect 栈、lazy/scheduler/stop、ref、computed 惰性缓存与复用、watch（immediate/deep/onCleanup/停止）、vnode 结构、mount/patch props、事件更新、children 类型切换、key diff 复用/删除/重排、组件 setup、props 更新、createApp。

## 运行计数器示例

```bash
pnpm install
pnpm run build:example     # esbuild 打包 examples/main.ts -> examples/bundle.js
# 然后用浏览器直接打开 examples/counter.html
```

## 与真 Vue 的差距清单

响应式：

- Set/Map/WeakMap/WeakSet 未实现响应式：Vue 为集合类型单独写了 `collectionHandlers`（拦截 add/delete/has/forEach 等），本实现只覆盖普通对象与数组
- 数组的遍历类方法（push/splice 等通过 length 与索引隐式联动的场景）没有 Vue 的数组特殊处理；直接 `arr[i] = x` / `arr.length = n` 这类显式赋值可以工作
- 未实现 shallowReactive / readonly / shallowReadonly / proxyRefs / customRef / triggerRef / effectScope
- watch 不支持多 source、`flush` 时机控制（pre/post/sync）、`onTrack/onTrigger` 调试钩子

运行时：

- 没有模板编译器：只能手写 h 函数（Vue 的运行时 + 编译器 + patchFlags/静态提升优化全部缺失）
- diff 没有最长递增子序列优化（见上）；没有静态提升、block tree、patchFlags
- 更新是同步的：没有异步批量更新队列（Vue 的 queueJob + nextTick 去重调度），一次改动只改一个值时行为一致，但连续改多个值会触发多次渲染
- 组件没有生命周期钩子（onMounted 等）、没有 slots、emits 声明、provide/inject、attrs 透传、expose、v-model
- props 声明只支持字符串数组，没有类型校验、默认值、大小写转换
- 没有 Teleport / Suspense / Transition / KeepAlive / SSR / 自定义渲染器工厂（Vue 的 createRenderer 可以注入 nodeOps 跨平台，本实现的 DOM 操作直接写在渲染器里）

## 目录结构

```
mini-vue
├── src/
│   ├── reactivity/           # 响应式系统
│   │   ├── reactive.ts       #   Proxy/Reflect、ReactiveFlags、toRaw、targetMap
│   │   ├── effect.ts         #   track/trigger、activeEffect 栈、cleanup、stop
│   │   ├── ref.ts            #   RefImpl、isRef/unref/toRefs
│   │   ├── computed.ts       #   lazy + dirty 脏标记
│   │   ├── watch.ts          #   effect + scheduler、deep/immediate/onCleanup
│   │   └── index.ts
│   ├── runtime-core/         # 运行时核心
│   │   ├── vnode.ts          #   createVNode/h、shapeFlag、Text、归一化
│   │   ├── component.ts      #   实例、props 解析、setup、渲染上下文
│   │   ├── renderer.ts       #   patch/mount/diff/组件渲染 effect
│   │   ├── apiCreateApp.ts   #   createApp().mount()
│   │   └── index.ts
│   └── index.ts
├── tests/                    # 33 个测试（vitest + jsdom）
├── examples/                 # 计数器示例
└── package.json
```
