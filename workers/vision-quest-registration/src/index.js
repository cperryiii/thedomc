const SESSION_ORDER = ["Intro Talk", "Day Quest"];
const SESSION_SET = new Set(SESSION_ORDER);

const INTRO_EVENT = {
  title: "Vision Quest Intro Talk & Q&A",
  date: "Saturday, June 20, 2026",
  time: "10:00 AM Arizona time",
  location: "Evelyn Hallman Park, 1900 N College Ave, Tempe, AZ 85288",
  directions: "Park in the dedicated lot, cross the little footbridge, and gather at the covered ramada right on the water."
};

const DAY_EVENT = {
  title: "Day Quest",
  date: "Saturday, June 27, 2026",
  time: "AM + PM schedule",
  location: "Shared after the Intro Talk",
  note: "This full-day experience is required for anyone considering the full Vision Quest."
};

class PublicError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname !== "/register" || request.method !== "POST") {
      return json({ ok: false, error: "Not found" }, 404, cors);
    }

    if (!originAllowed(request, env)) {
      return json({ ok: false, error: "Origin not allowed" }, 403, cors);
    }

    try {
      const payload = await readPayload(request);

      if (payload.website || payload.company) {
        return json({ ok: true }, 200, cors);
      }

      const registration = validateRegistration(payload);
      const now = new Date().toISOString();
      const resendRequested = payload.resend === true;
      const existing = await findExistingRegistration(env.DB, registration.email);

      if (existing) {
        const mergedSessions = mergeSessions(existing.sessions, registration.sessions);
        const hasNewSessions = mergedSessions.length > existing.sessions.length;
        const confirmedRegistration = {
          ...registration,
          firstName: hasNewSessions ? registration.firstName : existing.firstName,
          lastName: hasNewSessions ? registration.lastName : existing.lastName,
          sessions: mergedSessions
        };

        if (!hasNewSessions && !resendRequested) {
          return json(
            {
              ok: true,
              status: "already_registered",
              alreadyRegistered: true,
              sessions: existing.sessions
            },
            200,
            cors
          );
        }

        const delivery = await sendRegistrationEmails(env, confirmedRegistration, existing.id, existing.createdAt, {
          adminReason: hasNewSessions ? "updated" : "resend"
        });

        await env.DB.prepare(
          `UPDATE registrations
           SET first_name = ?,
               last_name = ?,
               sessions = ?,
               updated_at = ?,
               email_status = ?,
               admin_email_status = ?,
               error_message = ?,
               last_confirmation_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE last_confirmation_sent_at END,
               resend_count = resend_count + ?
           WHERE id = ?`
        )
          .bind(
            confirmedRegistration.firstName,
            confirmedRegistration.lastName,
            JSON.stringify(mergedSessions),
            now,
            delivery.emailStatus,
            delivery.adminEmailStatus,
            delivery.errorMessage,
            delivery.emailStatus,
            now,
            resendRequested && !hasNewSessions ? 1 : 0,
            existing.id
          )
          .run();

        if (!delivery.ok) {
          return json(
            { ok: false, error: "Registration was found, but email delivery needs attention." },
            502,
            cors
          );
        }

        return json(
          {
            ok: true,
            status: resendRequested && !hasNewSessions ? "confirmation_resent" : "registration_updated",
            alreadyRegistered: !hasNewSessions,
            resent: resendRequested && !hasNewSessions,
            updated: hasNewSessions,
            id: existing.id,
            sessions: mergedSessions
          },
          200,
          cors
        );
      }

      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO registrations
          (id, created_at, updated_at, first_name, last_name, email, sessions, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          now,
          now,
          registration.firstName,
          registration.lastName,
          registration.email,
          JSON.stringify(registration.sessions),
          "vision-quest"
        )
        .run();

      const delivery = await sendRegistrationEmails(env, registration, id, now, {
        adminReason: "new"
      });

      await env.DB.prepare(
        `UPDATE registrations
         SET email_status = ?,
             admin_email_status = ?,
             error_message = ?,
             last_confirmation_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE last_confirmation_sent_at END
         WHERE id = ?`
      )
        .bind(delivery.emailStatus, delivery.adminEmailStatus, delivery.errorMessage, delivery.emailStatus, now, id)
        .run();

      if (!delivery.ok) {
        return json(
          { ok: false, error: "Registration was saved, but email delivery needs attention." },
          502,
          cors
        );
      }

      return json({ ok: true, status: "registered", id, sessions: registration.sessions }, 200, cors);
    } catch (error) {
      const status = error instanceof PublicError ? error.status : 500;
      const message = error instanceof PublicError ? error.message : "Registration could not be completed.";
      return json({ ok: false, error: message }, status, cors);
    }
  }
};

