import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/http.js';
import { AdminOnly, CurrentUser, ModOnly } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ModerationSettingsSchema } from '../settings/settings.service.js';
import { MOD_KINDS, ModerationService } from './moderation.service.js';

const ReportBody = z.object({
  kind: z.enum(MOD_KINDS),
  ref: z.string().min(1).max(120),
  reason: z.string().trim().min(1).max(300),
});
const DecideBody = z.object({ action: z.enum(['ok', 'reset']) });
const EditBody = z.object({
  text: z.string().max(300).optional(),
  name: z.string().max(60).optional(),
  tag: z.string().max(30).optional(),
  lines: z.array(z.string().max(300)).max(64).optional(),
});
const SanctionBody = z.object({
  action: z.enum(['warn', 'text-ban', 'ban', 'unban']),
  /** Text ban: days (needed); login ban: days, 0 = for good. */
  days: z.number().int().min(0).max(3650).default(0),
  reason: z.string().trim().max(300).default(''),
});

/** Moderation (decision 283): reports by every player, the rest for moderators and admins. */
@Controller('moderation')
export class ModerationController {
  constructor(@Inject(ModerationService) private readonly mod: ModerationService) {}

  /** A player reports a name, team, bot name, chat lines or a trade message. */
  @Post('reports')
  @HttpCode(204)
  report(@CurrentUser() user: User, @Body(new ZodPipe(ReportBody)) b: z.infer<typeof ReportBody>) {
    this.mod.report(user, b.kind, b.ref, b.reason);
  }

  @ModOnly()
  @Get('queue')
  queue(@Query('status') status?: string) {
    return this.mod.queue(status === 'done' ? 'done' : 'open');
  }

  @ModOnly()
  @Get('count')
  count() {
    return { open: this.mod.openCount() };
  }

  @ModOnly()
  @Post('items/:id')
  @HttpCode(204)
  decide(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(DecideBody)) b: z.infer<typeof DecideBody>,
  ) {
    this.mod.decide(user, id, b.action);
  }

  /** Admins correct a text by hand (decision 287). */
  @AdminOnly()
  @Post('items/:id/edit')
  @HttpCode(204)
  edit(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(EditBody)) b: z.infer<typeof EditBody>,
  ) {
    this.mod.edit(user, id, b);
  }

  @ModOnly()
  @Post('users/:id')
  @HttpCode(200)
  sanction(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(SanctionBody)) b: z.infer<typeof SanctionBody>,
  ) {
    const u = this.mod.sanction(user, id, b.action, b.days, b.reason);
    return {
      id: u.id,
      warnings: u.warnings,
      textBanUntil: u.textBanUntil,
      bannedUntil: u.bannedUntil,
    };
  }

  @ModOnly()
  @Get('settings')
  settings() {
    return this.mod.settingsView();
  }

  @ModOnly()
  @Put('settings')
  setSettings(
    @CurrentUser() user: User,
    @Body(new ZodPipe(ModerationSettingsSchema.partial()))
    b: Partial<z.infer<typeof ModerationSettingsSchema>>,
  ) {
    return this.mod.setLists(user, b);
  }

  /** Checks every existing text against the lists; hits go into the queue. */
  @ModOnly()
  @Post('scan')
  @HttpCode(200)
  scan(@CurrentUser() user: User) {
    return this.mod.scan(user);
  }

  @ModOnly()
  @Get('log')
  log() {
    return this.mod.auditLog();
  }
}
