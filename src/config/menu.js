/**
 * 菜单配置。
 *
 * 单独抽成一个模块（而不是放在 router/index.js 里），因为：
 * 1. router 会 import 一堆 .vue 组件，Node 端测试无法加载；
 * 2. 菜单同时被侧边栏、移动端 Tab、用户权限编辑器复用，
 *    它本质是「前端视角的权限键清单」，与路由表是两个关注点。
 *
 * menu_key 必须与路由 name / sys_permission.menu_key 保持一致。
 */
export const MENU = [
  { group: null, items: [{ key: 'dashboard', label: '首页看板', path: '/' }] },
  {
    group: '基础数据', items: [
      { key: 'basedata', label: '基地 / 仓库', path: '/basedata' },
      { key: 'parts', label: '备件档案', path: '/parts' }
    ]
  },
  {
    group: '仓储管理', items: [
      { key: 'inbound', label: '入库管理', path: '/inbound' },
      { key: 'outbound', label: '出库管理', path: '/outbound' },
      { key: 'inventory', label: '库存查询', path: '/inventory' },
      { key: 'flow', label: '库存流水', path: '/flow' }
    ]
  },
  { group: '配送管理', items: [{ key: 'delivery', label: '配送单', path: '/delivery' }] },
  { group: '质检管理', items: [{ key: 'quality', label: '质检单', path: '/quality' }] },
  { group: '盘点管理', items: [{ key: 'stocktake', label: '盘点任务', path: '/stocktake' }] },
  { group: '设备集成', items: [{ key: 'device', label: '设备状态', path: '/device' }] },
  { group: '系统管理', items: [
    { key: 'warehouse', label: '仓库管理', path: '/warehouse' },
    { key: 'system', label: '用户与权限', path: '/system' }
  ] }
]

/** 扁平化后的全部菜单项 */
export const FLAT_MENU = MENU.flatMap((g) => g.items)
