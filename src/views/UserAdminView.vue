<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useMobile } from '../composables/useMobile'
import { MENU } from '../config/menu'
import SegmentedControl from '../components/SegmentedControl.vue'

const auth = useAuth()
const isMobile = useMobile()
const isSuper = computed(() => auth.user?.roles?.includes('super'))
const PERM_MODE_OPTS = [{ value: 'role', label: '按角色' }, { value: 'custom', label: '自定义' }]
const ACTIVE_OPTS = [{ value: 'on', label: '启用' }, { value: 'off', label: '停用' }]

const rows = ref([])
const allRoles = ref([])
const warehouses = ref([])
const err = ref('')
const modal = ref(false)
const saving = ref(false)
const modalErr = ref('')
const form = ref(null)

async function load() {
  err.value = ''
  try { rows.value = await api.list('system') } catch (e) { err.value = e.message }
}
onMounted(async () => {
  load()
  try {
    [allRoles.value, warehouses.value] = await Promise.all([api.roles(), api.list('warehouses?all=1')])
  } catch {}
})

const whOptions = computed(() =>
  form.value?.base_id ? warehouses.value.filter((w) => String(w.base_id) === String(form.value.base_id)) : warehouses.value
)

function openCreate() {
  modalErr.value = ''
  form.value = { id: null, username: '', name: '', base_id: '', warehouse_id: '', role_ids: [], perm_mode: 'role', menu_keys: [], active: true, password: '' }
  modal.value = true
}
function openEdit(r) {
  modalErr.value = ''
  form.value = {
    id: r.id, username: r.username, name: r.name,
    base_id: r.base_id ? String(r.base_id) : '',
    warehouse_id: r.warehouse_id ? String(r.warehouse_id) : '',
    role_ids: [...(r.role_ids || [])],
    perm_mode: r.perm_mode === 'custom' ? 'custom' : 'role',
    menu_keys: [...(r.menu_keys || [])],
    active: r.active, password: ''
  }
  modal.value = true
}
function toggleRole(id) {
  const l = form.value.role_ids
  form.value.role_ids = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]
}
function toggleMenu(k) {
  const l = form.value.menu_keys
  form.value.menu_keys = l.includes(k) ? l.filter((x) => x !== k) : [...l, k]
}
function onBaseChange() {
  const wh = warehouses.value.find((w) => String(w.id) === String(form.value.warehouse_id))
  if (wh && form.value.base_id && String(wh.base_id) !== String(form.value.base_id)) form.value.warehouse_id = ''
}

async function submit() {
  const f = form.value
  modalErr.value = ''
  if (!f.name.trim()) { modalErr.value = '姓名必填'; return }
  if (!f.id && (!f.username.trim() || !f.password)) { modalErr.value = '账号与初始密码必填'; return }
  if (f.perm_mode === 'custom' && !f.menu_keys.length) { modalErr.value = '自定义模式至少勾选一个菜单'; return }
  if (f.perm_mode !== 'custom' && !f.role_ids.length) { modalErr.value = '至少选择一个角色'; return }
  saving.value = true
  try {
    const body = {
      name: f.name.trim(), base_id: Number(f.base_id) || 0, warehouse_id: Number(f.warehouse_id) || 0,
      role_ids: f.role_ids, active: f.active, perm_mode: f.perm_mode, menu_keys: f.menu_keys
    }
    if (f.id) {
      await api.updateUser(f.id, body)
      if (f.password) await api.resetPassword(f.id, f.password)
    } else {
      await api.createUser({ ...body, username: f.username.trim(), password: f.password })
    }
    modal.value = false
    load()
  } catch (e) { modalErr.value = e.message } finally { saving.value = false }
}
</script>

