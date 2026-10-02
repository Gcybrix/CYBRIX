#!/usr/bin/env node
/**
 * CYBRIX Static Egress Verification — Prompt 7 §23/§24/§34.
 *
 * Zero-dependency probe of the relay's PUBLIC EGRESS address.
 *
 * HONESTY RULE (§24): a result of STATIC_VERIFIED may ONLY be recorded after
 * this probe has been run across cold start, restart, redeploy and scale
 * scenarios AND the observed address set has exactly one member. Documentation
 * alone NEVER counts. Until then the recorded status stays UNKNOWN.
 *
 * Usage (on the deployed relay host — e.g. `railway run` or a container shell):
 *   node scripts/verify-egress.mjs                 # single observation
 *   node scripts/verify-egress.mjs --repeat 5 --delay 30
 *
 * Output: one JSON line per observation:
 *   {"ts":"...","egress_ip":"x.x.x.x","source":"api.ipify.org","attempt":1}
 * Exit code 0 on any successful observation, 1 when none succeeded.
 */

const SOURCES = [
  { url: 'https://api.ipify.org?format=json', pick: (j) => safeParse(j)?.ip },
  { url: 'https://ifconfig.me/ip', pick: (j) => j.trim() },
  { url: 'https://checkip.amazonaws.com', pick: (j) => j.trim() },
]

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6_CANDIDATE_RE = /^[0-9a-f:]+$/i

async function observe(timeoutMs = 10_000) {
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) continue
      const body = await res.text()
      const ip = src.pick(body)
      if (typeof ip === 'string' && (IPV4_RE.test(ip) || IPV6_CANDIDATE_RE.test(ip))) {
        return { ip, source: new URL(src.url).host }
      }
    } catch {
      // try the next source
    }
  }
  return null
}

function parseArgs(argv) {
  let repeat = 1
  let delay = 30
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repeat') repeat = Math.max(1, Number(argv[++i]) || 1)
    else if (argv[i] === '--delay') delay = Math.max(1, Number(argv[++i]) || 30)
  }
  return { repeat, delay }
}

async function main() {
  const { repeat, delay } = parseArgs(process.argv)
  const observed = new Set()
  let attempt = 0
  let successes = 0

  while (attempt < repeat) {
    attempt++
    const result = await observe()
    if (result) {
      successes++
      observed.add(result.ip)
      process.stdout.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          egress_ip: result.ip,
          source: result.source,
          attempt,
        }) + '\n',
      )
    } else {
      process.stdout.write(
        JSON.stringify({ ts: new Date().toISOString(), egress_ip: null, attempt, error: 'all sources failed' }) + '\n',
      )
    }
    if (attempt < repeat) await new Promise((r) => setTimeout(r, delay * 1000))
  }

  if (successes === 0) {
    process.stdout.write(
      JSON.stringify({ hint: 'NO_OBSERVATION', recommendation: 'STATIC_EGRESS_STATUS=UNKNOWN' }) + '\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    JSON.stringify({
      hint: 'OBSERVATIONS_COMPLETE',
      distinct_ips: [...observed],
      recommendation:
        observed.size === 1 && repeat >= 3
          ? 'candidate STATIC — re-run across cold start / restart / redeploy / scale before recording STATIC_VERIFIED'
          : 'record STATIC_EGRESS_STATUS=UNKNOWN (or DYNAMIC once instability is proven)',
    }) + '\n',
  )
  process.exit(0)
}

main()
