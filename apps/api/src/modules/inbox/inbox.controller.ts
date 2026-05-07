import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { CurrentPrincipal } from '../../auth/principal.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import type { Principal } from '../../auth/types.js';
import { EditInboxDto, ListInboxQuery } from './dto.js';
import { InboxService } from './inbox.service.js';

@ApiTags('inbox')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List inbox items (review queue)' })
  list(@Query() query: ListInboxQuery) {
    return this.inbox.list({ type: query.type, status: query.status }, query.page, query.limit);
  }

  @Get(':id')
  @RequiredScope('read_only')
  findOne(@Param('id') id: string) {
    return this.inbox.findById(id);
  }

  @Post(':id/accept')
  @RequiredScope('mcp')
  @Audit({ action: 'inbox.accept', targetType: 'InboxItem', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an inbox item and apply its payload' })
  accept(@Param('id') id: string, @CurrentPrincipal() principal: Principal | undefined) {
    return this.inbox.accept(id, principal);
  }

  @Post(':id/reject')
  @RequiredScope('mcp')
  @Audit({ action: 'inbox.reject', targetType: 'InboxItem', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an inbox item without applying it' })
  reject(@Param('id') id: string, @CurrentPrincipal() principal: Principal | undefined) {
    return this.inbox.reject(id, principal);
  }

  @Post(':id/edit')
  @RequiredScope('mcp')
  @Audit({ action: 'inbox.edit_accept', targetType: 'InboxItem', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modify the inbox payload then accept it' })
  edit(
    @Param('id') id: string,
    @Body() body: EditInboxDto,
    @CurrentPrincipal() principal: Principal | undefined,
  ) {
    return this.inbox.edit(id, body.payload, principal);
  }
}
