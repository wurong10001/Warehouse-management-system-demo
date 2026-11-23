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
    // 首次初始化：落盘失败不阻断（还只是种子数据，没有用户修改）
    try {
      persist()
    } catch {
      /* 只读场景下仍可继续，等真正写操作时再明确报错 */
    }
  }
  return cache
}

/**
 * 把内存中的库写回 localStorage。
 *
 * 失败时**必须抛错**，不能静默吞掉：
 * 写入功能上线后，如果 persist 失败却只 warn，用户会看到「保存成功」的提示，
 * 但刷新页面数据就没了 —— 这是最难排查的一类事故。
 * 只读时代吞异常是合理的（退化为纯内存演示），有写操作后必须显式失败。
 */
export function persist() {
  if (!cache) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch (e) {
    const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)
    if (isQuota) {
      throw new Error(
        '本地存储空间已满，本次修改未保存。请到登录页点「重置演示数据」清理后重试。'
      )
    }
    // 隐私模式等不可写场景：明确告知，而不是假装成功
    throw new Error('本地存储不可用，本次修改未保存（浏览器可能处于隐私模式）')
  }
}

/**
 * 落盘，失败时回滚内存缓存。
 * 供 withTransaction 使用：保证「内存状态」与「磁盘状态」一致，
 * 不会出现内存已改、磁盘没改的错位。
 */
function persistOrRollback(snapshot) {
  try {
    persist()
  } catch (e) {
    cache = snapshot
    throw e
  }
}

/**
 * 事务：先快照，回调抛错即整体回滚；落盘失败同样回滚。
 * 对应后端 `BEGIN ... COMMIT / ROLLBACK`，避免写一半留下脏数据。
 */
export function withTransaction(fn) {
  const db = getDb()
  const snapshot = structuredClone(db)
  let result
  try {
    result = fn(db)
  } catch (e) {
    // 业务校验失败：内存回滚，磁盘未动
    cache = snapshot
    throw e
  }
  // 业务成功 → 落盘；若落盘失败，内存与磁盘都要回到快照
  persistOrRollback(snapshot)
  return result
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
