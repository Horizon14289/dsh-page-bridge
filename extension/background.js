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

async function collectPage(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (limit) => ({
      title: document.title,
      url: location.href,
      text: (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit),
      headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 25),
      links: [...document.querySelectorAll('a[href]')]
        .map((a) => ({ text: (a.innerText || '').trim().slice(0, 60), href: a.href }))
        .filter((x) => x.text)
        .slice(0, 40),
    }),
    args: [MAX_TEXT],
  })
  if (!res || !res.result) throw new Error('页面上取不到内容')
  return res.result
}

async function sendPage(tab) {
  let endpoint = ''
  try {
    if (!tab || !tab.id) throw new Error('没有活动标签页')
    endpoint = await getEndpoint()
    assertScriptable(tab.url)
    const page = await collectPage(tab.id)
    const payload = Object.assign({}, page, { sentAt: new Date().toISOString(), tabTitle: tab.title || '' })
    const res = await fetch(endpoint + '/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const status = { ok: true, at: payload.sentAt, endpoint, title: page.title, url: page.url, chars: page.text.length, error: '' }
    await chrome.storage.local.set({ last: status })
    badge('OK', 1500)
    return status
  } catch (e) {
    const raw = String((e && e.message) || e)
    const status = { ok: false, at: new Date().toISOString(), endpoint, title: '', url: '', chars: 0, error: friendlyError(raw) }
    await chrome.storage.local.set({ last: status })
    badge('X', 2500)
    return status
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'send-page') return
  await sendPage(tab || (await activeTab()))
})

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return
  if (msg.type === 'send') {
    ;(async () => reply(await sendPage(await activeTab())))()
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
