import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('.', import.meta.url))

export function requiresGenerationApproval(name, args, businessTools = []) {
  if (/^mcp__beeftv__canvas_generation_submit(?:_[a-f0-9]{12})?$/.test(name)) return true
  if (!/^mcp__beeftv__business_call(?:_[a-f0-9]{12})?$/.test(name)) return false
  const tool = businessTools.find(item => item.id === args?.tool)
  return !(tool?.readOnly === true && tool.submitsGeneration === false)
}

const proposeToolName = /^mcp__beeftv__canvas_generation_propose(?:_[a-f0-9]{12})?$/
const generationUnits = { image: ['images', 'pictures'], video: ['clips', 'video'], audio: ['clips', 'Audio'] }

// Keeps BeefTV's own quote for each proposal, so the approval card can say what the user pays for.
export function rememberQuote(quotes, name, result) {
  if (result?.isError || !proposeToolName.test(name)) return
  const text = Array.isArray(result?.content) ? result.content.find(item => item?.type === 'text' && typeof item.text === 'string')?.text : undefined
  let quote
  try {
    quote = JSON.parse(text)?.result
  } catch {
    return
  }
  if (typeof quote?.proposalId !== 'string' || !quote.proposalId) return
  quotes.delete(quote.proposalId)
  quotes.set(quote.proposalId, quote)
  // Bounded so a long session does not keep every quote it ever saw.
  while (quotes.size > 50) quotes.delete(quotes.keys().next().value)
}

// Text for the DSH approval card. It names only the nodes this submission sends: a proposal can be
// submitted again for a subset, such as retrying failed nodes. Prices are BeefTV's per-node quotes.
export function approvalReason(name, args, businessTools = [], quotes = new Map()) {
  if (!/^mcp__beeftv__canvas_generation_submit(?:_[a-f0-9]{12})?$/.test(name)) {
    const business = businessTools.find(tool => tool.id === args?.tool)
    return business
      ? `BeefTV request execution${business.method} ${business.path}${business.submitsGeneration ? ', will submit build tasks that may be billed' : ', will modify the workspace'}. Please check this operation.`
      : 'BeefTV will submit a generated or unidentified business operation, which may modify the workspace or incur charges. Please check this operation.'
  }
  const quote = quotes.get(args?.proposalId)
  const submitted = Array.isArray(args?.nodeIds) ? args.nodeIds : []
  const quoted = Array.isArray(quote?.targets) ? quote.targets : []
  const targets = quoted.filter(target => submitted.includes(target?.nodeId))
  if (!quote || !submitted.length || targets.length !== new Set(submitted).size) {
    return 'BeefTV will submit a paid generation, but this submission does not match the existing quote and the cost cannot be displayed. You can reject it first and let the Agent re-quote before submitting.'
  }
  const kinds = [...new Set(targets.map(target => target.kind))]
  const [unit, label] = kinds.length === 1 ? generationUnits[kinds[0]] || ['items', 'generate'] : ['items', 'generate']
  const amount = targets.reduce((sum, target) => sum + (target.kind === 'image' ? Number(target.parameters?.count) || 1 : 1), 0)
  const models = [...new Set(targets.map(target => target.model).filter(model => typeof model === 'string' && model))]
  const priced = targets.filter(target => Number.isFinite(target.estimate?.amount))
  const cost = targets.length === quoted.length && typeof quote.estimate?.text === 'string' && quote.estimate.text
    ? quote.estimate.text.replace(/[。.]+$/, '')
    : priced.length === targets.length
      ? `Estimated cost: ¥${Number(priced.reduce((sum, target) => sum + target.estimate.amount, 0).toFixed(4))}`
      : priced.length ? 'Some fees are actually billed based on the selected channel' : 'Fees are actually billed according to the selected channel'
  return `BeefTV will generate${amount} ${unit}${label}${models.length ? `（${models.join('、')}）` : ''}。${cost}。`
}

export function runtimeRecord(value) {
  for (const key of ['bridgeURL', 'baseURL']) {
    const url = new URL(value?.[key])
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('The workspace address must be the local loopback address')
  }
  if (typeof value.bridgeToken !== 'string' || !value.bridgeToken) throw new Error('Workspace did not return bridge credentials')
  return value
}

