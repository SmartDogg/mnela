import type { Bot } from 'grammy';

import type { ResolvedConfig } from '../../config/config.service.js';

/**
 * Pluggable bot handlers. The BotService bootstraps and lifecycles the
 * grammY Bot; the factory implementation wires the command/middleware
 * handlers (`/save`, `/scope`, `/last`, text/voice/photo routers, etc.)
 * onto the bot AFTER the lifecycle is established but BEFORE polling
 * starts.
 *
 * Split out so tasks #5–#7 of ADR-0053 can land their handlers without
 * touching the lifecycle service.
 */
export interface BotHandlersFactory {
  register(bot: Bot, config: ResolvedConfig): void;
}
