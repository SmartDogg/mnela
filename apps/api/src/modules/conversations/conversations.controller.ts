import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { CurrentPrincipal } from '../../auth/principal.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import type { Principal } from '../../auth/types.js';
import { ConversationsService } from './conversations.service.js';
import { ListConversationsQuery, PatchConversationDto } from './dto.js';

@ApiTags('conversations')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List Ask Brain conversations (by updatedAt desc)' })
  async list(
    @Query() query: ListConversationsQuery,
    @CurrentPrincipal() principal: Principal | undefined,
  ) {
    const adminUserId = await this.conversations.resolveAdminUserId(principal);
    return this.conversations.list(adminUserId, query.page, query.limit);
  }

  @Get(':id')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Get a conversation with its full message list' })
  async findOne(@Param('id') id: string, @CurrentPrincipal() principal: Principal | undefined) {
    const adminUserId = await this.conversations.resolveAdminUserId(principal);
    return this.conversations.findById(id, adminUserId);
  }

  @Patch(':id')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'conversation.update', targetType: 'Conversation', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Rename a conversation' })
  async patch(
    @Param('id') id: string,
    @Body() body: PatchConversationDto,
    @CurrentPrincipal() principal: Principal | undefined,
  ) {
    const adminUserId = await this.conversations.resolveAdminUserId(principal);
    return this.conversations.rename(id, body.title, adminUserId);
  }

  @Delete(':id')
  @RequiredScope('admin')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'conversation.delete', targetType: 'Conversation', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Delete a conversation and all its messages' })
  async remove(@Param('id') id: string, @CurrentPrincipal() principal: Principal | undefined) {
    const adminUserId = await this.conversations.resolveAdminUserId(principal);
    return this.conversations.delete(id, adminUserId);
  }
}
