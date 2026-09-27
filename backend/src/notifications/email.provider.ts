export type ValidatorEmail = { toIdentityId: string; subject: string; body: string };

export interface EmailNotificationProvider {
  send(message: ValidatorEmail): Promise<void>;
}

/** Safe development adapter. Production injects a configured provider. */
export class ConsoleEmailNotificationProvider implements EmailNotificationProvider {
  async send(message: ValidatorEmail): Promise<void> {
    if ((process.env.BEL_EMAIL_PROVIDER ?? "console") === "console") return;
    if (!process.env.BEL_SMTP_HOST || !process.env.BEL_EMAIL_FROM) throw new Error("Email provider is not configured");
    // SMTP transport is intentionally behind this port; credentials never
    // enter ValidatorService or application logs.
  }
}
