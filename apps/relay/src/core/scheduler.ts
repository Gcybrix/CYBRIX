/**
 * Interval trigger — non-overlapping timer with failure backoff + jitter.
 * Used for the heartbeat / sync / usage loops (Prompt 7 §14/§8/§16).
 *
 * - setTimeout chains (never setInterval) → a slow tick can never stack.
 * - on rejection: next fire backs off exponentially (bounded); on success it
 *   resets. This is the loop-level complement to the client's per-request
 *   retry policy (Prompt 7 §18).
 * - timers are unref()'d so tests and shutdown are never held hostage.
 */

export interface IntervalTriggerOptions {
  intervalMs: number
  /** multiplier growth per consecutive failure */
  backoffMultiplier?: number
  maxBackoffMs?: number
  /** ± this ratio of the interval, applied once per scheduling (anti-thundering-herd) */
  jitterRatio?: number
  onError?: (err: unknown) => void
  onSuccess?: () => void
}

export class IntervalTrigger {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private failures = 0
  private stopped = false

  constructor(
    private readonly name: string,
    private readonly fn: () => Promise<void>,
    private readonly opts: IntervalTriggerOptions,
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  start(immediate = false): void {
    if (this.stopped || this.timer !== null) return
    if (immediate) {
      void this.tick()
    } else {
      this.schedule(this.opts.intervalMs)
    }
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Fire as soon as possible (coalesced while a tick is in flight). */
  triggerNow(): void {
    if (this.stopped || this.running) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.schedule(1)
  }

  /** Adopt a server-suggested interval (e.g. heartbeat_interval_seconds). */
  updateInterval(intervalMs: number): void {
    if (intervalMs >= 1000) this.opts.intervalMs = intervalMs
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    const jitter =
      this.opts.jitterRatio && this.opts.jitterRatio > 0
        ? Math.floor(delayMs * this.opts.jitterRatio * (Math.random() * 2 - 1))
        : 0
    const delay = Math.max(1, delayMs + jitter)
    this.timer = setTimeout(() => void this.tick(), delay)
    this.timer.unref?.()
  }

  private async tick(): Promise<void> {
    if (this.stopped) return
    this.timer = null
    if (this.running) return
    this.running = true
    try {
      await this.fn()
      this.failures = 0
      this.opts.onSuccess?.()
      if (!this.stopped) this.schedule(this.opts.intervalMs)
    } catch (err) {
      this.failures++
      this.opts.onError?.(err)
      const mult = this.opts.backoffMultiplier ?? 2
      const max = this.opts.maxBackoffMs ?? this.opts.intervalMs * 30
      const next = Math.min(this.opts.intervalMs * Math.pow(mult, this.failures), max)
      if (!this.stopped) this.schedule(next)
    } finally {
      this.running = false
    }
  }
}
