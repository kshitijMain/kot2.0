import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  MENU_FILE_CONTENT_TYPE,
  MENU_FILE_EMPTY_NAME,
  MenuFileChoices,
  type MenuFileImportResult,
  MenuFileParams,
  type MenuFileReview,
  type MenuImportReport,
} from '@rp/contracts';
import type { Response } from 'express';
import { authErrors } from '../../auth/auth-errors.js';
import { RequireCapability } from '../../auth/decorators.js';
import type { AuthenticatedRequest, Principal } from '../../auth/principal.js';
import { AppError } from '../../errors/app-error.js';
import { ZodValidationPipe } from '../../validation/zod-validation.pipe.js';
import { MenuFileService } from './menu-file.service.js';

function principalOf(request: AuthenticatedRequest): Principal {
  if (request.principal === undefined) throw authErrors.unauthenticated();
  return request.principal;
}

const params = new ZodValidationPipe(MenuFileParams);
const choices = new ZodValidationPipe(MenuFileChoices);

function sendZip(response: Response, name: string, content: Buffer): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.attachment(name);
  response.type(MENU_FILE_CONTENT_TYPE);
  response.status(200).send(content);
}

/**
 * The menu file (ONB-005, ONB-007): download it empty, export the menu as one, load one (the
 * body is the file itself, read by the raw parser for this path only), check it with the
 * manager's choices and add it to the draft.
 */
@Controller('menu/files')
@RequireCapability('MENU_MANAGE')
export class MenuFileController {
  constructor(private readonly files: MenuFileService) {}

  @Get('empty')
  async empty(@Res() response: Response): Promise<void> {
    sendZip(response, MENU_FILE_EMPTY_NAME, await this.files.emptyFile());
  }

  @Get('export')
  async export(@Req() request: AuthenticatedRequest, @Res() response: Response): Promise<void> {
    sendZip(response, 'menu-export.zip', await this.files.exportFile(principalOf(request)));
  }

  @Post()
  @HttpCode(201)
  load(@Req() request: AuthenticatedRequest): Promise<MenuFileReview> {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(
        422,
        'MENU_FILE_REFUSED',
        'Choose the menu file (.zip) or a menu.xlsx to load.',
      );
    }
    return this.files.load(principalOf(request), body);
  }

  @Post(':fileId/check')
  @HttpCode(200)
  check(
    @Req() request: AuthenticatedRequest,
    @Param(params) { fileId }: MenuFileParams,
    @Body(choices) payload: MenuFileChoices,
  ): Promise<MenuImportReport> {
    return this.files.check(principalOf(request), fileId, payload);
  }

  @Post(':fileId/import')
  @HttpCode(200)
  import(
    @Req() request: AuthenticatedRequest,
    @Param(params) { fileId }: MenuFileParams,
    @Body(choices) payload: MenuFileChoices,
  ): Promise<MenuFileImportResult> {
    return this.files.import(principalOf(request), fileId, payload);
  }
}
