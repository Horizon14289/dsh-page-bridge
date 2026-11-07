const $ = (id) => document.getElementById(id)
const POLL_MS = 2000

function endpoint() {
  return chrome.storage.local.get({ endpoint: 'http://127.0.0.1:8777' }).then((x) => String(x.endpoint).replace(/\/+$/, ''))
}

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString() + ' ' + d.toLocaleDateString()
}

function host(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function refresh() {
  const base = await endpoint()
  let state = null
  let ok = false
  try {
    const r = await fetch(base + '/state', { cache: 'no-store' })
    if (r.ok) {
      state = await r.json()
      ok = true
    }
  } catch {}
  $('conn').textContent = ok ? '已连接' : '未连接'
  $('conn').className = 'pill ' + (ok ? 'ok' : 'bad')
  $('send').disabled = false

  const card = $('card')
  const received = state && state.received
  const readAt = state && state.readAt

  if (!received) {
    card.className = 'card idle'
    $('statusIcon').textContent = '•'
    $('statusTitle').textContent = '还没有发送页面'
    $('statusSub').textContent = '在网页上按 Alt+Shift+S，或点下面的按钮'
    $('dTitle').textContent = $('dUrl').textContent = $('dChars').textContent = '—'
    $('dSent').textContent = $('dRead').textContent = '—'
    return
  }

  $('dTitle').textContent = received.title || '(无标题)'
  $('dUrl').textContent = host(received.url)
  $('dChars').textContent = received.chars + ' 字'
  $('dSent').textContent = fmt(received.sentAt)
  $('dRead').textContent = fmt(readAt)

  if (readAt) {
    card.className = 'card ok'
    $('statusIcon').textContent = '✓'
    $('statusTitle').textContent = 'AI 已读取'
    $('statusSub').textContent = '读取于 ' + fmt(readAt)
  } else {
    card.className = 'card warn'
    $('statusIcon').textContent = '↑'
    $('statusTitle').textContent = '已发送，等待 AI 读取'
    $('statusSub').textContent = '回对话框发一句「读一下刚才的页面」'
  }
}

$('send').addEventListener('click', async () => {
  $('send').disabled = true
  $('send').textContent = '发送中…'
  await chrome.runtime.sendMessage({ type: 'send' })
  $('send').textContent = '发送当前页面'
  $('send').disabled = false
  refresh()
})

;(async () => {
  const { dshUrl } = await chrome.storage.local.get({ dshUrl: '' })
  if (dshUrl) {
    const btn = $('openDsh')
    btn.hidden = false
    btn.addEventListener('click', () => chrome.tabs.create({ url: dshUrl }))
  }
})()

refresh()
setInterval(refresh, POLL_MS)
