// DSH Page Bridge - local receiver
// Listens on 127.0.0.1:8777 only. Stores the last received page in last-page.json.
import http from 'node:http'
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const outFile = path.join(here, 'last-page.json')
const PORT = Number(process.env.PORT || 8777)
const HOST = '127.0.0.1'

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

    if (req.method === 'GET' && req.url === '/last') {
      try {
        return send(res, 200, JSON.parse(readFileSync(outFile, 'utf8')))
      } catch {
        return send(res, 404, { error: 'no page received yet' })
      }
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
          writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8')
          const chars = String(data.text || '').length
          console.log(`[${new Date().toLocaleTimeString()}] ${String(data.title || '').slice(0, 60)}`)
          console.log(`    ${String(data.url).slice(0, 90)}`)
          console.log(`    ${chars} chars -> ${outFile}`)
          return send(res, 200, { ok: true, chars })
        } catch (e) {
          return send(res, 400, { error: String((e && e.message) || e) })
        }
      })
      return
    }

    send(res, 404, { error: 'not found' })
  })
  .listen(PORT, HOST, () => {
    console.log(`DSH Page Bridge receiver listening on http://${HOST}:${PORT}`)
    console.log(`Pages will be written to: ${outFile}`)
    console.log('Keep this window open. 保持这个窗口开着。')
  })
