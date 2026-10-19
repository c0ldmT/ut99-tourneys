import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import {
  BuyBody,
  DedicationSchema,
  EquipBody,
  ShopService,
  type Dedication,
} from './shop.service.js';

const ReviewBody = z.object({ approve: z.boolean() });

/** The Neuro shop: cosmetics paid with Neuro; the looks everybody wears. */
@Controller('shop')
export class ShopController {
  constructor(@Inject(ShopService) private readonly shop: ShopService) {}

  @Get()
  view(@CurrentUser() user: User) {
    return this.shop.view(user);
  }

  /** Every user's look (names on the website are drawn with it). */
  @Get('looks')
  looks() {
    return this.shop.looks();
  }

  @Post('buy')
  @HttpCode(200)
  buy(@CurrentUser() user: User, @Body(new ZodPipe(BuyBody)) body: z.infer<typeof BuyBody>) {
    return this.shop.buy(user, body);
  }

  @Put('look')
  equip(@CurrentUser() user: User, @Body(new ZodPipe(EquipBody)) body: z.infer<typeof EquipBody>) {
    return this.shop.equip(user, body);
  }

  @Put('dedication')
  dedication(@CurrentUser() user: User, @Body(new ZodPipe(DedicationSchema)) body: Dedication) {
    return this.shop.changeDedication(user, body);
  }

  @AdminOnly()
  @Get('admin')
  admin() {
    return { catalog: this.shop.catalog(true), log: this.shop.log() };
  }

  @AdminOnly()
  @Post('admin/dedications/:id')
  @HttpCode(200)
  review(@Param('id') id: string, @Body(new ZodPipe(ReviewBody)) body: z.infer<typeof ReviewBody>) {
    return this.shop.review(id, body.approve);
  }
}
