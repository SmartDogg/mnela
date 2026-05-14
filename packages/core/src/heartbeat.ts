/**
 * Touch `/tmp/mnela-heartbeat` every 30 s so the docker `healthcheck:`
 * for headless services (worker / orchestrator / tg-bot) can tell us
 * whether the event loop is still pumping. mtime > 90 s old = wedged.
 *
 * No-op on Windows / dev (file write would still work but the file is
 * meaningless without the docker healthcheck reading it; cheap enough
 * to keep on regardless).
 *
 * Call `startHeartbeat()` after the NestJS application context boots.
 * Returns a stop function for clean shutdown.
 */

import { writeFile } from 'node:fs/promises';

const HEARTBEAT_PATH = process.env['MNELA_HEARTBEAT_PATH'] ?? '/tmp/mnela-heartbeat';
const HEARTBEAT_INTERVAL_MS = 30_000;

export function startHeartbeat(): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    try {
      await writeFile(HEARTBEAT_PATH, String(Date.now()), 'utf8');
    } catch {
      // /tmp may not exist on Windows; ignore — the healthcheck only
      // runs inside the Linux container.
    }
  };
  void tick();
  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, HEARTBEAT_INTERVAL_MS);
  // Unref so the timer doesn't keep the process alive on SIGTERM.
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
