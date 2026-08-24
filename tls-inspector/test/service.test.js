import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import { execFileSync } from 'node:child_process'
import { createTlsInspectorServer } from '../src/index.js'
async function startHttpsServer() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcac-tls-fixture-'))
  const keyPath = path.join(tempDir, 'server.key')
  const certPath = path.join(tempDir, 'server.crt')
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-subj',
    '/CN=localhost',
    '-days',
    '3650',
  ], { stdio: 'ignore' })
  const [key, cert] = await Promise.all([
    fs.readFile(keyPath, 'utf8'),
    fs.readFile(certPath, 'utf8'),
  ])
  const server = https.createServer({
    key,
    cert,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2',
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA:AES128-SHA',
    honorCipherOrder: true,
  }, (request, response) => {
    response.writeHead(200, {
      'Strict-Transport-Security': 'max-age=172800',
      'Content-Type': 'text/plain',
    })
    response.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.on('close', () => {
    void fs.rm(tempDir, { recursive: true, force: true })
  })
  return server
}

function requestJson(baseUrl, method, pathName, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl)
    const request = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-test',
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          statusCode: response.statusCode ?? 0,
          body: text ? JSON.parse(text) : {},
        })
      })
    })
    request.on('error', reject)
    if (body !== undefined) {
      request.write(JSON.stringify(body))
    }
    request.end()
  })
}

import http from 'node:http'

test('tls-inspector 可以创建目标并返回深度扫描快照', async () => {
  const httpsServer = await startHttpsServer()
  const httpsAddress = httpsServer.address()
  const port = typeof httpsAddress === 'object' && httpsAddress ? httpsAddress.port : 0
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcac-tls-inspector-test-'))
  const app = createTlsInspectorServer({ port: 0, host: '127.0.0.1', dataDir, schedulerIntervalMs: 60_000 })
  await app.init()
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  const inspectorPort = typeof address === 'object' && address ? address.port : 0
  const baseUrl = `http://127.0.0.1:${inspectorPort}`

  try {
    const createResult = await requestJson(baseUrl, 'POST', '/api/v1/tls-inspector/targets', {
      host: '127.0.0.1',
      port,
      serverName: 'localhost',
      serviceAssetId: 'asset-1',
      schedule: { intervalSeconds: 3600 },
    })
    assert.equal(createResult.statusCode, 201)
    const targetId = createResult.body.data.id
    assert.ok(targetId)

    const inspectResult = await requestJson(baseUrl, 'POST', `/api/v1/tls-inspector/targets/${targetId}/inspect`)
    assert.equal(inspectResult.statusCode, 200)
    assert.equal(inspectResult.body.data.targetId, targetId)
    assert.equal(inspectResult.body.data.summary.legacyProtocolEnabled, false)
    assert.equal(inspectResult.body.data.protocolDetails.hsts.enabled, true)
    assert.equal(typeof inspectResult.body.data.riskSummary.trustPathIssueCount, 'number')
    assert.equal(typeof inspectResult.body.data.riskSummary.trustPathUnsupportedCount, 'number')
    assert.ok(Array.isArray(inspectResult.body.data.protocols))
    assert.ok(Array.isArray(inspectResult.body.data.trustPaths))
    assert.ok(Array.isArray(inspectResult.body.data.simulations))

    const latestResult = await requestJson(baseUrl, 'GET', `/api/v1/tls-inspector/targets/${targetId}/latest`)
    assert.equal(latestResult.statusCode, 200)
    assert.equal(latestResult.body.data.id, inspectResult.body.data.id)

    const listResult = await requestJson(baseUrl, 'GET', '/api/v1/tls-inspector/targets')
    assert.equal(listResult.statusCode, 200)
    assert.equal(listResult.body.data.items.length, 1)
    assert.equal(listResult.body.data.items[0].latestSummary.weakCipherDetected, true)
  } finally {
    await new Promise((resolve) => app.server.close(resolve))
    await app.close()
    await new Promise((resolve) => httpsServer.close(resolve))
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