async function readPayload(request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 12000) {
    throw new PublicError("Request is too large.", 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new PublicError("Please submit the registration form again.", 400);
  }

  if (!payload || typeof payload !== "object") {
    throw new PublicError("Please submit the registration form again.", 400);
  }

  return payload;
}

function validateRegistration(payload) {
  const firstName = cleanName(payload.firstName);
  const lastName = cleanName(payload.lastName);
  const email = cleanEmail(payload.email);
  const sessions = normalizeSessions(payload.sessions);

  if (!firstName) throw new PublicError("First name is required.");
  if (!lastName) throw new PublicError("Last name is required.");
  if (!email) throw new PublicError("A valid email is required.");
  if (!sessions.length) throw new PublicError("Please choose at least one session.");

  return { firstName, lastName, email, sessions };
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeSessions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const session of value) {
    if (typeof session === "string" && SESSION_SET.has(session)) {
      seen.add(session);
    }
  }
  return SESSION_ORDER.filter((session) => seen.has(session));
}

async function findExistingRegistration(db, email) {
  const result = await db.prepare(
    `SELECT id, created_at, first_name, last_name, sessions
     FROM registrations
     WHERE email = ?
     ORDER BY created_at ASC`
  )
    .bind(email)
    .all();

  const rows = result.results || [];
  if (!rows.length) return null;

  let sessions = [];
  for (const row of rows) {
    sessions = mergeSessions(sessions, parseSessions(row.sessions));
  }

  return {
    id: rows[0].id,
    createdAt: rows[0].created_at,
    firstName: rows[0].first_name,
    lastName: rows[0].last_name,
    sessions
  };
}

function parseSessions(value) {
  try {
    return normalizeSessions(JSON.parse(value));
  } catch {
    return [];
  }
}

function mergeSessions(current, requested) {
  const seen = new Set([...(current || []), ...(requested || [])]);
  return SESSION_ORDER.filter((session) => seen.has(session));
}

async function sendRegistrationEmails(env, registration, id, createdAt, options = {}) {
  let emailStatus = "sent";
  let adminEmailStatus = adminNotificationsEnabled(env) ? "sent" : "skipped";
  let errorMessage = null;

  try {
    await sendResend(env, buildRegistrantEmail(registration, env));
  } catch (error) {
    emailStatus = "failed";
    errorMessage = shortError(error);
  }

  if (adminNotificationsEnabled(env) && options.adminReason !== "resend") {
    try {
      await sendResend(env, buildAdminEmail(registration, id, createdAt, env));
    } catch (error) {
      adminEmailStatus = "failed";
      errorMessage = errorMessage || shortError(error);
    }
  }

  return {
    ok: emailStatus === "sent" && adminEmailStatus !== "failed",
    emailStatus,
    adminEmailStatus,
    errorMessage
  };
}

function adminNotificationsEnabled(env) {
  return String(env.SEND_ADMIN_EMAIL || "false").toLowerCase() === "true";
}

