import { claudeAvailable, claudeTest } from '@mnela/claude-runner';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { loadEnv } from '../env.js';
import { ClaudeStatusService } from './claude-status.service.js';

/**
 * Refresh `mnela:claude:status` once at orchestrator boot. Subsequent updates
 * come from POST /system/claude-test (api) or rate-limit detection in the
 * enrichment pipeline.
 */
@Injectable()
export class ClaudeStatusBoot implements OnModuleInit {
  private readonly logger = new Logger(ClaudeStatusBoot.name);

  constructor(private readonly status: ClaudeStatusService) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();

    if (env.MNELA_CLAUDE_AVAILABLE_CHECK === 'always-true') {
      await this.status.set({ available: true, checkedAt: new Date().toISOString() });
      return;
    }
    if (env.MNELA_CLAUDE_AVAILABLE_CHECK === 'always-false') {
      await this.status.set({
        available: false,
        reason: 'no-binary',
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    const present = await claudeAvailable(env.MNELA_CLAUDE_BIN);
    if (!present) {
      await this.status.set({
        available: false,
        reason: 'no-binary',
        checkedAt: new Date().toISOString(),
      });
      this.logger.warn(
        `claude binary "${env.MNELA_CLAUDE_BIN}" not found in PATH — running in dumb mode`,
      );
      return;
    }

    const probe = await claudeTest(env.MNELA_CLAUDE_BIN);
    const state: import('@mnela/queue').ClaudeStatusState = {
      available: probe.ok,
      checkedAt: new Date().toISOString(),
    };
    if (probe.version) state.version = probe.version;
    if (!probe.ok) state.reason = probe.loggedIn === false ? 'not-logged-in' : 'no-binary';
    await this.status.set(state);
  }
}
