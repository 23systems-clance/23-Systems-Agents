/**
 * Simple circuit breaker for wrapping external API calls (T068).
 *
 * Tracks consecutive failures and opens the circuit when a configurable
 * threshold is reached.  While open, calls are rejected immediately without
 * hitting the upstream service.  After a reset timeout the circuit moves to
 * half-open, allowing a single probe request through.  A successful probe
 * closes the circuit; a failed probe re-opens it.
 *
 * Usage:
 * ```ts
 * const cb = new CircuitBreaker({ name: 'BuiltWith', failureThreshold: 5, resetTimeoutMs: 60_000 });
 * const result = await cb.execute(() => lookupDomain('example.com'));
 * ```
 */

import logger from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration options for a {@link CircuitBreaker} instance. */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from open to half-open. */
  resetTimeoutMs: number;
  /** Human-readable identifier used in log messages. */
  name: string;
}

/** Possible states of a circuit breaker. */
type CircuitState = 'closed' | 'open' | 'half-open';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * A lightweight circuit breaker that prevents cascading failures when an
 * external API is unavailable or degraded.
 *
 * State machine:
 *   closed  --[failure threshold reached]--> open
 *   open    --[reset timeout elapsed]------> half-open
 *   half-open --[success]-------------------> closed
 *   half-open --[failure]-------------------> open
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: CircuitState = 'closed';
  private readonly options: CircuitBreakerOptions;

  /**
   * Creates a new CircuitBreaker.
   *
   * @param options - Configuration for failure threshold, reset timeout, and name.
   */
  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  /**
   * Executes an async function through the circuit breaker.
   *
   * - If the circuit is **closed** or **half-open**, the function is invoked.
   * - If the circuit is **open** and the reset timeout has not elapsed, an
   *   error is thrown immediately.
   * - If the circuit is **open** but the reset timeout has elapsed, the
   *   circuit transitions to half-open and the function is invoked as a probe.
   *
   * @typeParam T - Return type of the wrapped function.
   * @param fn - The async operation to execute.
   * @returns The result of `fn`.
   * @throws When the circuit is open, or when `fn` itself throws.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeoutMs) {
        this.state = 'half-open';
        logger.info(`Circuit breaker '${this.options.name}' transitioning to half-open`);
      } else {
        throw new Error(`Circuit breaker '${this.options.name}' is open`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Returns the current state of the circuit breaker.
   *
   * @returns One of 'closed', 'open', or 'half-open'.
   */
  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Returns the current consecutive failure count.
   *
   * @returns Number of consecutive failures recorded.
   */
  get failureCount(): number {
    return this.failures;
  }

  /**
   * Resets the circuit breaker to its initial closed state.
   * Useful for testing or manual recovery.
   */
  reset(): void {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
    logger.info(`Circuit breaker '${this.options.name}' manually reset`);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Handles a successful call by resetting failures and closing the circuit.
   */
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /**
   * Handles a failed call by incrementing the failure counter and
   * potentially opening the circuit.
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
      logger.warn(`Circuit breaker '${this.options.name}' opened`, {
        failures: this.failures,
        threshold: this.options.failureThreshold,
      });
    }
  }
}