<template>
  <div class="wrap-grid">
    <div class="hero">
      <h1>用户与权限</h1>
      <button v-if="isSuper" class="btn btn-primary" @click="openCreate">添加用户</button>
    </div>

    <div class="panel section-gap">
      <div v-if="!isMobile" class="list-head usr">
        <span>账号</span><span>姓名</span><span>角色</span><span>归属</span><span>状态</span><span></span>
      </div>
      <div v-if="err" class="state">{{ err }}</div>
      <div v-else-if="!rows.length" class="state">暂无数据</div>
      <template v-else>
        <div v-for="r in rows" :key="r.id" class="usr-row">
          <template v-if="!isMobile">
            <span class="uname">{{ r.username }}</span>
            <span>{{ r.name }}</span>
            <span class="dim">{{ r.roles }}</span>
            <span class="dim">{{ r.base_name }}<template v-if="r.warehouse_name !== '—'"> · {{ r.warehouse_name }}</template></span>
            <span v-if="r.active" class="tag">启用</span>
            <span v-else class="tag attention">停用</span>
            <span class="act">
              <button v-if="isSuper" class="btn btn-ghost sm" @click="openEdit(r)">编辑</button>
            </span>
          </template>
          <template v-else>
            <div class="m-line1">
              <span class="m-main">{{ r.name }} · {{ r.username }}</span>
              <span v-if="r.active" class="tag">启用</span>
              <span v-else class="tag attention">停用</span>
              <button v-if="isSuper" class="btn btn-ghost sm" @click="openEdit(r)">编辑</button>
            </div>
            <div class="m-line2">
              <span class="m-sec" data-label="角色">{{ r.roles }}</span>
              <span class="m-sec" data-label="归属">{{ r.base_name }}{{ r.warehouse_name !== '—' ? ' · ' + r.warehouse_name : '' }}</span>
            </div>
          </template>
        </div>
      </template>
    </div>

    <!-- 编辑弹层 -->
    <Transition name="scrim"><div v-if="modal" class="mscrim" @click="modal = false"></div></Transition>
    <Transition name="pop">
      <div v-if="modal" class="mmask">
        <div class="panel sheetp" role="dialog" :aria-label="form?.id ? '编辑用户' : '添加用户'">
          <div class="sh-head">
            <h3>{{ form?.id ? `编辑用户 · ${form.username}` : '添加用户' }}</h3>
            <button class="btn btn-ghost sm" @click="modal = false">取消</button>
          </div>
          <div class="field-row">
            <label>姓名</label>
            <input v-model="form.name" placeholder="必填" />
          </div>
          <div v-if="!form.id" class="field-row">
            <label>账号</label>
            <input v-model="form.username" placeholder="登录账号，必填" />
          </div>
          <div class="field-row">
            <label>所属基地</label>
            <select v-model="form.base_id" @change="onBaseChange">
              <option value="">全部基地</option>
              <option v-for="b in auth.bases" :key="b.id" :value="String(b.id)">{{ b.name }}</option>
            </select>
          </div>
          <div class="field-row">
            <label>所属仓库</label>
            <select v-model="form.warehouse_id">
              <option value="">不限仓库</option>
              <option v-for="w in whOptions" :key="w.id" :value="String(w.id)">{{ w.name }}</option>
            </select>
          </div>
          <div class="field-row">
            <label>权限模式</label>
            <SegmentedControl
              :model-value="form.perm_mode === 'custom' ? 'custom' : 'role'"
              :options="PERM_MODE_OPTS"
              @update:model-value="form.perm_mode = $event"
            />
          </div>
          <div v-if="form.perm_mode !== 'custom'" class="field-row role-row">
            <label>角色</label>
            <div class="role-chips">
              <button
                v-for="r in allRoles" :key="r.id"
                class="chip" :class="{ on: form.role_ids.includes(r.id) }"
                @click="toggleRole(r.id)"
              >{{ r.name }}</button>
            </div>
          </div>
          <div v-else class="menu-perm">
            <div class="mp-title">菜单权限<span class="mp-hint">勾选该账号可见的菜单，与角色无关</span></div>
            <template v-for="g in MENU" :key="g.group ?? '_t'">
              <div v-if="g.group" class="mp-group">{{ g.group }}</div>
              <div class="mp-chips">
                <button
                  v-for="it in g.items" :key="it.key"
                  class="chip" :class="{ on: form.menu_keys.includes(it.key) }"
                  @click="toggleMenu(it.key)"
                >{{ it.label }}</button>
              </div>
            </template>
          </div>
          <div v-if="form.id" class="field-row">
            <label>状态</label>
            <SegmentedControl
              :model-value="form.active ? 'on' : 'off'"
              :options="ACTIVE_OPTS"
              @update:model-value="form.active = $event === 'on'"
            />
          </div>
          <div class="field-row">
            <label>{{ form.id ? '重置密码' : '初始密码' }}</label>
            <input v-model="form.password" type="password" :placeholder="form.id ? '留空则不修改' : '必填'" />
          </div>
          <div v-if="modalErr" class="m-err">{{ modalErr }}</div>
          <button class="btn btn-primary save" :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hero { padding-top: 12px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.usr { grid-template-columns: 1fr 1fr 1.4fr 1.4fr 0.8fr 0.7fr; }
.usr-row {
  display: grid; grid-template-columns: 1fr 1fr 1.4fr 1.4fr 0.8fr 0.7fr;
  gap: 14px; align-items: center; min-height: 56px; padding: 6px 22px;
  border-bottom: 1px solid var(--hairline); font-size: 14px;
}
.usr-row:last-child { border-bottom: none; }
.usr-row:hover { background: var(--hover); }
.uname { font-weight: 550; }
.dim { color: var(--text-2); font-size: 13px; }
.act { display: flex; justify-content: flex-end; }
.btn.sm { min-height: 36px; padding: 0 12px; font-size: 13px; }
.state { padding: 40px 22px; text-align: center; color: var(--text-3); font-size: 14px; }

.mscrim { position: fixed; inset: 0; z-index: 65; background: rgba(0,0,0,0.32); }
.mmask { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 22px; pointer-events: none; }
.sheetp { width: 100%; max-width: 460px; max-height: 86vh; overflow-y: auto; padding-bottom: 20px; box-shadow: var(--sh-overlay); pointer-events: auto; }
.sh-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px 6px; }
.role-row { flex-wrap: wrap; }
.role-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.chip {
  border: 1px solid var(--hairline); background: transparent; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--text-2);
  padding: 7px 13px; border-radius: var(--r-pill); min-height: 36px;
  /* 弹簧过渡由 app.css 统一声明 */
}
.chip.on { background: rgba(0,113,227,0.08); border-color: transparent; color: var(--accent-link); font-weight: 600; }
.m-err { margin: 12px 22px 0; font-size: 13px; color: var(--heat); }
.menu-perm { padding: 4px 22px 8px; border-bottom: 1px solid var(--hairline); }
.mp-title { font-size: 14px; font-weight: 600; padding: 10px 0 2px; }
.mp-hint { font-size: 12px; font-weight: 400; color: var(--text-3); margin-left: 8px; }
.mp-group { font-size: 11px; color: var(--text-4); padding: 10px 0 4px; }
.mp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.save { margin: 18px 22px 0; width: calc(100% - 44px); }

.pop-enter-active { transition: opacity 0.32s var(--ease-spring), transform 0.32s var(--ease-spring); }
.pop-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.94) translateY(10px); }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.22s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active, .pop-leave-active { transition: opacity 0.2s; }
  .pop-enter-from, .pop-leave-to { transform: none; }
}
@media (prefers-reduced-transparency: reduce) { .mscrim { background: rgba(0,0,0,0.5); } }

@media (max-width: 820px) {
  .usr { display: none; }
  .usr-row { display: block; padding: 12px 18px; min-height: 60px; }
}
</style>