function buildRegistrantEmail(registration, env) {
  const hasIntro = registration.sessions.includes("Intro Talk");
  const hasDay = registration.sessions.includes("Day Quest");
  const title = hasIntro && hasDay
    ? "Vision Quest registration confirmed"
    : hasIntro
      ? "Vision Quest Intro Talk registration"
      : "Vision Quest Day Quest registration received";

  const introHtml = hasIntro ? introSectionHtml(env) : "";
  const dayHtml = hasDay ? daySectionHtml() : "";
  const introText = hasIntro ? introSectionText(env) : "";
  const dayText = hasDay ? daySectionText() : "";
  const attachments = hasIntro ? [introCalendarAttachment(env)] : undefined;

  return {
    from: env.FROM_EMAIL,
    to: registration.email,
    subject: title,
    html: emailShell({
      eyebrow: "Healthy Hour presents",
      title,
      body: `
        <p style="margin:0 0 16px;">Hi ${escapeHtml(registration.firstName)},</p>
        <p style="margin:0 0 20px;">Thank you for registering for the Vision Quest. Your registration is confirmed for: <strong>${escapeHtml(registration.sessions.join(" + "))}</strong>.</p>
        ${introHtml}
        ${dayHtml}
        <p style="margin:22px 0 0;color:#5d5447;">If your plans change, reply to this email so we can keep the group list accurate.</p>
      `,
      siteUrl: env.SITE_URL
    }),
    text: [
      `Hi ${registration.firstName},`,
      "",
      `Thank you for registering for the Vision Quest. Your registration is confirmed for: ${registration.sessions.join(" + ")}.`,
      "",
      introText,
      dayText,
      "If your plans change, reply to this email so we can keep the group list accurate.",
      "",
      `Vision Quest page: ${env.SITE_URL}`
    ].filter(Boolean).join("\n"),
    attachments
  };
}

function introSectionHtml(env) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #e1d5bd;border-radius:8px;background:#fffdf7;">
      <tr><td style="padding:18px 18px 8px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">When</td><td style="padding:18px 18px 8px;">${INTRO_EVENT.date} at ${INTRO_EVENT.time}</td></tr>
      <tr><td style="padding:8px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Where</td><td style="padding:8px 18px;">${INTRO_EVENT.location}</td></tr>
      <tr><td style="padding:8px 18px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Arrival</td><td style="padding:8px 18px 18px;">${INTRO_EVENT.directions}</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #d9cab0;border-radius:8px;background:#f6edda;">
      <tr>
        <td style="padding:18px;">
          <h2 style="margin:0 0 8px;color:#4a3829;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.25;font-weight:700;">Joining by video</h2>
          <p style="margin:0 0 16px;color:#51483b;">Out of respect for your digital privacy, we are using Proton Meet for the video option. If you join from a phone or tablet, please download the Proton Meet app beforehand. If you join from a browser, please open the link a few minutes early so you have time to get set up.</p>
          <a href="${escapeAttr(env.PROTON_MEET_URL || "#")}" style="display:inline-block;border-radius:6px;background:#9A4A2B;color:#fffdf7;font-family:Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;padding:12px 18px;">Join by Proton Meet</a>
          <a href="${escapeAttr(env.MAP_URL)}" style="display:inline-block;margin-left:10px;border-radius:6px;background:#566428;color:#fffdf7;font-family:Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;padding:12px 18px;">See Map</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 18px;color:#6a5f50;font-size:14px;">A calendar file is attached for the Intro Talk.</p>
  `;
}

function daySectionHtml() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #e1d5bd;border-radius:8px;background:#fffdf7;">
      <tr><td style="padding:18px 18px 8px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Day Quest</td><td style="padding:18px 18px 8px;">${DAY_EVENT.date} - ${DAY_EVENT.time}</td></tr>
      <tr><td style="padding:8px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Where</td><td style="padding:8px 18px;">${DAY_EVENT.location}</td></tr>
      <tr><td style="padding:8px 18px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Note</td><td style="padding:8px 18px 18px;">${DAY_EVENT.note}</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #d8caa9;border-radius:8px;background:#f7f0df;">
      <tr><td style="padding:18px;"><h2 style="margin:0 0 8px;color:#4a3829;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.25;font-weight:700;">What happens next</h2><p style="margin:0;color:#51483b;">Please keep June 27 open for the full day. After the Intro Talk, we will send the location, arrival window, what to bring, and preparation notes.</p></td></tr>
    </table>
  `;
}

function introSectionText(env) {
  return [
    INTRO_EVENT.title,
    `When: ${INTRO_EVENT.date} at ${INTRO_EVENT.time}`,
    `Where: ${INTRO_EVENT.location}`,
    `Arrival: ${INTRO_EVENT.directions}`,
    "Video: We are using Proton Meet for digital privacy. Please open the link a few minutes early if joining from a browser.",
    `Join by Proton Meet: ${env.PROTON_MEET_URL || ""}`,
    `See Map: ${env.MAP_URL}`,
    ""
  ].join("\n");
}

