/**
 * 「浏览器即数据库」的持久化层。
 *
 * 整库是一个普通的 JS 对象（各表 = 对象数组），存在 localStorage 里。
 * 对外只暴露四个原语：读库、落盘、事务、重置 —— 语义对齐后端的
 * pg pool（q / pool.connect + BEGIN/COMMIT/ROLLBACK），
 * 这样上层 API 代码可以和 Fastify 版几乎逐行对应。
 */
import { createSeedDatabase, SCHEMA_VERSION } from './seed.js'

const STORAGE_KEY = 'wms_demo_db_v1'

/** @type {ReturnType<typeof createSeedDatabase> | null} */
let cache = null

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // 结构升级时直接丢弃旧数据，避免半新半旧导致页面报错
    if (!parsed || !parsed.meta || parsed.meta.version !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/** 取得当前库（首次访问时用种子数据初始化并落盘） */
export function getDb() {
  if (!cache) {
    cache = readStorage() || createSeedDatabase()
    persist()
  }
  return cache
}

/** 把内存中的库写回 localStorage */
export function persist() {
  if (!cache) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch (e) {
    // 隐私模式下 localStorage 可能不可写：退化为纯内存运行，不阻塞演示
    console.warn('[wms-demo] 本地存储写入失败，本次会话仅保存在内存中', e)
  }
}

/**
 * 事务：先快照，回调抛错即整体回滚。
 * 对应后端 `BEGIN ... COMMIT / ROLLBACK`，避免写一半留下脏数据。
 */
export function withTransaction(fn) {
  const db = getDb()
  const snapshot = structuredClone(db)
  try {
    const result = fn(db)
    persist()
    return result
  } catch (e) {
    cache = snapshot
    throw e
  }
}

/** 重置为初始演示数据 */
export function resetDb() {
  cache = createSeedDatabase()
  persist()
  return cache
}

/** 自增主键（模拟 serial：取当前表最大值 + 1） */
export function nextId(db, table) {
  const rows = db[table] || []
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export { STORAGE_KEY, SCHEMA_VERSION }
