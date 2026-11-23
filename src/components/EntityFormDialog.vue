<script setup>
/**
 * 通用实体表单弹窗。
 *
 * 字段、校验规则全部来自 config/entity-schema.js —— 与写入接口共用同一份配置，
 * 因此前端校验与后端校验不会漂移（这是文档方案里最正确的一个设计点）。
 *
 * 支持：
 *   - 主数据实体：单表字段
 *   - 单据实体：头字段 + 明细行编辑（增删行、数量合计）
 *   - 字段联动：基地变化时过滤仓库选项
 *   - 编辑态：单号只读、不可编辑状态禁用保存
 */
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api'
import { ENTITY_SCHEMA, validate, canWrite } from '../config/entity-schema'
import { useAuth } from '../stores/auth'

const props = defineProps({
  kind: { type: String, required: true },
  /** 编辑时传实体 id；新建传 null */
  entityId: { type: [Number, String], default: null },
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'saved'])

const auth = useAuth()
const schema = computed(() => ENTITY_SCHEMA[props.kind] || { fields: [], items: [] })
const isEdit = computed(() => props.entityId != null)

const form = ref({})
const items = ref([])
const errors = ref({})
const saving = ref(false)
const globalErr = ref('')
const options = ref({
  bases: [], warehouses: [], locations: [], parts: [],
  suppliers: [], customers: [], users: [], inboundDocs: []
})

/** 新建时的空表单：带默认值 */
function emptyForm() {
  const f = {}
  for (const field of schema.value.fields) {
    f[field.key] = field.default ?? (field.type === 'switch' ? false : '')
  }
  // 单号（编辑态展示）
  f.no = ''
  f.status = ''
  return f
}

function emptyItem() {
  const row = {}
  for (const field of schema.value.items) {
    row[field.key] = field.default ?? ''
  }
  return row
}

/** 载入选项 + 编辑态回填 */
async function load() {
  globalErr.value = ''
  errors.value = {}
  try {
    options.value = await api.options(props.kind)
  } catch (e) {
    globalErr.value = e.message
  }

  if (isEdit.value) {
    try {
      const d = await api.detail(props.kind, props.entityId)
      const h = d.header
      const f = {}
      for (const field of schema.value.fields) {
        f[field.key] = h[field.key] ?? ''
      }
      f.no = h.no || ''
      f.status = h.status || ''
      form.value = f
      items.value = (d.items || []).map((it) => {
        const row = {}
        for (const field of schema.value.items) {
          row[field.key] = it[field.key] ?? ''
        }
        return row
      })
      if (!items.value.length && schema.value.itemTable) items.value = [emptyItem()]
    } catch (e) {
      globalErr.value = e.message
    }
  } else {
    form.value = emptyForm()
    items.value = schema.value.itemTable ? [emptyItem()] : []
  }
}

onMounted(load)
watch(() => [props.kind, props.entityId, props.open], (v) => { if (v[2]) load() })

// ── 联动：基地变化 → 过滤仓库 ─────────────────────────────────────────
const baseKey = computed(() => {
  const f = schema.value.fields.find((x) => x.key === 'base_id' || x.key === 'from_base_id')
  return f ? f.key : null
})

function warehouseOptions(field) {
  const list = options.value.warehouses || []
  // 找到该仓库字段依赖的基地字段
  const dep = field.dependsOn ? form.value[field.dependsOn] : null
  if (!dep) return list
  return list.filter((w) => String(w.base_id) === String(dep))
}

/** 某个字段的可选项 */
function choicesFor(field) {
  if (field.options) return field.options
  if (field.key === 'warehouse_id' || field.key === 'from_wh_id' || field.key === 'to_wh_id') {
    return warehouseOptions(field).map((w) => ({ value: w.id, label: w.name }))
  }
  const key = field.optionsFrom
  if (!key) return []
  const list = options.value[key] || []
  return list.map((o) => ({
    value: o.id,
    label: o.name || o.code || String(o.id)
  }))
}

