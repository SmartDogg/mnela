import { Module } from '@nestjs/common';

import { BotService } from './bot.service.js';
import { AskRelayService } from './handlers/ask-relay.service.js';
import { CommandsService } from './handlers/commands.service.js';
import { HANDLERS_FACTORY } from './handlers/handlers.token.js';
import { MediaRouterService } from './handlers/media-router.service.js';
import { ReactionsService } from './handlers/reactions.service.js';
import { RealHandlersFactory } from './handlers/real-handlers.factory.js';
import { TurnBufferService } from './handlers/turn-buffer.service.js';
import { WhitelistMiddleware } from './handlers/whitelist.middleware.js';
import { ReloadService } from './reload.service.js';

@Module({
  providers: [
    BotService,
    ReloadService,
    // handler graph
    WhitelistMiddleware,
    ReactionsService,
    TurnBufferService,
    MediaRouterService,
    AskRelayService,
    CommandsService,
    RealHandlersFactory,
    {
      provide: HANDLERS_FACTORY,
      useExisting: RealHandlersFactory,
    },
  ],
  exports: [BotService],
})
export class BotModule {}
