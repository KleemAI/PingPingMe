import { HttpException } from "@nestjs/common";

/** Business-rule error with an HTTP status. The response body is `{ error: message }`. */
export class AppError extends HttpException {
  constructor(status: number, message: string) {
    super({ error: message, statusCode: status }, status);
  }
}

export const badRequest = (m: string) => new AppError(400, m);
export const unauthorized = (m = "Not signed in") => new AppError(401, m);
export const forbidden = (m = "Not allowed") => new AppError(403, m);
export const notFound = (what: string) => new AppError(404, `${what} not found`);
export const conflict = (m: string) => new AppError(409, m);
