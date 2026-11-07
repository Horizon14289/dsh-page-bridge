const $ = (id) => document.getElementById(id)

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString()
}

async function refreshStatus() {
  const st = await chrome.runtime.sendMessage({ type: 'health' })
  const ok = st && st.ok
  $('dot').className = 'dot ' + (ok ? 'ok' : 'bad')
  $('statusText').textContent = ok ? '接收端已连接' : '接收端未连接'
  $('endpoint').textContent = (st && st.endpoint) || ''
  $('send').disabled = !ok
}

async function refreshLast() {
  const { last } = await chrome.storage.local.get('last')
  if (!last) {
    $('lastTitle').textContent = '还没有发送过'
    $('lastMeta').textContent = '—'
    return
  }
  $('lastTitle').textContent = last.ok ? last.title || '(无标题)' : '发送失败'
  $('lastMeta').textContent = last.ok
    ? `${fmtTime(last.at)} · ${last.chars} 字`
    : `${fmtTime(last.at)} · ${last.error || '未知错误'}`
}

$('send').addEventListener('click', async () => {
  $('send').disabled = true
  $('send').textContent = '发送中…'
  const status = await chrome.runtime.sendMessage({ type: 'send' })
  await refreshLast()
  $('send').textContent = '发送当前页面'
  $('send').disabled = false
  if (!status || !status.ok) $('statusText').textContent = '发送失败'
})

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage())

refreshStatus()
refreshLast()
