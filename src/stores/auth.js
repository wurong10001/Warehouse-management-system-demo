import { defineStore } from 'pinia'
import { api } from '../api'

/**
 * 登录态。
 * 与 SQL 版相比多了一处：logout() 现在会真正让服务端（此处的浏览器内
 * mock）作废 token —— 原版后端没有登出接口，仅清掉前端 localStorage，
 * 旧 token 在内存 Map 里仍然有效。
 */
export const useAuth = defineStore('auth', {
  state: () => ({
    user: null,
    bases: [],
    baseId: Number(localStorage.getItem('wms_base')) || null
  }),
  getters: {
    menus: (s) => new Set(s.user?.menus || []),
    loggedIn: (s) => !!s.user,
    isSuper: (s) => !!s.user?.roles?.includes('super')
  },
  actions: {
    can(key) { return this.menus.has(key) },
    async login(username, password) {
      const r = await api.login(username, password)
      localStorage.setItem('wms_token', r.token)
      this.user = r.user
      this.bases = r.bases
      // 换账号时若原基地不在新用户可见范围内，回落到第一个可见基地
      if (!this.bases.some((b) => b.id === this.baseId)) {
        if (r.bases.length) this.setBase(r.bases[0].id)
        else this.baseId = null
      }
      return r.user
    },
    async restore() {
      if (!localStorage.getItem('wms_token')) return false
      try {
        const r = await api.me()
        this.user = r.user
        this.bases = r.bases
        return true
      } catch { return false }
    },
    setBase(id) {
      this.baseId = id
      localStorage.setItem('wms_base', String(id))
    },
    async logout() {
      try { await api.logout() } catch { /* 忽略 */ }
      localStorage.removeItem('wms_token')
      this.user = null
      this.bases = []
    }
  }
})