function onFieldChange(field) {
  // 基地变了，清掉不匹配的仓库
  if (field.key === baseKey.value) {
    for (const f of schema.value.fields) {
      if (f.dependsOn === field.key) form.value[f.key] = ''
    }
  }
}

// ── 明细行 ────────────────────────────────────────────────────────────
function addItem() { items.value.push(emptyItem()) }
function removeItem(i) {
  items.value.splice(i, 1)
  if (!items.value.length) items.value.push(emptyItem())
}

/** 数量合计（单据头派生字段预览） */
const itemTotal = computed(() => {
  const qtyField = props.kind === 'quality' ? 'check_qty'
    : props.kind === 'stocktake' ? 'book_qty'
      : props.kind === 'outbound' ? 'plan_qty'
        : props.kind === 'delivery' ? 'plan_qty'
          : 'expect_qty'
  return items.value.reduce((s, r) => s + (Number(r[qtyField]) || 0), 0)
})

// ── 提交 ──────────────────────────────────────────────────────────────
async function submit() {
  globalErr.value = ''
  const body = { ...form.value }
  delete body.no
  delete body.status
  if (schema.value.itemTable) {
    body.items = items.value
      .filter((r) => Object.values(r).some((v) => v !== '' && v != null))
      .map((r) => ({ ...r }))
  }

  // 前端预校验，错误就地显示（不做"提交后才报错"）
  const { ok, errors: errs } = validate(props.kind, body, { partial: isEdit.value })
  errors.value = errs
  if (!ok) {
    globalErr.value = Object.values(errs)[0]
    return
  }

  saving.value = true
  try {
    if (isEdit.value) {
      await api.update(props.kind, props.entityId, body)
    } else {
      await api.create(props.kind, body)
    }
    emit('saved')
    emit('close')
  } catch (e) {
    globalErr.value = e.message
  } finally {
    saving.value = false
  }
}

const canSaveThis = computed(() => canWrite(auth.user, props.kind))
</script>

<template>
  <Transition name="scrim"><div v-if="open" class="mscrim" @click="emit('close')"></div></Transition>
  <Transition name="pop">
    <div v-if="open" class="mmask">
      <div class="panel sheetp" role="dialog" :aria-label="isEdit ? '编辑' + schema.label : '新增' + schema.label">
        <div class="sh-head">
          <h3>{{ isEdit ? `编辑${schema.label}` : `新增${schema.label}` }}</h3>
          <button class="btn btn-ghost sm" @click="emit('close')">取消</button>
        </div>

        <!-- 编辑态：单号与状态只读展示 -->
        <div v-if="isEdit" class="field-row">
          <label>单号 / 状态</label>
          <span class="ro">{{ form.no || '—' }}<template v-if="form.status"> · {{ form.status }}</template></span>
        </div>

        <!-- 头字段 -->
        <div v-for="field in schema.fields" :key="field.key" class="field-row">
          <label>
            {{ field.label }}
            <span v-if="field.required" class="req">*</span>
          </label>

          <select
            v-if="field.type === 'select'"
            v-model="form[field.key]"
            @change="onFieldChange(field)"
          >
            <option value="">请选择</option>
            <option v-for="o in choicesFor(field)" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>

          <input
            v-else-if="field.type === 'number'"
            v-model="form[field.key]"
            type="number"
            :min="field.min"
            :placeholder="field.placeholder || ''"
          />

          <button
            v-else-if="field.type === 'switch'"
            type="button"
            class="switch" :class="{ on: form[field.key] }"
            @click="form[field.key] = !form[field.key]"
          ><i></i></button>

          <input
            v-else
            v-model="form[field.key]"
            :placeholder="field.placeholder || ''"
          />
        </div>
        <div v-for="(msg, key) in errors" :key="key" class="f-err" v-show="!String(key).includes('items')">
          {{ msg }}
        </div>

        <!-- 明细行 -->
        <template v-if="schema.itemTable">
          <div class="items-head">
            <span>明细（合计 {{ itemTotal }}）</span>
            <button type="button" class="btn btn-ghost sm" @click="addItem">+ 加一行</button>
          </div>
          <div class="items-wrap">
            <div v-for="(row, i) in items" :key="i" class="item-row">
              <div class="item-fields">
                <div v-for="field in schema.items" :key="field.key" class="mini-field">
                  <label>{{ field.label }}</label>
                  <select v-if="field.type === 'select'" v-model="row[field.key]">
                    <option value="">—</option>
                    <option v-for="o in choicesFor(field)" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <input
                    v-else-if="field.type === 'number'"
                    v-model="row[field.key]"
                    type="number"
                    :min="field.min"
                  />
                  <input v-else v-model="row[field.key]" />
                </div>
              </div>
              <button type="button" class="del" :aria-label="`删除第 ${i + 1} 行`" @click="removeItem(i)">×</button>
            </div>
          </div>
          <div v-if="errors.items" class="f-err">{{ errors.items }}</div>
        </template>

        <div v-if="globalErr" class="m-err">{{ globalErr }}</div>
        <button
          class="btn btn-primary save"
          :disabled="saving || !canSaveThis"
          @click="submit"
        >{{ saving ? '保存中…' : '保存' }}</button>
        <div v-if="!canSaveThis" class="m-err">当前角色无写入权限</div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mscrim { position: fixed; inset: 0; z-index: 65; background: rgba(0,0,0,0.32); }
