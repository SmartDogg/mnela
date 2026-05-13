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
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import {
  CreateProjectDto,
  LinkDocumentDto,
  ListProjectsQuery,
  PreviewProjectDto,
  UpdateProjectDto,
} from './dto.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List projects (optionally filtered by status)' })
  list(@Query() query: ListProjectsQuery) {
    return this.projects.list(query.page, query.limit, query.status);
  }

  @Post()
  @RequiredScope('mcp')
  @Audit({ action: 'project.create', targetType: 'Project' })
  @ApiOperation({ summary: 'Create a project (or accept a suggestion)' })
  create(@Body() body: CreateProjectDto) {
    return this.projects.create(body);
  }

  @Post('preview')
  @RequiredScope('read_only')
  @ApiOperation({
    summary:
      'Preview candidate documents for a manual project based on name + description (no LLM, no job).',
  })
  preview(@Body() body: PreviewProjectDto) {
    return this.projects.previewCandidates(body.name, body.description ?? '', body.limit);
  }

  // ----- Suggestions surface ---------------------------------------------
  // Routes under /projects/suggestions/* come BEFORE the :slug routes so
  // NestJS doesn't try to treat 'suggestions' as a slug.
  // -----------------------------------------------------------------------

  @Get('suggestions')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List ProjectStatus=suggested rows + the gate state.' })
  async listSuggestions() {
    const [items, enabled] = await Promise.all([
      this.projects.listSuggestions(),
      this.projects.suggestionsEnabled(),
    ]);
    return { items, enabled };
  }

  @Post('suggestions/rescan')
  @RequiredScope('mcp')
  @Audit({ action: 'project.suggestions.rescan', targetType: 'Project' })
  @ApiOperation({
    summary:
      'Kick a full corpus rescan to refresh suggestions. Returns enabled=false if the gate is off.',
  })
  rescan() {
    return this.projects.enqueueRescan();
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

  @Post(':slug/dismiss')
  @RequiredScope('mcp')
  @Audit({ action: 'project.dismiss', targetType: 'Project', targetIdParam: 'slug' })
  @ApiOperation({
    summary: 'Dismiss a suggested project (status → dismissed, drops suggested links)',
  })
  dismiss(@Param('slug') slug: string) {
    return this.projects.dismiss(slug);
  }

  @Post(':slug/documents')
  @RequiredScope('mcp')
  @Audit({ action: 'project.link_document', targetType: 'Project', targetIdParam: 'slug' })
  @ApiOperation({ summary: 'Link a document to a project (linkSource=manual).' })
  linkDocument(@Param('slug') slug: string, @Body() body: LinkDocumentDto) {
    return this.projects.linkDocument(slug, body.documentId, 'manual');
  }

  @Delete(':slug/documents/:documentId')
  @RequiredScope('mcp')
  @Audit({ action: 'project.unlink_document', targetType: 'Project', targetIdParam: 'slug' })
  unlinkDocument(@Param('slug') slug: string, @Param('documentId') documentId: string) {
    return this.projects.unlinkDocument(slug, documentId);
  }

  @Get(':slug/context')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Return the auto-generated project context.md' })
  context(@Param('slug') slug: string) {
    return this.projects.getContext(slug);
  }

  @Get(':slug/entities')
  @RequiredScope('read_only')
  @ApiOperation({
    summary:
      'Top entities co-occurring in documents tagged to this project, ordered by document count',
  })
  topEntities(@Param('slug') slug: string) {
    return this.projects.listTopEntities(slug);
  }

  @Get(':slug/open-questions')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Open questions captured in Project.metadata.openQuestions' })
  openQuestions(@Param('slug') slug: string) {
    return this.projects.listOpenQuestions(slug);
  }

  @Post(':slug/refresh-context')
  @RequiredScope('mcp')
  @Audit({ action: 'project.refresh_context', targetType: 'Project', targetIdParam: 'slug' })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Enqueue a refresh of context.md via Claude Code (gated by mnela:claude:status). Returns 503 in Dumb Mode.',
  })
  refreshContext(@Param('slug') slug: string) {
    return this.projects.refreshContext(slug);
  }
}
