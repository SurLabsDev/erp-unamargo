import { Resend } from "resend";

export type SendEmailResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * Single email gateway for the app. Without RESEND_API_KEY the email is
 * logged to the console and reported as "skipped": the app must keep working
 * (and never block an operation) when email is not configured.
 *
 * Serverless note: callers must `await` this within the request (never
 * fire-and-forget) or the email can be lost when the function freezes.
 */
export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<SendEmailResult> {
  const { to, subject, text } = input;
  if (to.length === 0) {
    return { status: "skipped", reason: "no recipients configured" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(
      `[email:console] to=${to.join(", ")} subject="${subject}"\n${text}`,
    );
    return { status: "skipped", reason: "RESEND_API_KEY not set" };
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.warn("[email] EMAIL_FROM not set; email not sent.");
    return { status: "skipped", reason: "EMAIL_FROM not set" };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to, subject, text });
    if (error) return { status: "failed", error: error.message };
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
