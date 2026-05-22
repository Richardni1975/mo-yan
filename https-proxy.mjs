import https from 'https'
import http from 'http'
import fs from 'fs'
import os from 'os'

const VITE_PORT = 5173
const PROXY_PORT = 5174
const HOST = '0.0.0.0'

const sslOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
}

const server = https.createServer(sslOptions, (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: VITE_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }

  const proxy = http.request(options, (proxyRes) => {
    // For redirects, rewrite Location header to use HTTPS proxy port
    const location = proxyRes.headers['location']
    if (location) {
      proxyRes.headers['location'] = location.replace(
        `http://localhost:${VITE_PORT}`,
        `https://localhost:${PROXY_PORT}`
      )
    }
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res, { end: true })
  })

  proxy.on('error', () => {
    res.writeHead(502)
    res.end('Bad Gateway')
  })

  req.pipe(proxy, { end: true })
})

// WebSocket proxy for HMR
server.on('upgrade', (req, socket, head) => {
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: VITE_PORT,
    path: req.url,
    method: 'GET',
    headers: req.headers,
  })

  proxy.on('upgrade', (proxyRes, proxySocket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${proxyRes.headers['sec-websocket-accept']}\r\n\r\n`)
    proxySocket.pipe(socket).pipe(proxySocket)
  })

  proxy.on('error', () => socket.destroy())
  proxy.end()
})

server.listen(PROXY_PORT, HOST, () => {
  const ifaces = os.networkInterfaces()
  console.log(`HTTPS proxy running on https://localhost:${PROXY_PORT}`)
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`  ➜  https://${addr.address}:${PROXY_PORT}`)
      }
    }
  }
})
