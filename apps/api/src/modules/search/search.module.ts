import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SystemModule } from '../system/system.module.js';
import { AskAttachmentsService } from './ask-attachments.service.js';
import { AskService } from './ask.service.js';
import { SaveSynthesisService } from './save-synthesis.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [ConversationsModule, ProvidersModule, SystemModule],
  controllers: [SearchController],
  providers: [SearchService, AskService, SaveSynthesisService, AskAttachmentsService],
})
export class SearchModule {}
