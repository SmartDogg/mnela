import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { loadEnv, mcpConfigPath, vaultDir } from '../env.js';

/**
 * Ensures the MCP config Claude receives via `--mcp-config` actually exists
 * with paths and env values matching THIS install. Without this, dev runs
 * end at `claude -p ... → exit 1 → "MCP config file not found"` because the
 * template at `infra/claude/claude-mcp-config.json` was written for the
 * production install path (/opt/mnela/...) and never copied at boot.
 *
 * Strategy: every boot, write a freshly-rendered config to
 * `${MNELA_DATA_DIR}/claude/claude-mcp-config.json`. Idempotent and cheap;
 * we re-write it each time so a dev rebuilding the orchestrator at a new
 * path doesn't end up pointing Claude at a stale dist directory.
 *
 * Also creates the vault directory referenced via `--add-dir` so Claude
 * doesn't error on a missing path.
 */
@Injectable()
export class McpConfigBoot implements OnModuleInit {
  private readonly logger = new Logger(McpConfigBoot.name);

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    if (env.MNELA_CLAUDE_AVAILABLE_CHECK === 'always-false') {
      // Dumb-Mode tests / installs that explicitly disable Claude — nothing
      // to write because no subprocess will read the file.
      return;
    }

    const configPath = mcpConfigPath(env);
    const configDir = path.dirname(configPath);
    const vault = vaultDir(env);
    const stdioHostPath = resolveStdioHostPath();

    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(vault, { recursive: true });

    const config = {
      mcpServers: {
        mnela: {
          command: process.execPath,
          args: [stdioHostPath],
          env: {
            DATABASE_URL: env.DATABASE_URL,
            REDIS_URL: env.REDIS_URL,
            MNELA_LOG_LEVEL: env.MNELA_LOG_LEVEL,
            MNELA_DATA_DIR: env.MNELA_DATA_DIR,
          },
        },
      },
    };

    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    this.logger.log(`mcp config written: ${configPath}`);
  }
}

/**
 * Locate the compiled stdio-host entry. Works for both:
 *   - running compiled JS (apps/orchestrator/dist/...) — file is sibling.
 *   - running source via tsx watch (apps/orchestrator/src/...) — the
 *     compiled dist sibling is the canonical Node-runnable artefact, so we
 *     prefer it when it exists.
 */
function resolveStdioHostPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distSibling = path.resolve(here, 'stdio-host.js');
  return distSibling;
}
