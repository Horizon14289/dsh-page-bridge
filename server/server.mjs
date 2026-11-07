// DSH Page Bridge - local receiver
// Listens on 127.0.0.1:8777 only.
//   POST /page           receive a page  -> last-page.json, state.json (readAt=null)
//   GET  /last           return the page -> marks it as READ (readAt=now)
//   GET  /state          lightweight status for the popup (no read side effect)
//   GET  /health         liveness
//   POST /grab           AI asks the extension to capture the active tab now
//   GET  /grab/pending   long-poll used by the extension to pick up a grab request
import http from 'node:http'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const pageFile = path.join(here, 'last-page.json')
const stateFile = path.join(here, 'state.json')
const batchFile = path.join(here, 'last-batch.json')
const PORT = Number(process.env.PORT || 8777)
const HOST = '127.0.0.1'
const GRAB_TTL_MS = 60_000

const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2), 'utf8')
const now = () => new Date().toISOString()

const send = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(obj))
}

// ---- 待命抓取状态 ----
let pendingGrab = null // { id, at }
let waiters = [] // [{ reply }]

const takeGrab = () => {
  const g = pendingGrab
  pendingGrab = null
  return g
}

const flushWaiters = () => {
  if (!pendingGrab) return
  const list = waiters
  waiters = []
  for (const w of list) w(takeGrab())
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'OPTIONS') return send(res, 204, {})

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, name: 'dsh-page-bridge', port: PORT })
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      const state = readJson(stateFile)
      return send(res, 200, state ? { ok: true, ...state } : { ok: true, received: null })
    }

    // AI 主动索取：设置一个待命请求，扩展会在 1–2 秒内轮询到并抓取
    if (req.method === 'POST' && url.pathname === '/grab') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        let mode = 'single'
        try {
          const body = raw ? JSON.parse(raw) : {}
          if (body && body.mode === 'all') mode = 'all'
        } catch {}
        const g = { id: randomUUID(), at: now(), mode }
        pendingGrab = g
        console.log(`[grab] ${new Date().toLocaleTimeString()} AI 请求抓取（${mode}）`)
        flushWaiters()
        send(res, 200, { ok: true, id: g.id, mode })
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/grab/pending') {
      const wait = Math.min(30_000, Math.max(0, Number(url.searchParams.get('wait') || 0)))
      if (pendingGrab && Date.now() - Date.parse(pendingGrab.at) > GRAB_TTL_MS) pendingGrab = null
      if (pendingGrab) return send(res, 200, takeGrab())
      if (wait === 0) return send(res, 200, { id: null })
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        waiters = waiters.filter((w) => w.reply !== fn)
        send(res, 200, { id: null })
      }, wait)
      const fn = (g) => {
        if (done) return
        done = true
        clearTimeout(timer)
        send(res, 200, g || { id: null })
      }
      waiters.push({ reply: fn })
      return
    }

    if (req.method === 'POST' && url.pathname === '/batch') {
      let raw = ''
      req.on('data', (c) => {
        raw += c
        if (raw.length > 8_000_000) req.destroy()
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(raw)
          writeJson(batchFile, data)
          const pages = data.pages || []
          const state = {
            batch: {
              count: pages.length,
              failed: (data.failed || []).length,
              at: data.sentAt || now(),
              grabId: data.grabId || null,
            },
            received: {
              title: `${pages.length} 个标签页`,
              url: '',
              chars: pages.reduce((n, x) => n + (x.chars || 0), 0),
              sentAt: data.sentAt || now(),
              stats: null,
            },
            readAt: null,
            grabId: data.grabId || null,
          }
          writeJson(stateFile, state)
          console.log(`[batch] ${new Date().toLocaleTimeString()} 收到 ${pages.length} 个标签页`)
          send(res, 200, { ok: true, count: pages.length })
        } catch (e) {
          send(res, 400, { error: String((e && e.message) || e) })
        }
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/batch') {
      const b = readJson(batchFile)
      if (!b) return send(res, 404, { error: 'no batch received yet' })
      return send(res, 200, b)
    }

    if (req.method === 'GET' && url.pathname === '/last') {
      const page = readJson(pageFile)
      if (!page) return send(res, 404, { error: 'no page received yet' })
      const state = readJson(stateFile) || {}
      if (!state.readAt) {
        state.readAt = now()
        writeJson(stateFile, state)
        console.log(`[已读取] ${new Date().toLocaleTimeString()} AI 读取了页面`)
      }
      return send(res, 200, page)
    }

    if (req.method === 'POST' && url.pathname === '/ack') {
      const state = readJson(stateFile) || {}
      state.readAt = now()
      writeJson(stateFile, state)
      return send(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/page') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 4_000_000) req.destroy()
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (!data || typeof data.url !== 'string') throw new Error('missing url')
          writeJson(pageFile, data)
          const state = {
            received: {
              title: String(data.title || ''),
              url: String(data.url || ''),
              chars: String(data.text || '').length,
              sentAt: data.sentAt || now(),
              stats: data.stats || null,
            },
            readAt: null,
            grabId: data.grabId || null,
            lastGrabAt: data.grabId ? now() : undefined,
          }
          writeJson(stateFile, state)
          const how = data.grabId ? 'AI 索取' : '手动'
          console.log(`[${new Date().toLocaleTimeString()}] 收到(${how}): ${String(data.title || '').slice(0, 60)}`)
          console.log(`    ${String(data.url).slice(0, 90)} · ${state.received.chars} 字`)
          return send(res, 200, { ok: true, chars: state.received.chars })
        } catch (e) {
          return send(res, 400, { error: String((e && e.message) || e) })
        }
      })
      return
    }

    send(res, 404, { error: 'not found' })
  })
  .listen(PORT, HOST, () => {
    console.log(`DSH Page Bridge receiver: http://${HOST}:${PORT}`)
    console.log(`page -> ${pageFile}`)
    console.log('保持窗口开着。AI 读取后，面板会显示「已读取」。')
    if (!existsSync(pageFile)) console.log('(暂时还没有收到页面)')
  })
