const $ = (id) => document.getElementById(id)
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8777'
const msg = (text, cls = '') => {
  $('msg').textContent = text
  $('msg').className = cls
}

;(async () => {
  const { endpoint, dshUrl } = await chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, dshUrl: '' })
  $('endpoint').value = endpoint
  $('dshUrl').value = dshUrl
})()

$('save').addEventListener('click', async () => {
  const value = ($('endpoint').value || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '')
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value)) {
    msg('只支持本机地址，例如 http://127.0.0.1:8777', 'bad')
    return
  }
  await chrome.storage.local.set({ endpoint: value, dshUrl: ($('dshUrl').value || '').trim() })
  msg('已保存：' + value, 'ok')
})

$('test').addEventListener('click', async () => {
  const value = ($('endpoint').value || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '')
  msg('测试中…')
  try {
    const r = await fetch(value + '/health', { cache: 'no-store' })
    msg(r.ok ? '连接正常：' + value : '响应异常：HTTP ' + r.status, r.ok ? 'ok' : 'bad')
  } catch (e) {
    msg('连不上：' + String((e && e.message) || e), 'bad')
  }
})