.mmask { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 22px; pointer-events: none; }
.sheetp {
  width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto;
  padding-bottom: 20px; box-shadow: var(--sh-overlay); pointer-events: auto;
}
.sh-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px 6px; }
.btn.sm { min-height: 36px; padding: 0 12px; font-size: 13px; }
.req { color: var(--heat); margin-left: 2px; }
.ro { font-size: 14px; color: var(--text-2); text-align: right; }
.f-err { padding: 4px 22px; font-size: 12px; color: var(--heat); }
.m-err { margin: 12px 22px 0; font-size: 13px; color: var(--heat); }
.save { margin: 18px 22px 0; width: calc(100% - 44px); }

/* 开关 */
.switch {
  width: 46px; height: 28px; border-radius: var(--r-pill); border: none; cursor: pointer;
  background: rgba(0,0,0,0.12); position: relative; transition: background 0.2s var(--ease-out-quart);
}
.switch i {
  position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
  background: #fff; box-shadow: var(--sh-card);
  transition: transform var(--dur-spring) var(--ease-spring-back);
}
.switch.on { background: var(--accent); }
.switch.on i { transform: translateX(18px); }

/* 明细 */
.items-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px 6px; font-size: 14px; font-weight: 600;
}
.items-wrap { padding: 0 22px; }
.item-row {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 10px 0; border-bottom: 1px solid var(--hairline);
}
.item-row:last-child { border-bottom: none; }
.item-fields { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; min-width: 0; }
.mini-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mini-field label { font-size: 11px; color: var(--text-3); }
.mini-field input, .mini-field select {
  border: 1px solid var(--hairline); border-radius: var(--r-chip);
  padding: 6px 8px; font: inherit; font-size: 13px; background: var(--surface);
  min-width: 0; width: 100%;
}
.del {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(0,0,0,0.05); color: var(--text-3); font-size: 18px; line-height: 1;
}
.del:active { background: var(--heat-bg); color: var(--heat); }

.pop-enter-active { transition: opacity 0.32s var(--ease-spring), transform 0.32s var(--ease-spring); }
.pop-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.94) translateY(10px); }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.22s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

@media (max-width: 640px) {
  .item-fields { grid-template-columns: repeat(2, 1fr); }
  .sheetp { max-height: 92vh; }
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active, .pop-leave-active { transition: opacity 0.2s; }
  .pop-enter-from, .pop-leave-to { transform: none; }
  .switch i { transition: none; }
}
</style>
