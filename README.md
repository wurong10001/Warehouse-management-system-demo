# 备件仓储管理系统 · 纯静态演示版

> Vue 3 + Vite + Pinia，**无后端、无数据库、零网络请求**的单页应用。
> 整个 "数据库 + API 层" 运行在浏览器里，可直接部署到 Cloudflare Pages。
> 适合简历项目展示：打开即用，不需要任何服务端环境。

原版为 Vue 3 + Fastify + PostgreSQL 的前后端分离系统。本项目把 Fastify
的 535 行 API 与 PostgreSQL 的数据模型**整体平移进浏览器**，前端视图层
（20 个组件 / 5 个视图 / Apple Liquid Glass 设计系统）一行未改。

---

## 快速开始

```bash
npm install
npm run dev          # → http://127.0.0.1:5173
```

演示账号密码统一为 `123456`，登录页可点标签一键切换角色视角：

| 账号 | 角色 | 数据范围 |
|---|---|---|
| `root` | 超级管理员 | 全部基地，可管理账号 |
| `admin` | 基地/仓库管理员 | 全菜单，跟随顶栏基地切换 |
| `w01` / `w02` / `w03` | 库管员 | 华东中央仓 / 华南中央仓 / 华南现场仓 |
| `q01` / `q02` | 质检员 | 华东中央仓 / 华南中央仓 |
| `d01` / `d02` | 配送员 | 华东 / 华南 |
| `p01` | 计划/采购 | 华东 |
| `a01` | 会计 | 只读审计视角 |
| `c01` | 采购员 | 华东 |
| `s01` | 审计员 | 全菜单只读 |
| `chief` | **总管** | 全部仓库数据 · 不能管理账号 |
| `boss` | **老板** | 全部仓库 · 审批仓库增删 |

> 数据改动会存进浏览器 `localStorage`。登录页底部有「重置演示数据」，
> 随时一键还原初始状态 —— 面试演示时很实用。

## 部署到 Cloudflare Workers

仓库根目录的 `wrangler.toml` 已配置好 **Workers 静态资源模式**：
没有 Worker 脚本，只是把 `dist/` 当作静态资源上传。

```toml
name = "warehouse-management-system-demo"
compatibility_date = "2025-01-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

**方式一：Cloudflare 控制台 Git 集成（推荐）**

在 Cloudflare Dashboard → Workers & Pages → 创建 → 连接 Git 仓库，
选 `Warehouse-management-system-demo`，然后：

| 配置项 | 值 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| 根目录 | `/`（默认） |

推送到 `master` 后 Cloudflare 会自动构建并部署。

**方式二：本地 Wrangler CLI**

```bash
npm install
npm run build
npx wrangler login      # 首次
npx wrangler deploy
```

**方式三：GitHub Actions 手动触发**

`.github/workflows/deploy-cloudflare.yml` 已备好，需先在仓库
Settings → Secrets and variables → Actions 配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

然后在 Actions 页面手动运行。

> ⚠️ **常见报错备忘**：如果 `wrangler deploy` 报
> `Missing entry-point to Worker script or to assets directory`，
> 或提示 `Unexpected fields found in build field: destination_dir`，
> 说明 `wrangler.toml` 里混入了 **Pages 项目**的语法（`[build]`、
> `[[redirects]]`）。Pages 与 Workers 的配置不通用：本项目已按
> Workers 语法配好，请勿改回 Pages 写法。

---

## 部署到 GitHub Pages（零配置）

仓库包含 `.github/workflows/deploy-github-pages.yml`：推到 `master`
即自动跑测试、构建并发布，**不需要任何 secrets**。首次启用只需在
Settings → Pages → Source 选择 **GitHub Actions**。

线上地址形如
`https://<用户名>.github.io/Warehouse-management-system-demo/`
（工作流会自动把 `base` 设成仓库名，无需手动改配置）。

---

