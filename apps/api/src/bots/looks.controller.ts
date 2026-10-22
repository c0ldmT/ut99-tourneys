import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/http.js';
import { LookPreviewService } from './look-preview.service.js';

const LookQuery = z.object({
  cls: z.string().max(128).default(''),
  skin: z.string().max(128).default(''),
  face: z.string().max(128).default(''),
  team: z.coerce.number().int().min(0).max(3).optional(),
});
const MeshQuery = z.object({
  cls: z.string().max(128).default(''),
  v: z.string().max(64).optional(),
});

/**
 * 3D look previews for the look editors (everybody logged in, decision 176). Meshes and textures
 * are asked with the installation stamp (`v`): such answers never change and may be cached.
 */
@Controller('looks')
export class LooksController {
  constructor(@Inject(LookPreviewService) private readonly previews: LookPreviewService) {}

  /** The textures a look puts on the model's skin slots (and the stamp to ask the parts with). */
  @Get('preview')
  preview(@Query(new ZodPipe(LookQuery)) q: z.output<typeof LookQuery>) {
    return this.previews.look(q.cls, q.skin, q.face, q.team ?? null);
  }

  @Get('mesh')
  async mesh(
    @Query(new ZodPipe(MeshQuery)) q: z.output<typeof MeshQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stamp, mesh } = await this.previews.mesh(q.cls);
    cache(res, q.v === stamp);
    return mesh;
  }

  @Get('texture/:name')
  async texture(
    @Param(
      'name',
      new ZodPipe(
        z
          .string()
          .regex(/^\w+\.[\w.]+$/)
          .max(128),
      ),
    )
    name: string,
    @Query('v') v: string | undefined,
    @Res() res: Response,
  ) {
    const { stamp, png } = await this.previews.texture(name, v);
    cache(res, v === stamp);
    res.setHeader('Content-Type', 'image/png');
    res.end(png);
  }
}

function cache(res: Response, immutable: boolean) {
  res.setHeader(
    'Cache-Control',
    immutable ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  );
}
