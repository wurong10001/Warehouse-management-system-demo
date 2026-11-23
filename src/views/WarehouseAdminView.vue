<script setup>
/**
 * 仓库管理页。
 *
 * 设计要点（对应需求）：
 *   1. 仓库账号只能看到「自己被授权」的仓库；老板/超管看全部
 *   2. 管理员可新增/删除仓库，但删除是**高危不可逆**操作：
 *      不直接执行，而是生成审批请求 → 老板确认后才真正删除
 *   3. 审批状态在列表里可见（待审批 / 可删除 / 有库存不可删）
 */
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useMobile } from '../composables/useMobile'

const auth = useAuth()
const isMobile = useMobile()

const rows = ref([])
const loading = ref(false)
const err = ref('')
const msg = ref('')

const isBoss = computed(() => auth.user?.roles?.includes('boss'))
const isAdmin = computed(() => (auth.user?.roles || []).some((r) => ['admin', 'super'].includes(r)))
/** 能发起仓库结构变更的角色 */
const canManage = computed(() => isAdmin.value || isBoss.value)

// ── 审批列表（老板/管理员可见） ──
const approvals = ref([])
const showApprovals = computed(() => isBoss.value || isAdmin.value)

async function load() {
  loading.value = true; err.value = ''
  try {
    rows.value = await api.warehouses()
    if (showApprovals.value) approvals.value = await api.approvals()
  } catch (e) { err.value = e.message } finally { loading.value = false }
}
onMounted(load)

function flash(text, isErr = false) {
  msg.value = text
  if (isErr) err.value = text
  setTimeout(() => { msg.value = ''; if (isErr) err.value = '' }, 4000)
}

// ══════════════════════════════════════════════════════════════════════
//  新增仓库：填表 → 提交审批
// ══════════════════════════════════════════════════════════════════════
const createOpen = ref(false)
const createForm = ref({ base_id: '', code: '', name: '', address: '' })
const createErr = ref('')
const bases = ref([])
const users = ref([])

async function openCreate() {
  createErr.value = ''
  createForm.value = { base_id: '', code: '', name: '', address: '', manager_id: '' }
  createOpen.value = true
  try {
    const o = await api.options('warehouse')
    bases.value = o.bases
    users.value = o.users
  } catch { /* 忽略 */ }
}

async function submitCreate() {
  createErr.value = ''
  const f = createForm.value
  if (!f.base_id) { createErr.value = '请选择所属基地'; return }
  if (!f.code.trim()) { createErr.value = '仓库编码必填'; return }
  if (!f.name.trim()) { createErr.value = '仓库名称必填'; return }
  try {
    const r = await api.requestCreateWarehouse({
      base_id: Number(f.base_id),
      code: f.code.trim(),
      name: f.name.trim(),
      address: f.address.trim() || null,
      manager_id: f.manager_id || null
    })
    createOpen.value = false
    flash(`已提交老板审批（申请 #${r.requestId}），批准后仓库才会创建`)
    load()
  } catch (e) { createErr.value = e.message }
}

// ══════════════════════════════════════════════════════════════════════
//  删除仓库：二次确认 → 提交审批 →（老板侧）最终确认
// ══════════════════════════════════════════════════════════════════════

/** 管理员侧：确认发起删除申请 */
const delTarget = ref(null)
const delBusy = ref(false)

function askDelete(w) {
  delTarget.value = w
}

async function confirmRequestDelete() {
  const w = delTarget.value
  if (!w) return
  delBusy.value = true
  try {
    const r = await api.requestDeleteWarehouse(w.id)
    delTarget.value = null
    flash(`已向老板提交删除申请（申请 #${r.requestId}），等待审批`)
    load()
  } catch (e) {
    flash(e.message, true)
    delTarget.value = null
  } finally { delBusy.value = false }
}

/** 老板侧：最终确认弹窗 */
const decideTarget = ref(null) // { approval, decision }
const decideComment = ref('')
const decideBusy = ref(false)