其他静态托管（Netlify / Vercel / 对象存储）同样适用：执行
`npm run build`，把 `dist/` 整个目录传上去即可。因为用的是
**hash 路由**（`#/login`），不需要任何服务端重写规则。
`public/_headers` 会在构建后进入 `dist/`，Cloudflare 的 Workers 与
Pages 都会自动识别，用于设置缓存与安全响应头。

> ⚠️ **为什么没有 `_redirects`**：SPA 兜底已由 `wrangler.toml` 的
> `not_found_handling = "single-page-application"` 原生实现。若再加一条
> `/*  /index.html  200`，Cloudflare 会把 `/index.html` 规范化成 `/`，
> 从而再次命中 `/*`，部署时被 API 拒绝并报
> `Infinite loop detected in this rule ... [code: 100324]`。
> **不要恢复这个文件。**

## 项目结构

```
.
├── src/
│   ├── mock/                  ← 核心：把后端搬进浏览器
│   │   ├── seed.js            初始数据（由原项目 SQL 种子平移，20 备件 / 13 用户 …）
│   │   ├── db.js              localStorage 持久化 + 事务回滚 + 自增主键
│   │   ├── api.js             所有接口实现（登录、列表、详情、看板、用户管理）
│   │   └── sha256.js          纯 JS 密码哈希（不依赖安全上下文）
│   ├── api/index.js           前端适配层：函数签名与原 fetch 版完全一致
│   ├── config/menu.js         菜单 / 权限键清单
│   ├── config/entity-schema.js 实体写入配置（字段/校验/权限/状态机）
│   ├── router/index.js        路由（hash 模式）+ 登录守卫
│   ├── stores/auth.js         Pinia 登录态
│   ├── views/                 看板、列表、库存、用户管理、仓库管理、登录
│   ├── components/            外壳、详情抽屉、状态标签、滑动胶囊、通用表单、消息中心
│   ├── composables/           移动端断点、下拉手势关闭
│   └── styles/                Apple Liquid Glass 设计 token
└── test/
    ├── api.test.mjs           38 项接口层测试（鉴权、隔离、事务、数据完整性）
    ├── e2e.test.mjs           18 项 DOM 端到端测试（真实挂载 Vue 应用）
    ├── spring.test.mjs        14 项弹簧动效测试
    ├── segmented.test.mjs     17 项滑动胶囊测试
    ├── touch.test.mjs         17 项移动端触摸行为测试
    ├── write.test.mjs         49 项数据写入测试
    ├── governance.test.mjs    26 项治理测试
    ├── setup-dom.mjs          jsdom 环境垫片
    └── build-e2e.mjs          把应用打包成可在 Node 加载的 bundle
```

## 技术要点

**1. 后端整体平移，视图层零改动**

原 `backend/src/server.js` 的 13 个列表接口由 `LIST_ROUTES` 配置数组
驱动。静态版保留了这个设计，只是把 SQL 换成数组操作：

```js
// 原版：SQL 拼接 + pg 查询
// 静态版：同样的投影 / 搜索 / 范围过滤，跑在内存数组上
inbound: {
  rows: (db) => db.doc_in.map(...),
  baseCol: '_base', whCol: '_wh',
  search: (r, q) => like(r._no, q) || like(r._ref, q),
  sort: (a, b) => cmp(a._created, b._created, 'desc'),
  limit: 100
}
```

`src/api/index.js` 保持 `api.list('inbound', { q })` 等完全相同的签名，
所以 `views/` 与 `stores/` 不需要任何修改。

**2. 三层数据权限隔离完整保留**

与原版语义一致：绑定仓库 → 只见该仓库；绑定基地 → 只见该基地；
无绑定（总部账号）→ 跟随顶栏基地切换（`X-Base-Id` 头 → 本地状态）。
详情接口跨范围访问返回 404，与后端 `where id=$1 and <scope>` 行为一致。

**3. 事务语义**

`withTransaction()` 先 `structuredClone` 快照，回调抛错则整体回滚，
避免写一半留下脏数据 —— 对应后端的 `BEGIN / COMMIT / ROLLBACK`。

**4. 密码哈希不依赖 Web Crypto**

