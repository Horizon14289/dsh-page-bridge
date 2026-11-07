// DSH Page Bridge - local receiver
// Listens on 127.0.0.1:8777 only.
//   POST /page   receive a page  -> last-page.json, state.json (readAt=null)
//   GET  /last   return the page -> marks it as READ (readAt=now)
//   GET  /state  lightweight status for the panel (no read side effect)
//   GET  /health liveness
import http from 'node:http'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const pageFile = path.join(here, 'last-page.json')
const stateFile = path.join(here, 'state.json')
const PORT = Number(process.env.PORT || 8777)
const HOST = '127.0.0.1'

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

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {})

    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, name: 'dsh-page-bridge', port: PORT })
    }

    if (req.method === 'GET' && req.url === '/state') {
      const state = readJson(stateFile)
      return send(res, 200, state ? { ok: true, ...state } : { ok: true, received: null })
    }

    if (req.method === 'GET' && req.url === '/last') {
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

    if (req.method === 'POST' && req.url === '/ack') {
      const state = readJson(stateFile) || {}
      state.readAt = now()
      writeJson(stateFile, state)
      return send(res, 200, { ok: true })
    }

    if (req.method === 'POST' && req.url === '/page') {
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
            },
            readAt: null,
          }
          writeJson(stateFile, state)
          console.log(`[${new Date().toLocaleTimeString()}] 收到: ${String(data.title || '').slice(0, 60)}`)
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