function daySectionText() {
  return [
    DAY_EVENT.title,
    `When: ${DAY_EVENT.date} - ${DAY_EVENT.time}`,
    `Where: ${DAY_EVENT.location}`,
    DAY_EVENT.note,
    "Please keep June 27 open for the full day. After the Intro Talk, we will send the location, arrival window, what to bring, and preparation notes.",
    ""
  ].join("\n");
}

function buildAdminEmail(registration, id, createdAt, env) {
  const subject = `New Vision Quest registration: ${registration.firstName} ${registration.lastName}`;
  const sessions = registration.sessions.join(" + ");

  return {
    from: env.FROM_EMAIL,
    to: env.ADMIN_EMAIL,
    reply_to: registration.email,
    subject,
    html: emailShell({
      eyebrow: "New registration",
      title: "Vision Quest registration",
      body: `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;border:1px solid #e1d5bd;background:#fffdf7;">
          <tr><td style="padding:10px 14px;width:120px;font-weight:700;">Name</td><td style="padding:10px 14px;">${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)}</td></tr>
          <tr><td style="padding:10px 14px;width:120px;font-weight:700;">Email</td><td style="padding:10px 14px;"><a href="mailto:${escapeAttr(registration.email)}" style="color:#9A4A2B;">${escapeHtml(registration.email)}</a></td></tr>
          <tr><td style="padding:10px 14px;width:120px;font-weight:700;">Sessions</td><td style="padding:10px 14px;">${escapeHtml(sessions)}</td></tr>
          <tr><td style="padding:10px 14px;width:120px;font-weight:700;">Submitted</td><td style="padding:10px 14px;">${escapeHtml(createdAt)}</td></tr>
          <tr><td style="padding:10px 14px;width:120px;font-weight:700;">Record ID</td><td style="padding:10px 14px;">${escapeHtml(id)}</td></tr>
        </table>
      `,
      siteUrl: env.SITE_URL
    }),
    text: [
      subject,
      "",
      `Name: ${registration.firstName} ${registration.lastName}`,
      `Email: ${registration.email}`,
      `Sessions: ${sessions}`,
      `Submitted: ${createdAt}`,
      `Record ID: ${id}`
    ].join("\n")
  };
}

function emailShell({ eyebrow, title, body, siteUrl }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#fbf8ef;color:#26231d;font-family:Georgia,'Times New Roman',serif;line-height:1.55;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fbf8ef;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:680px;background:#fbf8ef;">
          <tr>
            <td style="padding:28px;border:1px solid #dfd2b9;border-radius:8px;background:#f1ead8;">
              <p style="margin:0 0 18px;color:#8e5530;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
              <h1 style="margin:0;color:#2f3328;font-size:36px;line-height:1.06;font-weight:500;">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr><td style="padding:28px 34px 8px;">${body}</td></tr>
          <tr>
            <td style="padding:22px 34px 30px;border-top:1px solid #e5dcc9;background:#f5efdf;color:#686152;font-size:14px;">
              <p style="margin:0 0 6px;">Healthy Hour | Vision Quest 2026</p>
              <p style="margin:0;">You are receiving this because you registered at <a href="${escapeAttr(siteUrl)}" style="color:#8e5530;">thedomc.org/vision-quest/</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function introCalendarAttachment(env) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const description = [
    "Vision Quest Intro Talk and Q&A.",
    "Join in person at Evelyn Hallman Park or by Proton Meet.",
    `Proton Meet: ${env.PROTON_MEET_URL || ""}`,
    `Map: ${env.MAP_URL}`
  ].join("\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The DOMC//Vision Quest//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:vision-quest-intro-20260620@thedomc.org",
    `DTSTAMP:${now}`,
    "DTSTART:20260620T170000Z",
    "DTEND:20260620T183000Z",
    `SUMMARY:${icsEscape(INTRO_EVENT.title)}`,
    `LOCATION:${icsEscape(INTRO_EVENT.location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${env.SITE_URL}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return {
    filename: "vision-quest-intro-june-20.ics",
    content: btoa(ics),
    content_type: "text/calendar; charset=utf-8; method=PUBLISH"
  };
}

async function sendResend(env, payload) {
  if (!env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Resend failed with ${response.status}: ${responseText.slice(0, 160)}`);
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (origin && originAllowed(request, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!origin) {
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function shortError(error) {
  return error instanceof Error ? error.message.slice(0, 240) : "Unknown email error";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value || "");
}

function icsEscape(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}
