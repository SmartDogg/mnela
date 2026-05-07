import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List projects' })
  list(@Query() query: ListProjectsQuery) {
    return this.projects.list(query.page, query.limit);
  }

  @Post()
  @RequiredScope('mcp')
  @Audit({ action: 'project.create', targetType: 'Project' })
  @ApiOperation({ summary: 'Create a project' })
  create(@Body() body: CreateProjectDto) {
    return this.projects.create(body);
  }

  @Get(':slug')
  @RequiredScope('read_only')
  findOne(@Param('slug') slug: string) {
    return this.projects.findBySlug(slug);
  }

  @Patch(':slug')
  @RequiredScope('mcp')
  @Audit({ action: 'project.update', targetType: 'Project', targetIdParam: 'slug' })
  update(@Param('slug') slug: string, @Body() body: UpdateProjectDto) {
    return this.projects.update(slug, body);
  }

  @Delete(':slug')
  @RequiredScope('admin')
  @Audit({ action: 'project.delete', targetType: 'Project', targetIdParam: 'slug' })
  @HttpCode(HttpStatus.OK)
  delete(@Param('slug') slug: string) {
    return this.projects.delete(slug);
  }

  @Get(':slug/context')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Return the auto-generated project context.md' })
  context(@Param('slug') slug: string) {
    return this.projects.getContext(slug);
  }

  @Post(':slug/refresh-context')
  @RequiredScope('mcp')
  @ApiOperation({ summary: 'Re-generate context.md via Claude Code (Phase 5; unavailable)' })
  refreshContext(@Param('slug') _slug: string): never {
    throw new ServiceUnavailableException({
      title: 'AI Smart Mode disabled',
      message: 'Project context refresh requires Claude Code (Phase 5)',
    });
  }
}