`sha256()` 是手写的纯 JS 实现（含完整 64 轮压缩函数），因此在
`file://` 直接打开、或非 HTTPS 环境下也能工作 —— `crypto.subtle`
只在安全上下文可用。已用标准测试向量验证。

**5. iOS 弹簧按压动效**

药丸类元素（按钮、分段控件、基地切换、角色标签、权限 chip、移动端 Tab）
带有一致的 iOS 风格弹性反馈。关键不在"加个 transition"，而在**按下与松手
用两条相反的缓动**：

```css
/* 按下：110ms 的 ease-out，立即收缩，不能拖沓 */
.btn:active { transform: scale(0.96); transition: transform 110ms ease-out; }

/* 松手：460ms 过冲回弹，y=1.56 > 1 才会「越过原位再回来」 */
.btn { transition: transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1); }
```

如果按下和松手共用同一条弹簧曲线，按下会显得慢半拍，失去原生手感。
所有参数集中在 `src/styles/tokens.css`：

| token | 值 | 用途 |
|---|---|---|
| `--ease-spring-back` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 药丸回弹（明显过冲） |
| `--ease-spring-soft` | `cubic-bezier(0.22, 1.28, 0.36, 1)` | 小元素轻弹 |
| `--dur-press` / `--dur-spring` | `110ms` / `460ms` | 按下要快，回弹可舒展 |
| `--press-scale-sm/md` | `0.93` / `0.96` | 目标越小收缩越明显 |

细节处理：移动端（≤820px）收缩加强到 `0.9`——小目标需要更明显的反馈；
搜索框只做 `0.995` 的极轻反馈，避免输入时晃动；系统开启
`prefers-reduced-motion` 时禁用全部位移与缩放，仅保留颜色过渡。

**6. 仓库级权限隔离与双人审批**

**① 多仓库授权（A 仓员工只管 A 仓）**

原实现只能绑定**一个**仓库（`sys_user.warehouse_id`）。改为独立的授权表 `sys_user_warehouse`：

```
user_id + warehouse_id（多对多）
  ├─ 有记录 → 以其为准（可一人管多个仓）
  └─ 无记录 → 回落到 warehouse_id（兼容单仓账号）
       └─ 仍为空 → 不限仓库（总部/超管/老板）
```

`scopeOf()` 从「单值」升级为「可多值」，返回 `{ field, vals }`；
同时抽出 `inScope()` 统一单行判定，避免detail 与 list 两处逻辑漂移
（改造时正是漏改 detail 导致被授权多仓的账号打不开自己仓库的数据）。

**② 高危操作双人复核**

删除仓库不可逆，因此**不直接执行**：

```
管理员点删除 → 二次确认弹窗 → 提交审批请求（pending）
                                      ↓ 老板收到红点消息
                              老板点批准 → 最终确认弹窗 → 真正执行
                                      ↓
                              申请人收到审批结果消息
```

要点：
- **审批前不落库**：请求只是 `sys_approval` 里的一行，仓库仍在
- **批准时再校验一次**：编码唯一、有无库位/库存（可能已被别人改动）
- **只有 boss 角色能审批**：`requireRole('boss')`，管理员发起后无权自己批准
- **重复审批被拒**：`status !== 'pending'` 直接 409，防止重复执行

**③ 消息与红点**

业务事件（建单、入库完成、质检不合格、审批请求/结果）写入 `sys_message`，
`read_at IS NULL` 即未读。前端顶栏铃铛显示未读数，30s 轮询 + 路由切换刷新。

消息**按用户隔离**，且推送范围刻意收窄：业务消息只发给「本仓库的人 + 管理员」，
审批类只发给「老板 + 管理员」，避免消息轰炸。

**7. iOS 滑动胶囊（segmented control）**

iOS 的分段控件不是「每个选项各自切换背景」，而是**容器里只有一个浮起的
白色胶囊**，在选中项之间滑动过去 —— 视觉上是「滑」而不是「闪」。实现见
`src/components/SegmentedControl.vue`：

