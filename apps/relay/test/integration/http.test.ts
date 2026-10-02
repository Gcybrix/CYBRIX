/**
 * End-to-end over REAL HTTP + REAL TCP data plane: real fetch → real
 * node:http mock panel → real tcp-forward adapter against a real echo server.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  connect,
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
  type Socket,
} from 'node:net'
import { RelayRuntime } from '../../src/runtime'
import { quietLogger } from '../helpers'
import { Logger } from '../../src/log'
import {
  RELAY_ID,
  USER_ID,
  configFixture,
  syncEnvelope,
  testConfig,
  userFixture,
  fakeToken,
} from '../helpers'

interface Recorded {
  method: string
  url: string
  body: unknown
  auth: string | undefined
}

const seen: Recorded[] = []
let panel: Server
let panelPort = 0

let echo: TcpServer
let echoPort = 0
let relayListenPort = 0
const echoedUp: Buffer[] = []

beforeAll(async () => {
  // TCP echo "upstream" for the tcp-forward data plane
  echo = createTcpServer((s: Socket) => {
    s.on('data', (d: Buffer) => {
      echoedUp.push(d)
      s.write(d)
    })
  })
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()))
  echoPort = (echo.address() as AddressInfo).port

  // reserve a free port for the relay's listener (released before the adapter binds)
  const reserver = createTcpServer()
  await new Promise<void>((r) => reserver.listen(0, '0.0.0.0', () => r()))
  relayListenPort = (reserver.address() as AddressInfo).port
  await new Promise<void>((r) => reserver.close(() => r()))

  // mock CYBRIX panel
  panel = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as unknown) : undefined
      seen.push({ method: req.method ?? '', url: req.url ?? '', body, auth: req.headers.authorization })
      const url = req.url ?? ''
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (url.includes('/sync')) {
        send(
          200,
          syncEnvelope({
            relays: [{ id: RELAY_ID, name: 'e2e', status: 'active', version: 1, updated_at: 1, deleted_at: null }],
            configs: [
              configFixture({
                protocol: 'tcp-forward',
                parameters: {
                  listen_port: relayListenPort,
                  destination_host: '127.0.0.1',
                  destination_port: echoPort,
                },
              }),
            ],
            users: [userFixture()],
          }),
        )
      } else if (url.includes('/heartbeat')) {
        send(200, {
          server_time: 1,
          heartbeat_interval_seconds: 60,
          should_sync: false,
          relay: { id: RELAY_ID, status: 'active', health: 'online' },
        })
      } else if (url.includes('/usage')) {
        send(200, {
          status: 'accepted',
          report_id: (body as { report_id?: string })?.report_id ?? 'x',
          ingested_at: 1,
          entries_accepted: 1,
        })
      } else {
        send(404, { error: { code: 'NOT_FOUND', message: 'nope' } })
      }
    })
  })
  await new Promise<void>((r) => panel.listen(0, '127.0.0.1', () => r()))
  panelPort = (panel.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((r) => panel.close(() => r()))
  await new Promise<void>((r) => echo.close(() => r()))
})

describe('end-to-end over real HTTP + TCP (Prompt 7 §33)', () => {
  it('boots against a real panel, runs the tcp-forward plane, reports usage, serves health', async () => {
    const { config, cleanup } = testConfig({ CYBRIX_API_URL: `http://127.0.0.1:${panelPort}` })
    // REAL fetch — full stack, no injection
    const runtime = new RelayRuntime({ config, log: quietLogger() })
    await runtime.start(false)

    // sync applied over real HTTP
    const syncCall = seen[0]!
    expect(syncCall.url).toContain(`/api/v1/relays/${RELAY_ID}/sync`)
    expect(syncCall.auth).toBe(`Bearer ${fakeToken()}`)
    expect(runtime.managerRef().configCount()).toBe(1)
    expect(runtime.state).toBe('running')

    // REAL data plane: client → relay listener → echo upstream → back
    const roundTrip = await new Promise<string>((resolve, reject) => {
      const sock = connect({ host: '127.0.0.1', port: relayListenPort }, () => sock.write('ping!'))
      let acc = ''
      sock.on('data', (d: Buffer) => {
        acc += d.toString('utf8')
        if (acc.length >= 5) {
          sock.destroy()
          resolve(acc.slice(0, 5))
        }
      })
      sock.on('error', reject)
      setTimeout(() => {
        sock.destroy()
        reject(new Error('echo round-trip timed out'))
      }, 3000).unref?.()
    })
    expect(roundTrip).toBe('ping!')
    expect(echoedUp.length).toBeGreaterThanOrEqual(1)

    // heartbeat over real HTTP — minimal fields, no secrets
    await runtime.runLoopOnce('heartbeat')
    const hb = seen.find((c) => c.url.includes('/heartbeat'))!
    expect(hb.body).toBeDefined()
    const hbBody = hb.body as Record<string, unknown>
    expect(hbBody['status']).toBe('online')
    expect(JSON.stringify(hb.body)).not.toContain(fakeToken())

    // usage over real HTTP — the counted echo bytes must land as decimal strings
    await runtime.runLoopOnce('usage')
    const usageCall = seen.find((c) => c.url.includes('/usage'))
    expect(usageCall).toBeDefined()
    const entries = (usageCall!.body as { entries: Array<{ config_id: string; bytes_up: string; user_id: string }> })
      .entries
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]!.bytes_up).toMatch(/^[0-9]+$/)
    expect(Number(entries[0]!.bytes_up)).toBeGreaterThanOrEqual(5) // 'ping!' client→upstream
    expect(entries[0]!.user_id).toBe(USER_ID)
    expect(runtime.queueRef().metrics().depth).toBe(0) // ACKed → removed

    // health endpoints (real)
    const port = runtime.healthPort()
    expect(port).not.toBeNull()
    const health = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(health.status).toBe(200)
    const local = await fetch(`http://127.0.0.1:${port}/healthz/local`)
    expect(local.status).toBe(200)
    const localBody = (await local.json()) as { state: string }
    expect(localBody.state).toBe('running')
    const notFound = await fetch(`http://127.0.0.1:${port}/management/anything`)
    expect(notFound.status).toBe(404)

    await runtime.shutdown('test')
    cleanup()
  })

  it('buffers usage during a real API outage and persists it across shutdown', async () => {
    const { config, cleanup } = testConfig({ CYBRIX_API_URL: 'http://127.0.0.1:1' }) // nothing listens
    const runtime = new RelayRuntime({
      config,
      log: quietLogger(),
      sleepImpl: async () => {},
    })
    await runtime.start(false)
    expect(['degraded', 'syncing']).toContain(runtime.state)

    // seed the config→user mapping locally (sync never arrived — API down)
    runtime.managerRef().applyDelta(
      syncEnvelope({ configs: [configFixture()], users: [userFixture()] }).data,
    )
    runtime.collectorRef().add(configFixture().id, 5n, 5n)
    await runtime.runLoopOnce('usage')
    expect(runtime.queueRef().metrics().depth).toBe(1)
    expect(runtime.queueRef().oldest()!.entries[0]!.bytes_up).toBe('5')

    await runtime.shutdown('test') // flush fails (still down) → persisted, not lost
    expect(runtime.queueRef().metrics().depth).toBe(1)
    cleanup()
  })
})
