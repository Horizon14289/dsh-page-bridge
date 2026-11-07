// DSH Page Bridge - background service worker
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8777'
const MAX_TEXT = 60000

// 浏览器禁止扩展读取的页面，提前拦下并给出人话提示
const BLOCKED_PAGES = [
  [/^(edge|chrome|about|devtools|view-source|chrome-extension|moz-extension):/i, '浏览器内置页不允许扩展读取，换一个普通网页试试'],
  [/(microsoftedge\.microsoft\.com\/addons|chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i, '扩展商店页面不允许扩展读取'],
]
const BLOCKED_ERRORS = /cannot be scripted|Cannot access contents|The extensions gallery/i

function friendlyError(message) {
  if (BLOCKED_ERRORS.test(message)) return '这个页面不允许扩展读取（浏览器内置页/商店页），换一个普通网页试试'
  if (/Failed to fetch|NetworkError/i.test(message)) return '发不到接收端：检查 start-bridge 是否在跑、站点权限是否打开'
  if (/HTTP 4\d\d|HTTP 5\d\d/i.test(message)) return '接收端返回错误：' + message
  return message
}

async function getEndpoint() {
  const { endpoint } = await chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT })
  return String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
}

function badge(text, ms) {
  chrome.action.setBadgeText({ text })
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms)
}

function assertScriptable(url) {
  for (const [re, message] of BLOCKED_PAGES) {
    if (re.test(url || '')) throw new Error(message)
  }
}

// 注入到页面里的采集函数：等稳定 → 主文档 → shadow DOM → 同源 iframe（递归）
async function collectInPage(limit) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const seen = new Set()
  const parts = []
  let shadowHosts = 0
  let frames = 0
  let blockedFrames = 0

  const push = (raw) => {
    const s = String(raw || '').replace(/\u00a0/g, ' ').trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      parts.push(s)
    }
  }

  const deepShadow = (root, depth) => {
    if (depth > 5) return
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot) continue
      shadowHosts++
      if (!el.innerText || !el.innerText.trim()) push(el.shadowRoot.textContent)
      deepShadow(el.shadowRoot, depth + 1)
    }
  }

  const walkDoc = (doc, depth) => {
    if (!doc || depth > 4) return
    try {
      if (doc.body) push(doc.body.innerText)
    } catch {}
    try {
      deepShadow(doc, 0)
    } catch {}
    let nodes = []
    try {
      nodes = doc.querySelectorAll('iframe,frame')
    } catch {}
    for (const f of nodes) {
      let cd = null
      try {
        cd = f.contentDocument
      } catch {}
      if (cd) {
        frames++
        walkDoc(cd, depth + 1)
      } else {
        blockedFrames++
      }
    }
  }

  let last = -1
  for (let i = 0; i < 12; i++) {
    let len = 0
    try {
      len = document.body ? document.body.innerText.length : 0
    } catch {}
    if (len > 0 && len === last) break
    last = len
    await sleep(250)
  }

  walkDoc(document, 0)

  const text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit)
  const headings = [...document.querySelectorAll('h1,h2,h3')]
    .map((h) => h.innerText.trim())
    .filter(Boolean)
    .slice(0, 25)
  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: (a.innerText || '').trim().slice(0, 60), href: a.href }))
    .filter((x) => x.text)
    .slice(0, 40)

  return { title: document.title, url: location.href, text, headings, links, stats: { frames, blockedFrames, shadowHosts } }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

// grabId 可选：AI 主动索取时带上，接收端据此清除待命请求
async function sendPage(tab, grabId) {
  let endpoint = ''
  try {
    if (!tab || !tab.id) throw new Error('没有活动标签页')
    endpoint = await getEndpoint()
    assertScriptable(tab.url)
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectInPage,
      args: [MAX_TEXT],
    })
    if (!res || !res.result) throw new Error('页面上取不到内容')
    const page = res.result
    const payload = Object.assign({}, page, {
      sentAt: new Date().toISOString(),
      tabTitle: tab.title || '',
      grabId: grabId || undefined,
    })
    const r = await fetch(endpoint + '/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const status = {
      ok: true,
      at: payload.sentAt,
      endpoint,
      title: page.title,
      url: page.url,
      chars: page.text.length,
      stats: page.stats,
      grabId: grabId || '',
      error: '',
    }
    await chrome.storage.local.set({ last: status })
    badge('OK', 1500)
    return status
  } catch (e) {
    const raw = String((e && e.message) || e)
    const status = {
      ok: false,
      at: new Date().toISOString(),
      endpoint,
      title: '',
      url: '',
      chars: 0,
      stats: null,
      grabId: grabId || '',
      error: friendlyError(raw),
    }
    await chrome.storage.local.set({ last: status })
    badge('X', 2500)
    return status
  }
}

// ---- 待命抓取：轮询接收端的 grab 请求 ----
let grabbing = false

async function grabLoop() {
  if (grabbing) return
  grabbing = true
  try {
    for (let i = 0; i < 6; i++) {
      const endpoint = await getEndpoint()
      let id = ''
      try {
        const r = await fetch(endpoint + '/grab/pending?wait=25000', { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json()
          id = j && j.id ? String(j.id) : ''
        }
      } catch {
        // 接收端没开或网络抖动，稍后重试
      }
      if (id) {
        const tab = await activeTab()
        await sendPage(tab, id)
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  } finally {
    grabbing = false
  }
}

function ensureAlarm() {
  try {
    chrome.alarms.create('grab-poll', { periodInMinutes: 1 })
  } catch {}
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'grab-poll') void grabLoop()
})
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm()
  void grabLoop()
})
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm()
  void grabLoop()
})

// 用户点击 / 快捷键时顺便把轮询叫醒
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'send-page') return
  await sendPage(tab || (await activeTab()))
  void grabLoop()
})

chrome.action.onClicked.addListener(() => {
  void grabLoop()
})

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return
  if (msg.type === 'send') {
    ;(async () => {
      const status = await sendPage(await activeTab())
      void grabLoop()
      reply(status)
    })()
    return true
  }
  if (msg.type === 'health') {
    ;(async () => {
      const endpoint = await getEndpoint()
      try {
        const r = await fetch(endpoint + '/health', { cache: 'no-store' })
        reply({ ok: r.ok, endpoint })
      } catch (e) {
        reply({ ok: false, endpoint, error: String((e && e.message) || e) })
      }
    })()
    return true
  }
})

// service worker 启动即进入待命
ensureAlarm()
void grabLoop()
