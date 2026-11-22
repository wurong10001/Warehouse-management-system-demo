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

> 数据改动会存进浏览器 `localStorage`。登录页底部有「重置演示数据」，
> 随时一键还原初始状态 —— 面试演示时很实用。

## 部署到 Cloudflare Pages

三种方式任选其一。

**1. 控制台 Git 集成（推荐）**

| 配置项 | 值 |
|---|---|
| Framework preset | `Vite` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `20`（或以上） |

**2. Wrangler 命令行**

```bash
npm run build
npx wrangler pages deploy dist
```

**3. 直接拖拽**

先 `npm run build`，再把 `dist/` 目录拖到 Cloudflare Pages 控制台的
上传区域即可。

因为用的是 **hash 路由**（`#/login`），任何静态托管都不需要额外配置
重写规则，GitHub Pages、Netlify、Vercel、对象存储同样适用。
`public/_headers` 与 `public/_redirects` 已为 Cloudflare Pages 准备好缓存
与兜底策略；`wrangler.toml` 供 CLI 部署使用。

## 项目结构

```
demo/
├── src/
│   ├── mock/                  ← 核心：把后端搬进浏览器
│   │   ├── seed.js            初始数据（由 sql/02_seed.sql 平移，20 备件 / 13 用户 …）
│   │   ├── db.js              localStorage 持久化 + 事务回滚 + 自增主键
│   │   ├── api.js             所有接口实现（登录、列表、详情、看板、用户管理）
│   │   └── sha256.js          纯 JS 密码哈希（不依赖安全上下文）
│   ├── api/index.js           前端适配层：函数签名与原 fetch 版完全一致
│   ├── config/menu.js         菜单 / 权限键清单
│   ├── router/index.js        路由（hash 模式）+ 登录守卫
│   ├── stores/auth.js         Pinia 登录态
│   ├── views/                 看板、列表、库存、用户管理、登录
│   ├── components/            外壳、详情抽屉、状态标签、状态流程
│   ├── composables/           移动端断点、下拉手势关闭
│   └── styles/                Apple Liquid Glass 设计 token
└── test/
    ├── api.test.mjs           38 项接口层测试（鉴权、隔离、事务、数据完整性）
    ├── e2e.test.mjs           17 项 DOM 端到端测试（真实挂载 Vue 应用）
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

**5. 顺手修掉原版的几个问题**

| 原版问题 | 静态版处理 |
|---|---|
| 看板「异常单据」查询漏了数据范围过滤，会跨基地泄漏 | 已补上范围条件，并有测试覆盖 |
| 退出登录只清前端 token，服务端会话仍有效 | `logout()` 真正作废 token |
| 种子数据里库管员有个 `transfer` 权限键，但前端没有对应路由 | 移除悬空权限，并加测试保证权限键都合法 |
| 无用户级权限与角色权限的冲突校验 | 保留 `perm_mode = role \| custom` 双模式切换 |

## 测试

```bash
npm test          # 38 项接口层测试
npm run test:e2e  # 17 项 DOM 端到端测试（jsdom 真实挂载应用）
npm run test:all  # 全部
```

E2E 测试用 Vite 把整个应用打成 bundle 后在 jsdom 里挂载，断言
「登录 → 看板 → 列表 → 详情 → 库存 → 权限切换」整条链路，并显式验证
**全程零 `fetch` 调用** —— 这是"纯静态"的活体证明，而不只是构建通过。

## 已知边界

这是**演示项目**，刻意为展示而设计，因此有以下取舍：

- **数据只存在当前浏览器**，换设备 / 清缓存即丢失。没有多用户协作。
- **只读为主**：单据状态机、库存流水是种子数据。写接口只有用户管理
  （新增/编辑/重置密码），因为原版后端也只实现了这些。
- **无鉴权防护**：token 存在 `localStorage`，密码哈希无盐。真实系统需换
  bcrypt + JWT + 登录限流。
- **无分页**：列表硬编码 `limit 100`。

如果要做成真实可用的系统，改动路径很清晰：`src/mock/api.js` 的每个
函数都是一条接口的完整语义，替换成真实 HTTP 调用即可 —— 上层完全无感。

## License

MIT