function askDecide(ap, decision) {
  decideTarget.value = { approval: ap, decision }
  decideComment.value = ''
}

async function confirmDecide() {
  const t = decideTarget.value
  if (!t) return
  decideBusy.value = true
  try {
    await api.decideApproval(t.approval.id, t.decision, decideComment.value.trim())
    decideTarget.value = null
    flash(t.decision === 'approve' ? '已批准并执行' : '已驳回申请')
    load()
  } catch (e) {
    flash(e.message, true)
    decideTarget.value = null
  } finally { decideBusy.value = false }
}

const ACTION_LABEL = { warehouse_delete: '删除仓库', warehouse_create: '新增仓库' }
const statusLabel = (s) => ({ pending: '待审批', approved: '已通过', rejected: '已驳回' }[s] || s)
</script>

<template>
  <div class="wrap-grid">
    <div class="hero">
      <div>
        <h1>仓库管理</h1>
        <p class="sub">
          <template v-if="isBoss">全部仓库 · 可审批仓库结构变更</template>
          <template v-else-if="isAdmin">可发起新增 / 删除申请，删除需老板最终确认</template>
          <template v-else>仅显示您被授权的仓库</template>
        </p>
      </div>
      <button v-if="canManage" class="btn btn-primary add-btn" @click="openCreate">+ 新增仓库</button>
    </div>

    <div v-if="msg" class="flash">{{ msg }}</div>
    <div v-if="err" class="flash err">{{ err }}</div>

    <!-- 仓库列表 -->
    <div class="panel section-gap">
      <template v-if="!isMobile">
        <div class="list-head wh">
          <span>仓库</span><span>基地</span><span>库位</span><span>备件</span><span>可用量</span><span>状态</span><span>操作</span>
        </div>
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="!rows.length" class="state">暂无仓库</div>
        <div v-for="w in rows" :key="w.id" class="list-row wh">
          <div class="p-cell">
            <div class="p-name">{{ w.name }}</div>
            <div class="p-code">{{ w.code }}<template v-if="w.address !== '—'"> · {{ w.address }}</template></div>
          </div>
          <span>{{ w.base_name }}</span>
          <span class="num">{{ w.bin_count }}</span>
          <span class="num">{{ w.part_count }}</span>
          <span class="num">{{ w.avail_qty }}</span>
          <span>
            <span v-if="w.pending_approval" class="tag attention">待审批</span>
            <span v-else-if="w.deletable" class="tag">可删除</span>
            <span v-else class="tag">有库存</span>
          </span>
          <span class="ops">
            <button
              v-if="canManage && !w.pending_approval && w.deletable"
              class="op danger" @click="askDelete(w)"
            >删除</button>
            <span v-else-if="w.pending_approval" class="op-hint">等老板确认</span>
            <span v-else class="op-hint">—</span>
          </span>
        </div>
      </template>

      <template v-else>
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="!rows.length" class="state">暂无仓库</div>
        <div v-for="w in rows" :key="w.id" class="m-row">
          <div class="m-line1">
            <span class="m-main">{{ w.name }}</span>
            <span v-if="w.pending_approval" class="tag attention">待审批</span>
            <span v-else-if="w.deletable" class="tag">可删除</span>
            <span v-else class="tag">有库存</span>
          </div>
          <div class="m-line2">
            <span class="m-sec" data-label="编码">{{ w.code }}</span>
            <span class="m-sec" data-label="基地">{{ w.base_name }}</span>
            <span class="m-sec" data-label="库位">{{ w.bin_count }}</span>
            <span class="m-sec" data-label="备件">{{ w.part_count }}</span>
            <span class="m-sec" data-label="可用">{{ w.avail_qty }}</span>
          </div>
          <div v-if="canManage && !w.pending_approval && w.deletable" class="m-ops">
            <button class="op danger" @click="askDelete(w)">删除</button>
          </div>
        </div>
      </template>
    </div>

    <!-- 审批列表（老板看到待办；管理员看到自己发起的） -->
    <div v-if="showApprovals && approvals.length" class="panel section-gap">
      <div class="panel-head">
        <h3>仓库变更申请</h3>
        <span class="more">{{ isBoss ? '需您最终确认' : '我发起的申请' }}</span>
      </div>
      <div v-for="a in approvals" :key="a.id" class="panel-row ap-row">
        <div class="grow">
          <div class="row-t">{{ a.action_label }} · {{ a.payload?.name || ('#' + a.target_id) }}</div>
          <div class="row-s">
            申请人 {{ a.requester_name }} · {{ new Date(a.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}
            <template v-if="a.decider_name"> · {{ a.decider_name }} {{ statusLabel(a.status) }}</template>
          </div>
        </div>
        <template v-if="a.status === 'pending' && isBoss">
          <button class="op" @click="askDecide(a, 'reject')">驳回</button>
          <button class="op danger" @click="askDecide(a, 'approve')">批准</button>
        </template>
        <span v-else class="tag" :class="{ attention: a.status === 'pending', done: a.status === 'approved', abnormal: a.status === 'rejected' }">
          {{ statusLabel(a.status) }}
        </span>
      </div>
    </div>

    <!-- ① 管理员侧：发起删除的二次确认 -->
    <Transition name="scrim"><div v-if="delTarget" class="mscrim" @click="delTarget = null"></div></Transition>
    <Transition name="pop">
      <div v-if="delTarget" class="mmask">
        <div class="panel dialog" role="dialog" aria-label="确认删除仓库">
          <h3>确认提交删除申请？</h3>
          <p class="dlg-text">
            将申请删除仓库「<b>{{ delTarget.name }}</b>」（{{ delTarget.code }}）。<br />
            该操作不可撤销，提交后需<b>老板账号最终确认</b>才会真正删除。
          </p>
          <div class="dlg-actions">
            <button class="btn btn-quiet" @click="delTarget = null">取消</button>
            <button class="btn btn-primary" :disabled="delBusy" @click="confirmRequestDelete">
              {{ delBusy ? '提交中…' : '提交给老板审批' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ② 老板侧：最终确认 -->
    <Transition name="scrim"><div v-if="decideTarget" class="mscrim" @click="decideTarget = null"></div></Transition>
    <Transition name="pop">
      <div v-if="decideTarget" class="mmask">
        <div class="panel dialog" role="dialog" aria-label="最终审批">
          <h3>{{ decideTarget.decision === 'approve' ? '确认批准并执行？' : '确认驳回申请？' }}</h3>
          <p class="dlg-text">
            {{ decideTarget.approval.action_label }} ·「{{ decideTarget.approval.payload?.name || ('#' + decideTarget.approval.target_id) }}」<br />
            申请人：{{ decideTarget.approval.requester_name }}
            <template v-if="decideTarget.decision === 'approve'">
              <br /><b class="warn">批准后将立即执行，不可撤销。</b>
            </template>
          </p>
          <input v-model="decideComment" class="dlg-input" placeholder="审批意见（可选）" />
          <div class="dlg-actions">
            <button class="btn btn-quiet" @click="decideTarget = null">取消</button>
            <button class="btn btn-primary" :disabled="decideBusy" @click="confirmDecide">
              {{ decideBusy ? '处理中…' : (decideTarget.decision === 'approve' ? '确认批准' : '确认驳回') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 新增仓库弹窗 -->
    <Transition name="scrim"><div v-if="createOpen" class="mscrim" @click="createOpen = false"></div></Transition>
    <Transition name="pop">
      <div v-if="createOpen" class="mmask">
        <div class="panel dialog form" role="dialog" aria-label="新增仓库">
          <h3>新增仓库</h3>
          <p class="dlg-text">新增仓库同样需要老板审批，提交后不会立即创建。</p>
          <div class="field-row">
            <label>所属基地</label>
            <select v-model="createForm.base_id">
              <option value="">请选择</option>
              <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <div class="field-row">
            <label>仓库编码</label>
            <input v-model="createForm.code" placeholder="如 WH-EAST-03" />
          </div>
          <div class="field-row">
            <label>仓库名称</label>
            <input v-model="createForm.name" placeholder="必填" />
          </div>
          <div class="field-row">
            <label>地址</label>
            <input v-model="createForm.address" placeholder="可选" />
          </div>
          <div class="field-row">
            <label>负责人</label>
            <select v-model="createForm.manager_id">
              <option value="">暂不指定</option>
              <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
            </select>
          </div>
          <div v-if="createErr" class="dlg-err">{{ createErr }}</div>
          <div class="dlg-actions">
            <button class="btn btn-quiet" @click="createOpen = false">取消</button>
            <button class="btn btn-primary" @click="submitCreate">提交审批</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hero { padding-top: 12px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.sub { font-size: 13px; color: var(--text-3); margin-top: 6px; }
.add-btn { min-height: 40px; }

.flash {
  margin-top: 16px; padding: 12px 18px; border-radius: var(--r-card);
  background: rgba(0,113,227,0.08); color: var(--accent-link); font-size: 14px;
}
.flash.err { background: var(--heat-bg); color: var(--heat); }

.list-head.wh, .list-row.wh { grid-template-columns: 2fr 0.9fr 0.6fr 0.6fr 0.7fr 0.9fr 1fr; }
.p-name { font-size: 14px; }
.p-code { font-size: 12px; color: var(--text-3); }
.ops { display: flex; justify-content: flex-end; gap: 6px; }
.op-hint { font-size: 12px; color: var(--text-4); }
.state { padding: 40px 22px; text-align: center; color: var(--text-3); font-size: 14px; }

.op {
  border: none; background: rgba(0,0,0,0.05); cursor: pointer;
  font: inherit; font-size: 13px; color: var(--text-2);
  padding: 6px 12px; border-radius: var(--r-pill); min-height: 30px;
}
.op:active { transform: scale(0.94); }
.op.danger { color: var(--heat); background: var(--heat-bg); }
.m-ops { display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hairline); }

.ap-row { gap: 10px; }
.grow { flex: 1; min-width: 0; }
.row-t { font-size: 14px; }
.row-s { font-size: 12px; color: var(--text-3); }

/* 弹窗 */
.mscrim { position: fixed; inset: 0; z-index: 65; background: rgba(0,0,0,0.32); }
.mmask { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 22px; pointer-events: none; }
.dialog {
  width: 100%; max-width: 440px; padding: 24px; pointer-events: auto;
  box-shadow: var(--sh-overlay);
}
.dialog.form { max-width: 520px; max-height: 86vh; overflow-y: auto; padding: 20px 0 20px; }
.dialog.form h3 { padding: 0 24px; }
.dlg-text { font-size: 14px; color: var(--text-2); line-height: 1.7; margin: 10px 0 18px; }
.dialog.form .dlg-text { padding: 0 24px; }
.dlg-text b { color: var(--text); }
.dlg-text .warn { color: var(--heat); }
.dlg-input {
  width: 100%; border: 1px solid var(--hairline); border-radius: var(--r-chip);
  padding: 10px 12px; font: inherit; font-size: 14px; margin-bottom: 18px;
}
.dlg-err { padding: 0 24px; font-size: 13px; color: var(--heat); margin-top: 8px; }
.dlg-actions { display: flex; gap: 10px; justify-content: flex-end; }
.dialog.form .dlg-actions { padding: 0 24px; }

.pop-enter-active { transition: opacity 0.28s var(--ease-spring), transform 0.28s var(--ease-spring); }
.pop-leave-active { transition: opacity 0.18s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.94) translateY(10px); }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.2s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

@media (max-width: 820px) {
  .list-head.wh { display: none; }
  .list-row.wh { display: block; padding: 12px 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active, .pop-leave-active { transition: opacity 0.2s; }
  .pop-enter-from, .pop-leave-to { transform: none; }
}
</style>
