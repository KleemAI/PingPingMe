import { Controller, Get, HttpCode, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { UploadLimitGuard } from "../security/upload-limit.guard";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { env } from "../config/env";
import { FilesService } from "./files.service";

@Controller("files") @AllowCustomer()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** multipart/form-data with a `file` field → `{ id, name, size, mime }`. Pass the id in `attachments: [id]` when sending. */
  @Post() @HttpCode(200)
  @UseGuards(UploadLimitGuard) // a few at a time + a daily allowance per user
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.maxVideoBytes + 1 } }))
  upload(@CurrentUser() u: User, @UploadedFile() file?: Express.Multer.File) {
    return this.files.upload(u, file);
  }

  /** `{ used, quota, files }` — how much of your storage your uploads take (quota 0 = no limit). */
  @Get("usage")
  usage(@CurrentUser() u: User) {
    return this.files.usage(u);
  }

  /** Permission-checked download. Accepts `?access_token=` so it works in links. */
  @Get(":id")
  async download(@CurrentUser() u: User, @Param("id") id: string, @Res() res: Response) {
    const f = await this.files.download(u, id);
    res.set({
      "content-type": f.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    });
    res.send(f.data);
  }
}