```vue
<span class="seg-thumb" :style="{ transform: `translateX(${left}px)`, width: `${w}px` }" />
```

要点：

- 用 `translateX + width` 过渡，配合 `will-change` 走合成层，不触发布局
- 首次测量时临时禁用过渡（`.no-anim`），否则胶囊会从左上角「飞」进来
- `ResizeObserver` 监听容器尺寸，字体缩放或窗口变化后重新测量
- 选中按钮自身背景设为透明，背景完全交给胶囊，避免两套高亮打架
- `role="tablist"/"tab"` + `aria-selected`，胶囊 `aria-hidden`
- `prefers-reduced-motion` 下直接跳位，不做滑动

已覆盖 5 处：看板筛选、库存状态、顶栏基地切换、弹层基地切换、
用户管理的权限模式与启用停用。顶栏用 `pills` 变体（容器透明）。

**8. 移动端触摸行为统一配置**

手机上点按钮闪蓝块、长按弹系统菜单，根因是 WebKit 默认行为。集中配置在
`app.css` 顶部：

| 属性 | 作用 | 注意 |
|---|---|---|
| `-webkit-tap-highlight-color` | 去掉点击蓝块 | **不可继承**，须在 html/body 与具体标签分别声明 |
| `-webkit-touch-callout` | 去掉 iOS 长按菜单 | — |
| `user-select` | 防长按选中导致闪烁 | **不要给 input/textarea/select**，否则无法选中文字 |
| `:focus-visible` | 键盘焦点环 | 只对 `:focus:not(:focus-visible)` 去轮廓，别全局 `outline:none` |

> 没有采用「`touchstart` 上 `preventDefault`」的做法：它会连带阻止滚动，
> 并在多数浏览器里让 `click` 不再触发 —— 按钮会直接点不动。

**9. 数据写入架构（配置驱动）**

写入能力靠一份共享配置驱动，前端表单与后端校验**读同一份定义**，避免规则漂移：

```
src/config/entity-schema.js   ← 字段定义 / 校验规则 / 权限白名单 / 状态机 / 单号前缀
        │
        ├─→ EntityFormDialog.vue   渲染表单、明细行、联动下拉
        └─→ src/mock/api.js        create/update/remove/options/transition
                                   └─ withTransaction（失败整体回滚）
```

关键设计：

- **权限「与」判定**：`canWrite = 角色白名单 ∈ writeRoles && 菜单 ∈ menus`。
  角色决定职责边界（质检员不该建入库单），菜单决定界面可见性，两者同时满足才放行。
- **数据范围三层**：绑仓库 → 只见本仓库；绑基地 → 只见本基地；总部 → 跟随顶栏基地。
  写入时校验 `base_id/warehouse_id` 是否在范围内，越权返回 403/404。
- **过账幂等**：单据加 `posted_at`，重复推进到终态返回 `{ posted: false }`，
  **库存不会被重复累加** —— 这是原架构方案遗漏的致命点。
- **服务端重算派生字段**：`total`/`qty`/`diff` 一律以明细重算，不信任前端传值。
- **事务回滚**：`withTransaction` 用 `structuredClone` 快照，任何一步失败
  （含落盘失败）都整体回滚，内存与 localStorage 保持一致。

**配送的三段式在途库存**（比单据本身更复杂的一环）：

```
发运 → 起运仓 avail_qty -N, in_transit_qty +N     (flow: transit_out)
签收 → 起运仓 in_transit_qty -M, 目的仓 avail_qty +M (flow: transit_in)
异常 → 不发不结，在途保持不动，留人工处理
```

两个必须注意的点：

1. `delivery_item` **没有 `batch` 字段**，配送按备件汇总发货 →
   扣减时要跨批次累加，不能只看单条库存行（否则库存分散时误报"不足"）。
2. 配送有**两次独立库存动作**，不能用单一 `posted_at` 做幂等 →
   改用 `transit_out_at` / `transit_in_at` 两个标记分别把关。
   若仍用单一标记，发运置位后签收永远进不来，货会卡在在途。

