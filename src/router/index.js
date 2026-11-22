import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuth } from '../stores/auth'
import { MENU } from '../config/menu'
import AppShell from '../components/AppShell.vue'
import ListView from '../views/ListView.vue'
import DashboardView from '../views/DashboardView.vue'
import InventoryView from '../views/InventoryView.vue'

export { MENU }

const list = (kind, title, columns) => ({
  path: kind, name: kind, component: ListView, props: { kind, title, columns }
})

const colsDoc = [
  { k: 'no', label: '单号' },
  { k: 'base_name', label: '基地' },
  { k: 'warehouse_name', label: '仓库' },
  { k: 'extra', label: '摘要' },
  { k: 'status', label: '状态', tag: true },
  { k: 'created_at', label: '创建时间', time: true }
]

const router = createRouter({
  // hash 模式：静态托管（Cloudflare Pages / GitHub Pages）无需配置 rewrite 即可直接访问
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    {
      path: '/', component: AppShell, children: [
        { path: '', name: 'dashboard', component: DashboardView },
        list('parts', '备件档案', [
          { k: 'code', label: '编码' }, { k: 'name', label: '名称' },
          { k: 'spec', label: '规格型号' }, { k: 'unit', label: '单位' },
          { k: 'safe_stock', label: '安全库存', num: true }, { k: 'supplier_name', label: '供应商' }
        ]),
        list('inbound', '入库单', colsDoc),
        list('outbound', '出库单', colsDoc),
        list('delivery', '配送单', [
          { k: 'no', label: '配送单号' },
          { k: 'route', label: '路线' },
          { k: 'qty', label: '数量', num: true },
          { k: 'courier_name', label: '配送员' },
          { k: 'status', label: '状态', tag: true },
          { k: 'shipped_at', label: '发运时间', time: true }
        ]),
        list('quality', '质检单', [
          { k: 'no', label: '质检单号' },
          { k: 'from_no', label: '来源单号' },
          { k: 'total', label: '总数', num: true },
          { k: 'pass_qty', label: '合格', num: true },
          { k: 'fail_qty', label: '不合格', num: true },
          { k: 'status', label: '状态', tag: true }
        ]),
        list('stocktake', '盘点任务', [
          { k: 'no', label: '盘点单号' },
          { k: 'scope', label: '盘点范围' },
          { k: 'warehouse_name', label: '仓库' },
          { k: 'status', label: '状态', tag: true },
          { k: 'created_at', label: '创建时间', time: true }
        ]),
        list('flow', '库存流水', [
          { k: 'ts', label: '时间', time: true },
          { k: 'part_code', label: '备件编码' },
          { k: 'part_name', label: '备件名称' },
          { k: 'qty_change', label: '变动', num: true },
          { k: 'type', label: '类型' },
          { k: 'ref_doc', label: '关联单据' },
          { k: 'after_qty', label: '结余', num: true }
        ]),
        list('basedata', '基地 / 仓库', [
          { k: 'base_name', label: '基地' }, { k: 'code', label: '仓库编码' },
          { k: 'name', label: '仓库名称' }, { k: 'address', label: '地址' }
        ]),
        list('device', '设备状态', [
          { k: 'code', label: '设备编号' }, { k: 'name', label: '名称' },
          { k: 'type', label: '类型' }, { k: 'warehouse_name', label: '绑定仓库' },
          { k: 'online', label: '在线', dot: true }, { k: 'last_heartbeat', label: '最后心跳', time: true }
        ]),
        { path: 'system', name: 'system', component: () => import('../views/UserAdminView.vue') },
        { path: 'inventory', name: 'inventory', component: InventoryView }
      ]
    },
    // 兜底：未知路径回首页，避免静态托管上出现空白页
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach(async (to) => {
  if (to.name === 'login') return true
  const auth = useAuth()
  if (!auth.loggedIn && !(await auth.restore())) return { name: 'login' }
  return true
})

export default router
