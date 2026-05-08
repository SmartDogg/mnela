import { claudeAvailable, claudeTest, type ClaudeTestResult } from '@mnela/claude-runner';
import {
  type ClaudeStatusState,
  publishEvent,
  readClaudeStatus,
  writeClaudeStatus,
} from '@mnela/queue';
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../redis.service.js';

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);

  constructor(private readonly redis: RedisService) {}

  async getStatus(): Promise<ClaudeStatusState> {
    return readClaudeStatus(this.redis.client);
  }

  async runTest(): Promise<{ ok: boolean; version?: string; error?: string; latencyMs: number }> {
    const bin = process.env['MNELA_CLAUDE_BIN'] ?? 'claude';
    const present = await claudeAvailable(bin);
    if (!present) {
      const state: ClaudeStatusState = {
        available: false,
        reason: 'no-binary',
        checkedAt: new Date().toISOString(),
      };
      await this.persist(state);
      return { ok: false, error: 'claude binary not found in PATH', latencyMs: 0 };
    }

    const result: ClaudeTestResult = await claudeTest(bin);
    const state: ClaudeStatusState = {
      available: result.ok,
      checkedAt: new Date().toISOString(),
    };
    if (result.version) state.version = result.version;
    if (!result.ok) state.reason = result.loggedIn === false ? 'not-logged-in' : 'no-binary';
    await this.persist(state);

    const out: { ok: boolean; version?: string; error?: string; latencyMs: number } = {
      ok: result.ok,
      latencyMs: result.latencyMs,
    };
    if (result.version) out.version = result.version;
    if (result.error) out.error = result.error;
    return out;
  }

  private async persist(state: ClaudeStatusState): Promise<void> {
    await writeClaudeStatus(this.redis.client, state);
    const payload: { available: boolean; reason?: string } = { available: state.available };
    if (state.reason) payload.reason = state.reason;
    await publishEvent(this.redis.client, {
      type: 'system.claude_status_changed',
      payload,
    });
    this.logger.log(
      `claude-test → ${state.available ? 'available' : `unavailable (${state.reason ?? 'unknown'})`}`,
    );
  }
}