export function embeddedDocument(html, basePath, parentOrigin = '*') {
  const config = JSON.stringify({ embedded: true, apiBase: `${basePath}/api`, basePath, parentOrigin }).replaceAll('<', '\\u003c')
  // The asset page's stacking context otherwise puts its narrow sidebar below the dismiss scrim.
  const styles = `<style>
html .app-workspace-shell:has(.assets-library-page) .app-workspace-main-row{z-index:auto}
/* Only top controls avoid the host overlay. The page and canvas remain full width. */
html .canvas-topbar{padding-left:calc(8px + var(--beeftv-host-leading,0px))!important}
html .app-user-workspace .app-workspace-floating-menu{left:calc(12px + var(--beeftv-host-leading,0px))!important}
/* A full sidebar stays in place. Its brand row can sit below the host controls. */
html[data-beeftv-host-chrome] .app-workspace-sidebar-brand-row,
html[data-beeftv-host-chrome] .app-workspace-sidebar-rail-header{margin-top:48px}
</style>`
  const bridge = `<script>(${embeddedChromeBridge.toString()})()</script>`
  return html.replace(/<base\b[^>]*>/gi, '').replace(/<head[^>]*>/i, match => `${match}<base href="${basePath}/"><meta name="referrer" content="no-referrer">${styles}<script>window.__BEEFTV_HARNESS__=${config}</script>${bridge}`)
}

// The parent only transmits bounded layout metrics, never workspace data or credentials.
function embeddedChromeBridge() {
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'beeftv:host-chrome') return
    const leading = event.data.leading
    if (typeof leading !== 'number' || !Number.isFinite(leading) || leading < 0 || leading > 320) return
    document.documentElement.style.setProperty('--beeftv-host-leading', `${leading}px`)
    document.documentElement.toggleAttribute('data-beeftv-host-chrome', leading > 0)
  })
}

export function publicContext(value) {
  if (!value || typeof value.route !== 'string' || !value.route.startsWith('/') || value.route.startsWith('//') || value.route.length > 2048) throw new Error('Invalid workspace context')
  const context = { route: value.route }
  for (const key of ['canvasId', 'canvasTitle']) {
    if (typeof value[key] === 'string') context[key] = value[key].slice(0, 256)
  }
  context.selectedNodeIds = Array.isArray(value.selectedNodeIds) ? value.selectedNodeIds.filter(id => typeof id === 'string').slice(0, 100).map(id => id.slice(0, 256)) : []
  return context
}

// Paths DeepSeek Harness manages itself. The embedded workspace page never reaches them.
const managedWorkspacePaths = ['/api/assistant', '/api/ops/clients', '/api/agent-clients']

// Judges the raw request path. URL parsers resolve encoded separators and dot segments differently
// from the Go bridge, so ambiguous spellings are refused instead of resolved. Returns 0, 400 or 403.
export function embeddedPathRejection(rawPath) {
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || /[\\#]|%(?:2f|5c|25)/i.test(rawPath)) return 400
  let path
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return 400
  }
  const segments = path.split('/').slice(1)
  if (segments.some((segment, index) => segment === '.' || segment === '..' || (segment === '' && index < segments.length - 1))) return 400
  // The bridge also serves the workspace under /beeftv/app, so that prefix is removed before matching.
  const effective = (path.replace(/^\/beeftv\/app(?=\/|$)/i, '') || '/').toLowerCase()
  return managedWorkspacePaths.some(managed => effective === managed || effective.startsWith(`${managed}/`)) ? 403 : 0
}

const localApp = {
  bundle: '/Applications/BeefTV.app',
  info: '/Applications/BeefTV.app/Contents/Info.plist',
  executable: '/Applications/BeefTV.app/Contents/MacOS/BeefTV',
  cli: '/Applications/BeefTV.app/Contents/MacOS/cli/beeftv',
}
// 2.2.0 is the first desktop release with the harness bridge. Older builds pass unknown flags to the
// GUI, so starting them with harness flags would open the desktop window instead of attaching.
const minimumLocalAppVersion = '2.2.0'

function supportsHarness(version) {
  const parts = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version || '')?.slice(1).map(Number)
  if (!parts) return false
  const minimum = minimumLocalAppVersion.split('.').map(Number)
  const index = parts.findIndex((part, position) => part !== minimum[position])
  return index === -1 || parts[index] > minimum[index]
}

function bundleVersion(plist) {
  return new Promise(resolve => {
    execFile('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', plist], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim() || null)
    })
  })
}

export async function localAppStatus() {
  try {
    await Promise.all([access(localApp.executable, constants.X_OK), access(localApp.cli, constants.X_OK)])
  } catch {
    return { compatible: false, version: null, message: `Native BeefTV not found. Please install${minimumLocalAppVersion}or later and reconnect.` }
  }
  const version = await bundleVersion(localApp.info)
  if (supportsHarness(version)) return { compatible: true, version, message: null }
  return {
    compatible: false, version,
    message: version
      ? `The native BeefTV version is${version}, need${minimumLocalAppVersion} or higher. Please reconnect after upgrading.`
      : `Unable to read version of native BeefTV. Please reinstall${minimumLocalAppVersion}or later and reconnect.`,
  }
}

