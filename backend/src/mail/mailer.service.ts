import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";

type Transport = { sendMail(m: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown> };

/**
 * Sends email over SMTP (works with Resend, Brevo, Gmail, Zoho… — see backend/.env.example).
 * Without SMTP settings nothing is sent: the message is written to the backend log instead (development).
 */
@Injectable()
export class Mailer {
  private readonly log = new Logger("Mail");
  private transport: Transport | null = null;

  get configured() { return !!env.smtp.host; }

  private async getTransport() {
    if (this.transport) return this.transport;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer") as { createTransport(o: unknown): Transport };
    const s = env.smtp;
    this.transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
    return this.transport;
  }

  async send(to: string, subject: string, text: string, html?: string) {
    if (!this.configured) {
      this.log.warn(`(not sent — SMTP_HOST is not set) to ${to}: ${subject}\n${text}`);
      return false;
    }
    try {
      await (await this.getTransport()).sendMail({ from: env.smtp.from, to, subject, text, html });
      return true;
    } catch (e) {
      this.log.error(`Could not send "${subject}" to ${to}: ${(e as Error).message}`);
      return false;
    }
  }
}
