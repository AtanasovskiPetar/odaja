// Sending email (sign-in links, password resets, verification). With
// RESEND_API_KEY and EMAIL_FROM set it goes through Resend; without, the
// message is written to the server's log instead, which is enough for
// development and small self-hosted servers.
export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface EmailConfig {
  resendApiKey?: string;
  from?: string;
}

export function createMailer(cfg: EmailConfig) {
  const configured = Boolean(cfg.resendApiKey && cfg.from);
  return {
    configured,
    async send(email: Email) {
      if (!configured) {
        console.log(`[odaja-cloud] email to ${email.to}: ${email.subject}\n${email.text}`);
        return;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.from, to: email.to, subject: email.subject, text: email.text }),
      });
      if (!res.ok) throw new Error(`Couldn't send the email (${res.status})`);
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;
