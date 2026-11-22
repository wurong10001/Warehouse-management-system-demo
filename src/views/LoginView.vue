<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'
import { api } from '../api'

const auth = useAuth()
const router = useRouter()
const username = ref('w01')
const password = ref('123456')
const busy = ref(false)
const err = ref('')

/** 演示账号快捷填充：覆盖每种角色的典型视角，方便面试官一键切换 */
const DEMO_ACCOUNTS = [
  { username: 'root', label: '超管', hint: '全部基地 · 可管理账号' },
  { username: 'admin', label: '管理员', hint: '全菜单 · 跟随基地切换' },
  { username: 'w01', label: '库管', hint: '华东中央仓' },
  { username: 'q01', label: '质检', hint: '华东中央仓' },
  { username: 'd01', label: '配送', hint: '华东基地' },
  { username: 'p01', label: '计划', hint: '华东基地' },
  { username: 'a01', label: '会计', hint: '只读审计视角' },
  { username: 's01', label: '审计', hint: '全菜单只读' }
]

function fill(name) {
  username.value = name
  password.value = '123456'
}

async function submit() {
  busy.value = true; err.value = ''
  try {
    await auth.login(username.value.trim(), password.value)
    router.replace('/')
  } catch (e) {
    err.value = e.message === 'invalid credentials' ? '账号或密码不正确' : e.message
  } finally { busy.value = false }
}

/** 一键还原演示数据（本地库被改乱时用） */
async function resetDemo() {
  if (!confirm('将清空所有改动，恢复初始演示数据，确定吗？')) return
  await api.resetDemoData()
  location.reload()
}
</script>

<template>
  <div class="login">
    <div class="hero">
      <div class="orb"></div>
      <div class="eyebrow"><span class="dot-live"></span> 多基地 · 多仓库备件仓储</div>
      <h1>备件仓储管理系统</h1>
      <p class="lede">入库、出库、质检、盘点、配送与设备采集，一屏作业闭环。</p>
      <p class="badge-line">纯静态演示版 · 数据在你的浏览器里</p>
    </div>

    <form class="panel form" @submit.prevent="submit">
      <div class="field-row">
        <label>账号</label>
        <input v-model="username" autocomplete="username" placeholder="w01 / a01 / root …" />
      </div>
      <div class="field-row">
        <label>密码</label>
        <input v-model="password" type="password" autocomplete="current-password" />
      </div>

      <div class="picks">
        <button
          v-for="a in DEMO_ACCOUNTS" :key="a.username"
          type="button" class="pick" :class="{ on: username === a.username }"
          :title="a.hint" @click="fill(a.username)"
        >{{ a.label }}</button>
      </div>

      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn btn-primary cta" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      <p class="hint">演示账号密码均为 123456 · 点上方标签可一键切换角色视角</p>
      <button type="button" class="reset" @click="resetDemo">重置演示数据</button>
    </form>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 36px; padding: var(--pad-x);
  position: relative; overflow: hidden;
}
.hero { text-align: center; max-width: var(--max-read); position: relative; }
.orb {
  position: absolute; left: 50%; top: -60px; transform: translateX(-50%);
  width: 340px; height: 340px; border-radius: 50%;
  background: var(--grad-blue); opacity: 0.18; filter: blur(50px); pointer-events: none;
}
.lede { color: var(--text-2); font-size: 16px; line-height: 1.85; margin-top: 12px; }
.badge-line {
  display: inline-block; margin-top: 14px; font-size: 12px; color: var(--text-3);
  padding: 6px 14px; border-radius: var(--r-pill); background: rgba(0,0,0,0.04);
}
.form { width: 100%; max-width: 440px; padding: 8px 0 22px; }
.cta { margin: 18px 22px 0; width: calc(100% - 44px); }
.err { margin: 10px 22px 0; font-size: 13px; color: var(--heat); }
.hint { margin: 12px 22px 0; font-size: 12px; color: var(--text-4); text-align: center; }

.picks {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 14px 22px 4px; border-bottom: 1px solid var(--hairline);
}
.pick {
  border: 1px solid var(--hairline); background: transparent; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--text-2);
  padding: 7px 13px; border-radius: var(--r-pill);
  -webkit-tap-highlight-color: transparent;
  /* 弹簧过渡由 app.css 统一声明 */
}
.pick.on { background: rgba(0,113,227,0.08); border-color: transparent; color: var(--accent-link); font-weight: 600; }

.reset {
  display: block; margin: 10px auto 0; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 12px; color: var(--text-4); text-decoration: underline;
  text-underline-offset: 3px;
}
.reset:hover { color: var(--text-2); }
</style>
