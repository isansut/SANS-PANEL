// Port of desktop_app/core/ninjasaga/rate_control.py
import config from '../config.js';

export const DEFAULT_STOP_POLL_SECONDS = 0.2;

// Built-in random safety margin (seconds).
// Deliberately NOT exposed in the panel settings: even when the configured jitter
// is set to 0, every real wait keeps an unpredictable extra margin, so request
// timings never look perfectly mechanical to the server.
export const BUILTIN_MARGIN_MIN_SECONDS = 0.4;
export const BUILTIN_MARGIN_MAX_SECONDS = 3.0;

export function randomMarginSeconds() {
  const span = Math.max(0, BUILTIN_MARGIN_MAX_SECONDS - BUILTIN_MARGIN_MIN_SECONDS);
  return BUILTIN_MARGIN_MIN_SECONDS + Math.random() * span;
}

export function stopRequested() {
  const stopEvent = config.stopEvent;
  return !!(stopEvent && stopEvent.isSet && stopEvent.isSet());
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitWithStop(seconds, pollSeconds = DEFAULT_STOP_POLL_SECONDS) {
  let remaining = Number(seconds || 0);
  while (remaining > 0) {
    if (stopRequested()) return false;
    const slice = Math.min(Number(pollSeconds), remaining);
    await sleep(slice * 1000);
    remaining -= slice;
  }
  return !stopRequested();
}

export function jitteredWaitSeconds(baseSeconds, jitterSeconds) {
  const base = Math.max(0, Number(baseSeconds || 0));
  const jitter = Math.max(0, Number(jitterSeconds || 0));
  // Honor an explicit "no wait" (both 0); otherwise always add the built-in margin.
  if (base <= 0 && jitter <= 0) return 0;
  return base + Math.random() * jitter + randomMarginSeconds();
}

export async function waitMinCallInterval(lastCallAt, minCallDelaySeconds, actionJitterSeconds, pollSeconds = DEFAULT_STOP_POLL_SECONDS) {
  if (lastCallAt === null || lastCallAt === undefined) return [true, Date.now() / 1000];
  const waitTarget = jitteredWaitSeconds(minCallDelaySeconds, actionJitterSeconds);
  const elapsed = Math.max(0, Date.now() / 1000 - lastCallAt);
  const waitSeconds = Math.max(0, waitTarget - elapsed);
  if (waitSeconds <= 0) return [true, Date.now() / 1000];
  const ok = await waitWithStop(waitSeconds, pollSeconds);
  if (!ok) return [false, lastCallAt];
  return [true, Date.now() / 1000];
}

export function intOrDefault(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number(defaultValue) : parsed;
}
