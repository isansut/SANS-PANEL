// Port of desktop_app/core/ninjasaga/anti_detection.py
import config from '../config.js';
import * as rateControl from './rateControl.js';

export function buildAntiDetectionProfile(state) {
  const profile = config.getNinjasagaAntiDetectionProfile(state);
  return {
    action_delay_seconds: Math.max(0, rateControl.intOrDefault(profile.action_delay_seconds, 8)),
    cycle_cooldown_seconds: Math.max(0, rateControl.intOrDefault(profile.cycle_cooldown_seconds, 3)),
    rest_every_cycles: Math.max(0, rateControl.intOrDefault(profile.rest_every_cycles, 50)),
    rest_duration_seconds: Math.max(0, rateControl.intOrDefault(profile.rest_duration_seconds, 60)),
    action_jitter_seconds: Math.max(0, rateControl.intOrDefault(profile.action_jitter_seconds, 5)),
    min_call_delay_seconds: Math.max(0, rateControl.intOrDefault(profile.min_call_delay_seconds, 4)),
    start_retry_delay_seconds: Math.max(1, rateControl.intOrDefault(profile.start_retry_delay_seconds, 6)),
    start_max_retries: Math.max(1, rateControl.intOrDefault(profile.start_max_retries, 3)),
    cloudflare_rest_seconds: Math.max(1, rateControl.intOrDefault(profile.cloudflare_rest_seconds, 120)),
    cloudflare_backoff_steps_seconds: profile.cloudflare_backoff_steps_seconds || [60, 120, 240],
    cloudflare_backoff_max_seconds: Math.max(1, rateControl.intOrDefault(profile.cloudflare_backoff_max_seconds, 300)),
    failure_window_seconds: Math.max(30, rateControl.intOrDefault(profile.failure_window_seconds, 180)),
    max_failures_in_window: Math.max(1, rateControl.intOrDefault(profile.max_failures_in_window, 6)),
    circuit_cooldown_seconds: Math.max(10, rateControl.intOrDefault(profile.circuit_cooldown_seconds, 120)),
  };
}

export function nextCloudflareWait(profile, backoffIndex) {
  const maxWait = rateControl.intOrDefault(profile.cloudflare_backoff_max_seconds, 300);
  const steps = profile.cloudflare_backoff_steps_seconds || [60, 120, 240];
  let stepValues;
  try {
    stepValues = steps.map((v) => Math.max(1, Number.parseInt(v, 10)));
  } catch {
    stepValues = [60, 120, 240];
  }
  if (!stepValues.length) stepValues = [60, 120, 240];
  const idx = Math.min(Math.max(0, Number.parseInt(backoffIndex, 10) || 0), stepValues.length - 1);
  const waitSeconds = Math.min(stepValues[idx], maxWait) + rateControl.randomMarginSeconds();
  const nextIdx = Math.min(idx + 1, stepValues.length - 1);
  return [waitSeconds, nextIdx];
}

export async function registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle) {
  const now = Date.now() / 1000;
  failureTimestamps.push(now);
  const windowSeconds = Math.max(1, Number.parseInt(profile.failure_window_seconds, 10));
  const threshold = Math.max(1, Number.parseInt(profile.max_failures_in_window, 10));
  const cutoff = now - windowSeconds;
  while (failureTimestamps.length && failureTimestamps[0] < cutoff) failureTimestamps.shift();
  if (failureTimestamps.length < threshold) return true;
  const cooldownSeconds = rateControl.jitteredWaitSeconds(
    rateControl.intOrDefault(profile.circuit_cooldown_seconds, 120),
    rateControl.intOrDefault(profile.action_jitter_seconds, 5)
  );
  console.log(
    `[Cycle ${cycle}] Too many failures (${failureTimestamps.length}/${threshold}) in ${windowSeconds}s. ` +
      `Let's take a rest for ${cooldownSeconds.toFixed(0)}s...`
  );
  return rateControl.waitWithStop(cooldownSeconds);
}
