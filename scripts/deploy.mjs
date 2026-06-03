/**
 * 自动部署脚本 - 默言无声
 * 
 * 用法:
 *   一键部署:           node scripts/deploy.mjs
 *   仅构建:             node scripts/deploy.mjs --build-only
 *   仅更新 worker.js:   node scripts/deploy.mjs --gen-worker
 *   部署到 Pages:       node scripts/deploy.mjs --pages
 *   部署到 Workers:     node scripts/deploy.mjs --worker
 *   跳过确认:           node scripts/deploy.mjs --yes
 *   强制重新部署:       node scripts/deploy.mjs --force
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const WORKER_FILE = resolve(ROOT, 'worker.js')
const WRANGLER_TOML = resolve(ROOT, 'wrangler.toml')

// ============================================================
// 配置
// ============================================================
const CF_API_TOKEN = process.env.CF_API_TOKEN || ''
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || ''
const PAGES_PROJECT_NAME = 'mo-yan'
const WORKER_NAME = 'mo-yan'

// ============================================================
// 工具函数
// ============================================================
function run(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  return execSync(cmd, {
    cwd: ROOT,
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    ...opts,
  })
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function timestamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

function getFileMimeType(filePath) {
  const ext = extname(filePath).toLowerCase()
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.map':  'application/json',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

// ============================================================
// 步骤 1: 构建项目
// ============================================================
function buildProject() {
  console.log('\n📦 [1/4] 构建项目...')
  run('npm run build', { silent: false })
  console.log('✅ 构建完成')
}

// ============================================================
// 步骤 2: 生成 worker.js（硬编码 base64 方式）
// ============================================================
function generateWorker() {
  console.log('\n⚙️  [2/4] 生成 worker.js...')

  if (!existsSync(DIST)) {
    console.error('❌ dist/ 目录不存在，请先构建项目')
    process.exit(1)
  }

  // 收集所有资源文件
  const assets = []
  function collectFiles(dir, basePath = '') {
    for (const entry of readdirSync(dir)) {
      const fullPath = resolve(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        collectFiles(fullPath, `${basePath}${entry}/`)
      } else {
        const relativePath = `/${basePath}${entry}`
        // 对哈希文件名做映射: /assets/index-xxx.js → /assets/index-xxx.js
        assets.push({ path: relativePath, filePath: fullPath })
      }
    }
  }

  if (existsSync(DIST)) collectFiles(DIST)

  if (assets.length === 0) {
    console.error('❌ 在 dist/ 中未找到任何资源文件')
    process.exit(1)
  }

  console.log(`   发现 ${assets.length} 个资源文件`)

  // 构建 ASSETS 对象
  const assetEntries = assets.map(({ path, filePath }) => {
    const content = readFileSync(filePath)
    const b64 = content.toString('base64')
    const mime = getFileMimeType(filePath)
    return `  '${path}': { type: '${mime}', b64: '${b64}' }`
  })

  // 读取现有 worker.js 开头（注释部分）
  const workerHeader = `// 默言无声 - Meeting for Decision
// Cloudflare Worker (Service Worker format)
// 自动生成于: ${timestamp()}
// 请勿手动修改此文件 - 运行 \`node scripts/deploy.mjs\` 重新生成

`

  // 生成新的 worker.js
  const workerContent = `${workerHeader}const ASSETS = {
${assetEntries.join(',\n')},
}

// ============================================================
// 辅助函数
// ============================================================
function atobSafe(str) {
  try { return atob(str) } catch(e) { return null }
}

function serve(path) {
  const asset = ASSETS[path]
  if (!asset) return null
  try {
    const decoded = atobSafe(asset.b64)
    if (!decoded) return null
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0))
    const body = new TextDecoder().decode(bytes)
    return new Response(body, {
      headers: {
        'Content-Type': asset.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    })
  } catch(e) {
    return null
  }
}

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  const url = new URL(request.url)
  let path = url.pathname

  // 去除尾部斜杠（除了根路径）
  if (path.endsWith('/') && path !== '/') path = path.slice(0, -1)

  // 尝试精确匹配
  const result = serve(path)
  if (result) return result

  // 尝试带 index.html
  const indexResult = serve(path + '/index.html')
  if (indexResult) return indexResult

  // SPA fallback: 对于非静态资源请求，返回 index.html
  // 判断是否为静态资源
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.json', '.map']
  const ext = path.substring(path.lastIndexOf('.'))
  if (!staticExtensions.includes(ext)) {
    const html = serve('/')
    if (html) return html
  }

  return new Response('Not Found', { status: 404 })
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})
`

  writeFileSync(WORKER_FILE, workerContent, 'utf-8')
  console.log(`✅ worker.js 已生成 (${assets.length} 个资源，${(workerContent.length / 1024).toFixed(0)} KB)`)
}

// ============================================================
// 步骤 3: 部署到 Cloudflare Workers
// ============================================================
async function deployToWorkers() {
  console.log('\n🚀 [3/4] 部署到 Cloudflare Workers...')

  if (!CF_API_TOKEN && !existsSync(WRANGLER_TOML)) {
    console.log('   未设置 CF_API_TOKEN，尝试使用 wrangler 已保存的认证...')
  }

  try {
    // 先检查 wrangler 认证
    run(`npx wrangler whoami`, { silent: true })
    console.log('   wrangler 认证有效')
  } catch (e) {
    console.log('   wrangler 需要认证，使用 CF_API_TOKEN...')
    if (CF_API_TOKEN) {
      console.log('   ✓ CF_API_TOKEN 已设置')
    } else {
      console.warn('   ⚠️  未设置 CF_API_TOKEN 环境变量')
      console.warn('   请运行: npx wrangler login')
      console.warn('   或设置环境变量: set CF_API_TOKEN=your_token')
      console.warn('   然后重新运行部署\n')
      
      const answer = prompt('是否继续尝试部署？（使用已保存的认证）(Y/n): ')
      if (answer && answer.toLowerCase() === 'n') {
        console.log('❌ 部署取消')
        return false
      }
    }
  }

  try {
    const output = run(`npx wrangler deploy`, { silent: true })
    console.log(output)
    console.log('✅ 部署到 Cloudflare Workers 成功！')
    return true
  } catch (e) {
    console.error('❌ 部署失败:', e.stderr || e.message)
    return false
  }
}

// ============================================================
// 步骤 3b: 部署到 Cloudflare Pages
// ============================================================
async function deployToPages() {
  console.log('\n🚀 [3/4] 部署到 Cloudflare Pages...')

  if (!existsSync(DIST)) {
    console.error('❌ dist/ 目录不存在，请先构建项目')
    process.exit(1)
  }

  // 创建 _redirects 文件用于 SPA 路由
  const redirectsContent = `/*    /index.html   200
`
  writeFileSync(resolve(DIST, '_redirects'), redirectsContent, 'utf-8')

  try {
    const output = run(`npx wrangler pages deploy "${DIST}" --project-name="${PAGES_PROJECT_NAME}"`, { silent: false })
    console.log('✅ 部署到 Cloudflare Pages 成功！')
    return true
  } catch (e) {
    console.error('❌ 部署失败:', e.stderr || e.message)
    
    // 如果是首次部署，可能需要创建项目
    if (e.message && e.message.includes('not found')) {
      console.log('\n   项目可能还未创建，尝试创建...')
      try {
        run(`npx wrangler pages project create "${PAGES_PROJECT_NAME}" --production-branch main`, { silent: false })
        console.log('   Pages 项目创建成功，重新部署...')
        run(`npx wrangler pages deploy "${DIST}" --project-name="${PAGES_PROJECT_NAME}"`, { silent: false })
        console.log('✅ 部署到 Cloudflare Pages 成功！')
        return true
      } catch (e2) {
        console.error('❌ 创建 Pages 项目失败:', e2.stderr || e2.message)
        return false
      }
    }
    return false
  }
}

// ============================================================
// 步骤 4: Git 提交（可选）
// ============================================================
function gitCommit() {
  console.log('\n📝 [4/4] Git 提交...')
  
  // 检查是否有变更
  try {
    const status = run('git status --porcelain', { silent: true })
    if (!status.trim()) {
      console.log('   没有文件变更，跳过 Git 提交')
      return
    }
  } catch {
    console.log('   不是 Git 仓库，跳过')
    return
  }

  const msg = `deploy: 自动部署 ${timestamp()}`
  try {
    run(`git add worker.js package.json scripts/`, { silent: true })
    run(`git commit -m "${msg}"`, { silent: true })
    console.log(`✅ Git 已提交: ${msg}`)
    
    // 尝试推送到远程
    try {
      run('git push', { silent: true })
      console.log('✅ Git 已推送到远程')
    } catch {
      console.log('   ⚠️  推送失败，请手动推送: git push')
    }
  } catch {
    console.log('   ⚠️  提交失败，跳过')
  }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║    默言无声 - Meeting for Decision       ║')
  console.log('║    自动部署脚本                          ║')
  console.log('╚══════════════════════════════════════════╝')

  const args = process.argv.slice(2)
  const buildOnly = args.includes('--build-only')
  const genWorkerOnly = args.includes('--gen-worker')
  const deployPages = args.includes('--pages')
  const deployWorker = args.includes('--worker')
  
  // 默认行为：构建 → 生成 worker → 部署
  let skipBuild = args.includes('--skip-build')
  let skipConfirm = args.includes('--yes')
  let force = args.includes('--force')

  if (genWorkerOnly) {
    // 仅重新生成 worker.js
    if (!existsSync(DIST)) {
      console.log('dist/ 不存在，先构建...')
      buildProject()
    }
    generateWorker()
    console.log('\n✨ worker.js 已更新！运行 deploy 部署到 Cloudflare: node scripts/deploy.mjs --worker')
    return
  }

  if (buildOnly) {
    buildProject()
    console.log('\n✨ 构建完成！输出在 dist/ 目录')
    return
  }

  // === 完整部署流程 ===
  
  // 步骤 1: 构建
  buildProject()

  // 步骤 2: 生成 worker.js
  generateWorker()

  // 步骤 3: 部署
  let deploySuccess = false
  
  if (deployPages) {
    deploySuccess = await deployToPages()
  } else if (deployWorker) {
    deploySuccess = await deployToWorkers()
  } else {
    // 默认：优先尝试 Pages（更简单），如果失败则尝试 Workers
    console.log('\n   默认部署方式: Cloudflare Pages（推荐）')
    if (!skipConfirm) {
      // 等待一下让用户看到输出
    }
    deploySuccess = await deployToPages()
    if (!deploySuccess) {
      console.log('\n   Pages 部署失败，尝试 Workers 部署...')
      deploySuccess = await deployToWorkers()
    }
  }

  // 步骤 4: Git 提交
  if (deploySuccess) {
    gitCommit()
  }

  // 完成
  if (deploySuccess) {
    console.log('\n╔══════════════════════════════════════════╗')
    console.log('║  ✅  部署完成！                          ║')
    console.log('║  访问地址请查看上方输出                  ║')
    console.log('╚══════════════════════════════════════════╝')
  } else {
    console.log('\n╔══════════════════════════════════════════╗')
    console.log('║  ⚠️   部署未完成                          ║')
    console.log('║  请检查上方错误信息                      ║')
    console.log('╚══════════════════════════════════════════╝')
  }
}

main().catch(e => {
  console.error('❌ 脚本执行失败:', e)
  process.exit(1)
})
