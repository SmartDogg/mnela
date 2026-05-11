import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module.js';
import { AskService } from './ask.service.js';
import { SaveSynthesisService } from './save-synthesis.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [ConversationsModule],
  controllers: [SearchController],
  providers: [SearchService, AskService, SaveSynthesisService],
})
export class SearchModule {}