async function requireLocalApp() {
  const app = await localAppStatus()
  if (!app.compatible) throw new Error(app.message)
}

async function bundledPaths() {
  const contents = join(root, 'runtime', 'Contents')
  const paths = { executable: join(contents, 'MacOS', 'BeefTV'), cli: join(contents, 'MacOS', 'cli', 'beeftv') }
  try {
    await Promise.all(Object.values(paths).map(path => access(path, constants.X_OK)))
  } catch (error) {
    throw new Error('The plugin is missing the built-in BeefTV runtime, please reinstall the plugin', { cause: error })
  }
  return paths
}

export async function startLocalRuntime() {
  await requireLocalApp()
  try {
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/open', ['-a', localApp.bundle], { timeout: 10_000 }, error => {
        if (error) reject(error)
        else resolve()
      })
    })
  } catch (error) {
    throw new Error('Unable to open local BeefTV, please confirm /Applications/BeefTV.app is fully installed', { cause: error })
  }
  const deadline = Date.now() + 30_000
  let lastFailure
  while (Date.now() < deadline) {
    try {
      return await launchRuntime(localApp, { attachOnly: true })
    } catch (error) {
      lastFailure = error
    }
    await delay(250)
  }
  throw new Error('The local BeefTV is not ready yet. Please check the startup prompt of the desktop application and reconnect.', { cause: lastFailure })
}

// Reconnects to a running desktop App without opening it again.
export async function attachLocalRuntime() {
  await requireLocalApp()
  return launchRuntime(localApp, { attachOnly: true })
}

// The standalone workspace only ever runs the runtime bundled with the plugin.
export async function startRuntime(dataDir) {
  return launchRuntime(await bundledPaths(), { dataDir })
}

async function launchRuntime(paths, { dataDir, attachOnly = false }) {
  const args = ['--harness-runtime']
  if (attachOnly) args.push('--harness-attach-only')
  if (dataDir) args.push('--data-dir', dataDir)
  const child = spawn(paths.executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  // Runtime logs stay out of model output and the browser. Readiness is the only stdout record.
  child.stderr.resume()
  const lines = createInterface({ input: child.stdout })
  let ready = false
  const record = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('It takes more than 30 seconds to start BeefTV, please check the installation and workspace status'))
    }, attachOnly ? 3_000 : 30_000)
    const fail = () => {
      if (ready) return
      clearTimeout(timer)
      reject(new Error('BeefTV runtime failed to start. Please confirm that the installation is complete and the workspace is not occupied by an old version.'))
    }
    child.once('error', fail)
    child.once('exit', fail)
    lines.on('line', line => {
      if (ready) return
      try {
        const value = runtimeRecord(JSON.parse(line))
        ready = true
        clearTimeout(timer)
        resolve(value)
      } catch {
        // Go/native startup notices are not readiness records.
      }
    })
  }).catch(error => {
    lines.close()
    child.stdin.end()
    child.kill('SIGTERM')
    throw error
  })
  return {
    ...record, cli: paths.cli, child,
    close() {
      lines.close()
      child.stdin.end()
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          if (record.owned) child.kill('SIGTERM')
          resolve()
        }, record.owned ? 10_000 : 1_000)
        timer.unref()
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

export async function workspaceJSON(runtime, path, options = {}) {
  const response = await fetch(`${runtime.bridgeURL}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', 'X-Beeftv-Harness-Token': runtime.bridgeToken, ...options.headers },
  })
  const value = await response.json()
  if (!response.ok || value.code !== 0) throw new Error(value.msg || `BeefTV request failed (${response.status})`)
  return value.data
}

export async function inspectWorkspace(runtime) {
  const [health, bootstrap] = await Promise.all([
    workspaceJSON(runtime, '/api/health'),
    workspaceJSON(runtime, '/api/workspace/bootstrap'),
  ])
  if (!health.ready || !health.schema?.ready || !health.build?.version || !bootstrap.workspace?.id) {
    throw new Error('BeefTV workspace is not ready yet, please try again after completing startup in the native app')
  }
  if (String(runtime.version).replace(/^v/, '') !== health.build.version.replace(/^v/, '')) {
    throw new Error('BeefTV connection version has changed, please reconnect.')
  }
  return {
    build: health.build,
    workspace: { id: bootstrap.workspace.id, name: bootstrap.workspace.name, storage: bootstrap.workspace.storage },
    contractVersion: bootstrap.contractVersion,
  }
}
