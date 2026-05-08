import { type Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { type MnelaEvent, PUBSUB_CHANNEL, publishEvent, subscribeEvents } from '../events.js';

describe('events', () => {
  it('publishes JSON to PUBSUB_CHANNEL', async () => {
    const publish = vi.fn(async () => 1);
    const redis = { publish } as unknown as Redis;
    const evt: MnelaEvent = {
      type: 'job.progress',
      payload: { jobId: 'j1', progress: 42, message: 'parsing' },
    };
    await publishEvent(redis, evt);
    expect(publish).toHaveBeenCalledWith(PUBSUB_CHANNEL, JSON.stringify(evt));
  });

  it('subscribeEvents parses messages and ignores foreign channels and bad payloads', async () => {
    const handlers: Record<string, (channel: string, raw: string) => void> = {};
    const subscribe = vi.fn(async () => undefined);
    const on = vi.fn((evt: string, cb: (channel: string, raw: string) => void) => {
      handlers[evt] = cb;
    });
    const redis = { subscribe, on } as unknown as Redis;

    const seen: MnelaEvent[] = [];
    await subscribeEvents(redis, (e) => seen.push(e));

    expect(subscribe).toHaveBeenCalledWith(PUBSUB_CHANNEL);
    const message = handlers['message'];
    if (!message) throw new Error("no 'message' handler registered");

    message(
      PUBSUB_CHANNEL,
      JSON.stringify({ type: 'job.completed', payload: { jobId: 'x', completedAt: 'now' } }),
    );
    message(
      'other:channel',
      JSON.stringify({ type: 'job.progress', payload: { jobId: 'y', progress: 10 } }),
    );
    message(PUBSUB_CHANNEL, '{not json');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe('job.completed');
  });
});
