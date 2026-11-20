import { Body, Controller, Get, HttpCode, Inject, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { FeedbackService } from './feedback.service.js';
import {
  NoteBody,
  SurveyBody,
  SurveySwitchBody,
  type NoteInput,
  type SurveyInput,
} from './survey.js';

/** Feedback of the players: the season survey and notes (decision 245). */
@Controller('feedback')
export class FeedbackController {
  constructor(@Inject(FeedbackService) private readonly feedback: FeedbackService) {}

  /** The open survey for the user (questions, whether they take part, their answer). */
  @Get('survey')
  survey(@CurrentUser() user: User) {
    return this.feedback.survey(user);
  }

  @Post('survey')
  @HttpCode(200)
  answer(@CurrentUser() user: User, @Body(new ZodPipe(SurveyBody)) body: SurveyInput) {
    return this.feedback.answer(user, body);
  }

  @Post('notes')
  @HttpCode(201)
  note(@CurrentUser() user: User, @Body(new ZodPipe(NoteBody)) body: NoteInput) {
    return this.feedback.note(user, body);
  }

  @AdminOnly()
  @Get('admin')
  admin() {
    return this.feedback.admin();
  }

  /** Opens the survey of the running (or last) season, or closes it. */
  @AdminOnly()
  @Put('survey')
  setSurvey(@Body(new ZodPipe(SurveySwitchBody)) body: z.infer<typeof SurveySwitchBody>) {
    return this.feedback.setSurvey(body.open);
  }

  /** Answers and notes without names (CSV in the settings, the export CLI). */
  @AdminOnly()
  @Get('export')
  export(@Query('season') season?: string) {
    return this.feedback.export(Number(season) || undefined);
  }
}
