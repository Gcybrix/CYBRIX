/**
 * CYBRIX Relay entrypoint (Prompt 7).
 *
 * - fail-fast boot on config errors (no secrets in messages)
 * - SIGTERM/SIGINT → graceful shutdown (flush usage, persist state)
 * - SIGHUP → token hot-reload from RELAY_TOKEN_FILE (rotation without rebuild)
 * - uncaught errors are logged (redacted) but never crash the loops
 */

import { loadConfig } from './config'
import { Logger } from './log'
import { redactErrorMessage } from './security/redact'
import { RelayRuntime } from './runtime'

async function main(): Promise<void> {
  const config = loadConfig()
  const log = new Logger(config.logLevel, { component: 'relay', relay_id: config.relayId })
  const runtime = new RelayRuntime({ config, log })

  let shuttingDown = false
  const initiateShutdown = (signal: string): void => {
    if (shuttingDown) {
      // second signal → operator really wants out
      process.exit(1)
    }
    shuttingDown = true
    void runtime
      .shutdown(signal)
      .then((code) => process.exit(code))
      .catch(() => process.exit(1))
  }

  process.on('SIGTERM', () => initiateShutdown('SIGTERM'))
  process.on('SIGINT', () => initiateShutdown('SIGINT'))
  if (config.tokenFilePath) {
    process.on('SIGHUP', () => runtime.reloadToken())
  }
  process.on('uncaughtException', (err) => {
    log.error('process.uncaught_exception', { detail: redactErrorMessage(err) })
  })
  process.on('unhandledRejection', (reason) => {
    log.error('process.unhandled_rejection', { detail: redactErrorMessage(reason) })
  })

  await runtime.start(true)
}

main().catch((err: unknown) => {
  // boot failed BEFORE the logger existed — emit one safe structured line
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      component: 'relay',
      event: 'boot.failed',
      detail: redactErrorMessage(err instanceof Error ? err.message : err),
    }) + '\n',
  )
  process.exit(1)
})
