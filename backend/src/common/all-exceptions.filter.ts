import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import { AppError } from "./errors";

/** Every error leaves the API as `{ error: "human readable message" }` — what the web/mobile apps show in a toast. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(e: unknown, host: ArgumentsHost) {
    if (host.getType() !== "http") return;
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const body = e.getResponse() as string | { error?: string; message?: string | string[] };
      let message: string;
      if (e instanceof AppError) message = (body as { error: string }).error;
      else if (typeof body === "string") message = body;
      else message = Array.isArray(body.message) ? body.message.join(", ") : body.message ?? e.message;
      if (status === 413) message = "File is too large";
      res.status(status).json({ error: message, statusCode: status, ...(e instanceof AppError ? e.extra : undefined) });
      return;
    }
    this.log.error(e instanceof Error ? e.stack : String(e));
    res.status(500).json({ error: "Server error", statusCode: 500 });
  }
}
