import { Body, Controller, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { TtsService } from "./tts.service";

@Controller("tts") @AllowCustomer()
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  /**
   * `{ text }` → audio/wav: the to-do / reminder title spoken by KittenTTS 2 (Hindi when it has Devanagari letters,
   * otherwise English). 503 when the voice service is off — the phone then rings with its normal sound.
   */
  @Post("clip") @HttpCode(200)
  async clip(@CurrentUser() u: User, @Body() b: { text?: string }, @Res() res: Response) {
    const c = await this.tts.clip(u, b?.text ?? "");
    res.set({
      "content-type": "audio/wav",
      "cache-control": "private, max-age=86400",
      "x-tts-lang": c.lang, "x-tts-voice": c.voice, "x-tts-model": c.model,
    });
    res.send(c.wav);
  }
}
