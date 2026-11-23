/**
 * 两版一致性校验。
 *
 * 静态版与后端版共享同一份 entity-schema.js（字段/校验/权限/状态机）。
 * 目前靠人工复制同步，容易漂移 —— 一旦不一致，两版行为就会分叉：
 * 前端能提交的字段后端拒收、权限判定不同、状态机允许的迁移不一样。
 *
 * 本脚本用内容哈希做比对，可放进 CI 或提交前钩子。
 *
 * 运行：npm run check:sync
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(here, '..')
const repoRoot = path.resolve(demoRoot, '..')

const PAIRS = [
  {
    name: 'entity-schema.js',
    a: path.join(demoRoot, 'src', 'config', 'entity-schema.js'),
    b: path.join(repoRoot, 'backend', 'src', 'config', 'entity-schema.js')
  }
]

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)

let failed = 0

for (const pair of PAIRS) {
  const hasA = existsSync(pair.a)
  const hasB = existsSync(pair.b)

  if (!hasA || !hasB) {
    console.log(`⚠ ${pair.name}: 跳过（文件缺失：${!hasA ? '静态版' : ''}${!hasB ? ' 后端版' : ''}）`)
    continue
  }

  const ha = sha(pair.a)
  const hb = sha(pair.b)

  if (ha === hb) {
    console.log(`✓ ${pair.name} 一致 (${ha})`)
  } else {
    failed++
    console.error(`✗ ${pair.name} 不一致`)
    console.error(`    静态版: ${ha}  ${path.relative(repoRoot, pair.a)}`)
    console.error(`    后端版: ${hb}  ${path.relative(repoRoot, pair.b)}`)
    console.error('    修复：cp demo/src/config/entity-schema.js backend/src/config/entity-schema.js')
  }
}

if (failed) {
  console.error(`\n${failed} 处不一致，请先同步再提交。`)
  process.exit(1)
}
console.log('\n两版配置一致。')
