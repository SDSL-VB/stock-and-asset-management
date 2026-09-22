import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sending mail, through Gmail / Google Workspace SMTP (or any SMTP server).
 *
 * Set in the environment (see .env.example):
 *
 *   SMTP_HOST   smtp.gmail.com
 *   SMTP_PORT   465
 *   SMTP_USER   the mailbox that sends, e.g. notifications@straightdrivesport.com
 *   SMTP_PASS   a Google "app password" for that mailbox — never its real password
 *   MAIL_FROM   optional; defaults to "SD-SIM <SMTP_USER>"
 *   APP_URL     the site's address, so links in mails open the right page
 *
 * With any of the first four missing, mail is simply off: nothing is sent and
 * nothing fails — notifications still appear in the app. So a local copy or a
 * test deployment never mails real people by accident.
 */

let transporter: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

/** An absolute link for a mail, from a path inside the app. */
function appLink(path: string): string {
  const base = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One mail with a heading, some lines, and optionally one link. Plain HTML so
 * it reads the same in every client; every value is escaped, because names and
 * notes in it were typed by people.
 */
export async function sendMail(message: {
  to: string;
  subject: string;
  heading: string;
  lines: { text: string; href?: string }[];
}): Promise<boolean> {
  if (!mailConfigured()) return false;

  const items = message.lines
    .map((l) =>
      l.href
        ? `<li style="margin:6px 0"><a href="${escape(appLink(l.href))}" style="color:#0a7d4f">${escape(l.text)}</a></li>`
        : `<li style="margin:6px 0">${escape(l.text)}</li>`
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
<h2 style="font-size:16px;margin:0 0 12px">${escape(message.heading)}</h2>
<ul style="padding-left:18px;margin:0">${items}</ul>
<p style="margin-top:20px;font-size:12px;color:#6b7280">From SD-SIM. Choose which mails you get under My Profile → Notifications.</p>
</div>`;
  const text = [message.heading, "", ...message.lines.map((l) => (l.href ? `- ${l.text}: ${appLink(l.href)}` : `- ${l.text}`))].join("\n");

  await transport().sendMail({
    from: process.env.MAIL_FROM || `SD-SIM <${process.env.SMTP_USER}>`,
    to: message.to,
    subject: message.subject,
    text,
    html,
  });
  return true;
}