配套测试 `test/write.test.mjs`（49 项）覆盖：只读角色拒绝、越权写拦截、
事务回滚、单号递增、状态机合法性、过账幂等、库存不足整单回滚、
配送三段式在途库存（含部分签收与重复签收幂等）。

**10. 两版行为对齐**

关键配置（`entity-schema.js`：字段/校验/权限/状态机）两版共用一份，靠
`npm run check:sync` 做内容哈希比对，防止手工复制时漂移。

后端侧实现对应关系：

| 能力 | 静态版 | 后端版 |
|---|---|---|
| 多仓授权 | `allowedWarehouses()` | `loadUser()` 返回 `warehouses` + `scopeSql()` 拼 IN |
| 仓库审批 | `sys_approval` 内存表 | `write/governance.js`（行锁 + 二次校验） |
| 站内消息 | `pushMessage()` | `write/messages.js`（同一套收件人规则） |
| 库存过账 | `posted_at` 幂等 | 同左 |

后端测试 62 项（write 19 / scope 14 / approval 18 / messages 11），
均在真实 PostgreSQL 上运行。

**11. 顺手修掉原版的几个问题**

| 原版问题 | 静态版处理 |
|---|---|
| 看板「异常单据」查询漏了数据范围过滤，会跨基地泄漏 | 已补上范围条件，并有测试覆盖 |
| 退出登录只清前端 token，服务端会话仍有效 | `logout()` 真正作废 token |
| 种子数据里库管员有个 `transfer` 权限键，但前端没有对应路由 | 移除悬空权限，并加测试保证权限键都合法 |
| 无用户级权限与角色权限的冲突校验 | 保留 `perm_mode = role \| custom` 双模式切换 |

## 测试

```bash
npm test          # 38 项接口层测试
npm run test:e2e  # 18 项 DOM 端到端测试（jsdom 真实挂载应用）
npm run test:spring     # 14 项弹簧动效测试
npm run test:segmented  # 17 项滑动胶囊测试
npm run test:touch      # 17 项移动端触摸行为测试
npm run test:write      # 49 项数据写入测试（权限/范围/事务/过账幂等/配送在途）
npm run test:governance # 26 项治理测试（多仓隔离/审批流/消息红点）
npm run test:all  # 全部
```

E2E 测试用 Vite 把整个应用打成 bundle 后在 jsdom 里挂载，断言
「登录 → 看板 → 列表 → 详情 → 库存 → 权限切换」整条链路，并显式验证
**全程零 `fetch` 调用** —— 这是"纯静态"的活体证明，而不只是构建通过。

## 已知边界

这是**演示项目**，刻意为展示而设计，因此有以下取舍：

- **数据只存在当前浏览器**，换设备 / 清缓存即丢失。没有多用户协作。
- **已支持完整写入**（P0~P2.5）：备件/仓库/基地/供应商/客户的主数据 CRUD，
  五类单据（入库/出库/质检/盘点/配送）建单与明细行编辑，状态推进与**库存过账**。
  权限按「角色白名单 且 菜单」双重判定，数据范围三层隔离，过账带幂等保护。
- **配送采用三段式在途库存**：发运时起运仓可用→在途，签收时在途→目的仓，
  部分签收的差额继续留在在途。`delivery_item` 无 `batch` 字段，
  因此跨批次汇总扣减。
- **原版后端已同步实现**：`backend/src/write/` 提供同一套语义的 SQL 版本
  （多仓授权、审批流、消息系统均已对齐），迁移见 `sql/05`、`sql/06`。
  两版共享同一份 `entity-schema.js`，可用 `npm run check:sync` 校验一致性。
- **无鉴权防护**：token 存在 `localStorage`，密码哈希无盐。真实系统需换
  bcrypt + JWT + 登录限流。
- **无分页**：列表硬编码 `limit 100`。

如果要做成真实可用的系统，改动路径很清晰：`src/mock/api.js` 的每个
函数都是一条接口的完整语义，替换成真实 HTTP 调用即可 —— 上层完全无感。

## License

MIT
