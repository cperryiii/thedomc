const SESSION_ORDER = ["Intro Talk", "Day Quest"];
const SESSION_SET = new Set(SESSION_ORDER);
const PUBLIC_SESSION_ORDER = ["Day Quest"];
const PUBLIC_SESSION_SET = new Set(PUBLIC_SESSION_ORDER);
const WQ2_SIGNUP_CUTOFF = "2026-06-28T07:00:00.000Z";
const ADMIN_ROW_COLUMNS = `id, created_at, updated_at, first_name, last_name, email, sessions,
           email_status, admin_email_status, last_confirmation_sent_at,
           resend_count, archived_at`;

const INTRO_EVENT = {
  title: "Intro Talk & Q&A",
  date: "Completed",
  time: "",
  location: "",
  directions: "The intro talk has already taken place."
};

const DAY_EVENT = {
  title: "Day Quest",
  date: "Sunday, July 19, 2026",
  time: "7:00 AM - 2:00 PM Arizona time",
  location: "Legends of Superior Trails, near Superior, AZ",
  arrival: "Plan to arrive a little before 7:00 AM so we can start on time and keep solo time during the coolest temperatures. After turning right from Route 60 toward Legends of Superior Trails, drive a short bit, look for Michele's Mazda CX-5, and park there. Michele will drive the group the rest of the way, about 5 minutes, because the road is rocky.",
  note: "A day quest is required for anyone considering the full Wilderness Quest.",
  bring: [
    "A gallon jug of water with electrolytes",
    "Journal",
    "Sun protection, such as sunscreen, a hat, or clothing to cover",
    "An offering to the land, such as tobacco, oats, seeds, or something biodegradable",
    "Anything needed for basic comfort",
    "An open spirit"
  ],
  preparation: "Hydrate well the day before and the morning of. Lemon water is a good option for electrolytes. Lunch will be provided after solo time. Michele suggests a light, plant-based morning meal if possible, such as nuts, fruit, yogurt, or steel cut oats. You will be fasting from food during solo time.",
  phone: "During solo time, and for the day unless there is an urgent matter, please turn phones off so there are no distractions."
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

    if (url.pathname === "/admin") {
      return Response.redirect(`${url.origin}/admin/`, 302);
    }

    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url);
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
              sessions: registration.sessions
            },
            200,
            cors
          );
        }

        const responseSessions = registration.sessions.length ? registration.sessions : mergedSessions;
        const emailRegistration = {
          ...confirmedRegistration,
          sessions: responseSessions
        };
        const delivery = await sendRegistrationEmails(env, emailRegistration, existing.id, existing.createdAt, {
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
            sessions: responseSessions
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

async function handleAdmin(request, env, url) {
  const admin = await requireAdmin(request, env);
  if (!admin.ok) {
    return adminDenied(admin.status);
  }

  try {
    if (url.pathname === "/admin/" && request.method === "GET") {
      return adminHtml(admin.email);
    }

    if (url.pathname === "/admin/data" && request.method === "GET") {
      const rows = await listAdminRows(env.DB, url.searchParams.get("archived") === "1");
      return adminJson({ ok: true, rows, user: admin.email });
    }

    if (url.pathname === "/admin/export.csv" && request.method === "GET") {
      const rows = await listAdminRows(env.DB, url.searchParams.get("archived") === "1");
      return new Response(toCsv(rows), {
        headers: {
          ...adminBaseHeaders("text/csv; charset=utf-8"),
          "Content-Disposition": "attachment; filename=\"vision-quest-registrations.csv\""
        }
      });
    }

    if (url.pathname === "/admin/update" && request.method === "POST") {
      const payload = await readPayload(request);
      const result = await updateAdminRegistration(env.DB, payload);
      const notification = await sendAdminActionNotification(env, {
        action: "edited",
        actorEmail: admin.email,
        before: result.before,
        after: result.after
      });
      return adminJson({ ok: true, row: result.after, notification });
    }

    if (url.pathname === "/admin/archive" && request.method === "POST") {
      const payload = await readPayload(request);
      const removed = await archiveAdminRegistration(env.DB, payload.id);
      const notification = await sendAdminActionNotification(env, {
        action: "removed",
        actorEmail: admin.email,
        before: removed
      });
      return adminJson({ ok: true, notification });
    }

    if (url.pathname === "/admin/archive-bulk" && request.method === "POST") {
      const payload = await readPayload(request);
      const removed = await archiveAdminRegistrations(env.DB, payload.ids);
      const notification = await sendAdminActionNotification(env, {
        action: "removed selected registrations",
        actorEmail: admin.email,
        removed
      });
      return adminJson({ ok: true, archived: removed.length, notification });
    }

    return adminJson({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Admin request could not be completed.";
    return adminJson({ ok: false, error: message }, status);
  }
}

async function requireAdmin(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401 };

  try {
    const claims = await verifyAccessJwt(token, env);
    const email = String(claims.email || "").toLowerCase();
    const allowed = allowedAdminEmails(env);
    if (!email || !allowed.has(email)) return { ok: false, status: 403 };
    return { ok: true, email };
  } catch {
    return { ok: false, status: 403 };
  }
}

function allowedAdminEmails(env) {
  return new Set(
    [env.ADMIN_ALLOWED_EMAILS, env.ADMIN_ALLOWED_EMAIL]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((email) => String(email).trim().toLowerCase())
      .filter(Boolean)
  );
}

async function verifyAccessJwt(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");

  const header = JSON.parse(base64UrlText(parts[0]));
  const payload = JSON.parse(base64UrlText(parts[1]));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported JWT");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Expired JWT");
  if (payload.nbf && payload.nbf > now) throw new Error("JWT not active");

  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const expectedIssuer = `https://${teamDomain}`;
  if (payload.iss !== expectedIssuer && payload.iss !== `${expectedIssuer}/cdn-cgi/access`) {
    throw new Error("Invalid issuer");
  }

  const expectedAud = String(env.CF_ACCESS_AUD || "");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!expectedAud || !aud.includes(expectedAud)) throw new Error("Invalid audience");

  const certsResponse = await fetch(`${expectedIssuer}/cdn-cgi/access/certs`);
  if (!certsResponse.ok) throw new Error("Could not load Access certs");
  const certs = await certsResponse.json();
  const jwk = (certs.keys || []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) throw new Error("Invalid signature");

  return payload;
}

async function listAdminRows(db, includeArchived = false) {
  const query = `
    SELECT ${ADMIN_ROW_COLUMNS}
    FROM registrations
    ${includeArchived ? "" : "WHERE archived_at IS NULL"}
    ORDER BY created_at DESC
    LIMIT 1000`;
  const result = await db.prepare(query).all();
  return (result.results || []).map(formatAdminRow);
}

function formatAdminRow(row) {
  const formatted = {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    sessions: parseSessions(row.sessions),
    emailStatus: row.email_status,
    adminEmailStatus: row.admin_email_status,
    lastConfirmationSentAt: row.last_confirmation_sent_at,
    resendCount: Number(row.resend_count || 0),
    archivedAt: row.archived_at || null
  };
  formatted.displaySessions = adminSessionLabels(formatted);
  formatted.group = adminGroupLabel(formatted);
  return formatted;
}

function adminSessionLabels(row) {
  return (row.sessions || []).map((session) => adminSessionLabel(session, row));
}

function adminSessionLabel(session, row) {
  if (session === "Intro Talk") return "Intro Talk 1";
  if (session === "Day Quest") return isWildernessQuestTwo(row) ? "Wilderness Quest #2" : "Wilderness Quest #1";
  return session;
}

function adminGroupLabel(row) {
  const labels = adminSessionLabels(row);
  if (labels.includes("Wilderness Quest #2")) return "Wilderness Quest #2";
  if (labels.includes("Wilderness Quest #1")) return "Wilderness Quest #1";
  if (labels.includes("Intro Talk 1")) return "Intro Talk 1";
  return "Other";
}

function isWildernessQuestTwo(row) {
  const referenceAt = new Date(row.lastConfirmationSentAt || row.updatedAt || row.createdAt || row.created_at || "");
  return !Number.isNaN(referenceAt.getTime()) && referenceAt.toISOString() >= WQ2_SIGNUP_CUTOFF;
}

async function updateAdminRegistration(db, payload) {
  const id = cleanId(payload.id);
  if (!id) throw new PublicError("Registration ID is required.");

  const firstName = cleanName(payload.firstName);
  const lastName = cleanName(payload.lastName);
  const email = cleanEmail(payload.email);
  const sessions = normalizeSessions(payload.sessions);
  if (!firstName) throw new PublicError("First name is required.");
  if (!lastName) throw new PublicError("Last name is required.");
  if (!email) throw new PublicError("A valid email is required.");
  if (!sessions.length) throw new PublicError("Choose at least one session.");

  const existing = await fetchActiveAdminRow(db, id);
  if (!existing) throw new PublicError("Registration not found.", 404);

  const conflict = await db.prepare(
    `SELECT id FROM registrations
     WHERE lower(email) = lower(?) AND id != ? AND archived_at IS NULL
     LIMIT 1`
  ).bind(email, id).first();
  if (conflict) throw new PublicError("That email is already used by another active registration.", 409);

  const updatedAt = new Date().toISOString();
  await db.prepare(
    `UPDATE registrations
     SET first_name = ?, last_name = ?, email = ?, sessions = ?, updated_at = ?
     WHERE id = ?`
  ).bind(firstName, lastName, email, JSON.stringify(sessions), updatedAt, id).run();

  const row = await db.prepare(
    `SELECT ${ADMIN_ROW_COLUMNS}
     FROM registrations
     WHERE id = ?`
  ).bind(id).first();
  return { before: existing, after: formatAdminRow(row) };
}

async function archiveAdminRegistration(db, idValue) {
  const id = cleanId(idValue);
  if (!id) throw new PublicError("Registration ID is required.");
  const existing = await fetchActiveAdminRow(db, id);
  if (!existing) throw new PublicError("Registration not found.", 404);
  const archivedAt = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE registrations
     SET archived_at = ?, updated_at = ?
     WHERE id = ? AND archived_at IS NULL`
  ).bind(archivedAt, archivedAt, id).run();
  if (!result.meta || result.meta.changes === 0) {
    throw new PublicError("Registration not found.", 404);
  }
  return existing;
}

async function archiveAdminRegistrations(db, idValues) {
  if (!Array.isArray(idValues)) throw new PublicError("Choose at least one registration.");
  const ids = idValues.map(cleanId).filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) throw new PublicError("Choose at least one registration.");
  if (uniqueIds.length > 100) throw new PublicError("Remove 100 or fewer registrations at a time.");

  const archivedAt = new Date().toISOString();
  const removed = [];
  for (const id of uniqueIds) {
    const existing = await fetchActiveAdminRow(db, id);
    if (!existing) continue;
    const result = await db.prepare(
      `UPDATE registrations
       SET archived_at = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NULL`
    ).bind(archivedAt, archivedAt, id).run();
    if (Number((result.meta && result.meta.changes) || 0) > 0) {
      removed.push(existing);
    }
  }
  return removed;
}

async function fetchActiveAdminRow(db, id) {
  const row = await db.prepare(
    `SELECT ${ADMIN_ROW_COLUMNS}
     FROM registrations
     WHERE id = ? AND archived_at IS NULL
     LIMIT 1`
  ).bind(id).first();
  return row ? formatAdminRow(row) : null;
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return /^[a-f0-9-]{36}$/i.test(id) ? id : "";
}

function adminHtml(userEmail) {
  return new Response(renderAdminPage(userEmail), {
    headers: adminBaseHeaders("text/html; charset=utf-8")
  });
}

function adminJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: adminBaseHeaders("application/json; charset=utf-8")
  });
}

function adminDenied(status) {
  return new Response(status === 401 ? "Authentication required." : "Access denied.", {
    status,
    headers: adminBaseHeaders("text/plain; charset=utf-8")
  });
}

function adminBaseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  };
}

function renderAdminPage(userEmail) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Wilderness Quest Registrations</title>
<style>
:root{color-scheme:light;--bg:#f4f1e8;--panel:#fffdf7;--ink:#251f16;--soft:#6e6252;--line:#ddd0b8;--rust:#9a4a2b;--green:#53652e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 18px 44px}.top{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;margin-bottom:18px}
h1{font-family:Georgia,serif;font-weight:500;font-size:34px;line-height:1;margin:0}.meta{color:var(--soft);font-size:13px;margin-top:7px}
.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.bulk{display:none;align-items:center;gap:10px;margin:0 0 14px;padding:10px 12px;border:1px solid #dfc5b9;background:#fff7f0;border-radius:8px}.search{min-width:260px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:10px 12px;color:var(--ink)}
.btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;padding:9px 12px;font-weight:650;text-decoration:none;cursor:pointer}.btn:hover{border-color:var(--rust)}
.btn--rust{background:var(--rust);border-color:var(--rust);color:white}.btn--danger{color:#8a2f21}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
table{width:100%;border-collapse:collapse}th,td{padding:12px 11px;border-bottom:1px solid #eadfcb;text-align:left;vertical-align:top}th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#756852;background:#f5efdf}
th.select,td.select{width:42px;text-align:center}.rowcheck,.selectall{width:17px;height:17px;accent-color:var(--rust)}
tr.is-archived{opacity:.58}.group-row td{padding:10px 12px;background:#efe4cf;color:#654f36;border-top:2px solid #d0b897;border-bottom:1px solid #d0b897;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.name{font-weight:700}.small{font-size:12px;color:var(--soft)}.chip{display:inline-flex;margin:0 4px 4px 0;padding:4px 7px;border-radius:999px;background:#eef2e7;color:#34401f;font-size:12px;font-weight:650}
.status{font-size:12px;color:var(--soft)}.actions{display:flex;gap:7px;flex-wrap:wrap}.empty{padding:32px;color:var(--soft);text-align:center}.error{display:none;margin:0 0 14px;padding:12px;border:1px solid #dfb2a3;background:#fff4ef;color:#7e2e20;border-radius:8px}
dialog{width:min(520px,calc(100vw - 28px));border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink);padding:0;box-shadow:0 30px 90px rgba(0,0,0,.2)}dialog::backdrop{background:rgba(20,18,13,.45)}
.modal{padding:20px}.modal h2{font-family:Georgia,serif;font-weight:500;margin:0 0 14px;font-size:28px}.grid{display:grid;gap:12px}.field label{display:block;font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin-bottom:5px}
.field input{width:100%;border:1px solid var(--line);border-radius:6px;padding:10px 11px;background:#fff;color:var(--ink)}.checks{display:flex;gap:14px;flex-wrap:wrap}.checks label{display:flex;align-items:center;gap:7px;color:var(--ink);font-size:14px;text-transform:none;letter-spacing:0}
.modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}@media(max-width:760px){.top{align-items:flex-start;flex-direction:column}.search{width:100%;min-width:0}.panel{overflow:auto}table{min-width:880px}}
</style>
</head>
<body>
<main>
  <div class="top">
    <div>
      <h1>Wilderness Quest Registrations</h1>
      <div class="meta">Signed in as ${escapeHtml(userEmail)} · private admin view</div>
    </div>
    <div class="tools">
      <input class="search" id="search" type="search" placeholder="Search name, email, session">
      <label class="small"><input type="checkbox" id="showArchived"> Show removed</label>
      <a class="btn" id="exportLink" href="/admin/export.csv">Export CSV</a>
      <button class="btn" id="refresh">Refresh</button>
    </div>
  </div>
  <p class="error" id="error"></p>
  <div class="bulk" id="bulkBar">
    <strong id="selectedCount">0 selected</strong>
    <button class="btn btn--danger" id="bulkRemove">Remove selected</button>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th class="select"><input class="selectall" id="selectAll" type="checkbox" aria-label="Select all active rows"></th><th>Name</th><th>Email</th><th>Sessions</th><th>Signed Up</th><th>Email</th><th>Actions</th></tr></thead>
      <tbody id="rows"><tr><td colspan="7" class="empty">Loading...</td></tr></tbody>
    </table>
  </div>
</main>
<dialog id="editor">
  <form class="modal" method="dialog">
    <h2>Edit registration</h2>
    <input type="hidden" id="editId">
    <div class="grid">
      <div class="field"><label for="editFirst">First name</label><input id="editFirst" required></div>
      <div class="field"><label for="editLast">Last name</label><input id="editLast" required></div>
      <div class="field"><label for="editEmail">Email</label><input id="editEmail" type="email" required></div>
      <div class="field">
        <label>Sessions</label>
        <div class="checks">
          <label><input type="checkbox" id="editIntro"> Intro Talk 1</label>
          <label><input type="checkbox" id="editDay"> Wilderness Quest</label>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" value="cancel">Cancel</button>
      <button class="btn btn--rust" id="saveEdit" value="default">Save</button>
    </div>
  </form>
</dialog>
<script>
const state={rows:[],filter:"",selected:new Set()};
const rowsEl=document.getElementById("rows"),errorEl=document.getElementById("error"),editor=document.getElementById("editor"),selectAll=document.getElementById("selectAll"),bulkBar=document.getElementById("bulkBar"),selectedCount=document.getElementById("selectedCount");
const fmt=new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"});
function showError(message){errorEl.textContent=message;errorEl.style.display=message?"block":"none"}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]))}
function date(value){if(!value)return "";const d=new Date(value);return Number.isNaN(d.getTime())?"":fmt.format(d)}
async function api(path,options){showError("");const res=await fetch(path,{headers:{"Content-Type":"application/json"},...options});const data=await res.json().catch(()=>({}));if(!res.ok||!data.ok)throw new Error(data.error||"Request failed");return data}
async function load(){const archived=document.getElementById("showArchived").checked;document.getElementById("exportLink").href="/admin/export.csv"+(archived?"?archived=1":"");const data=await api("/admin/data"+(archived?"?archived=1":""));state.rows=data.rows;state.selected.clear();render()}
function visibleRows(){const q=state.filter.trim().toLowerCase();return state.rows.filter(r=>!q||[r.firstName,r.lastName,r.email,r.group,(r.sessions||[]).join(" "),(r.displaySessions||[]).join(" ")].join(" ").toLowerCase().includes(q))}
function activeVisibleRows(){return visibleRows().filter(r=>!r.archivedAt)}
function updateBulk(){const selected=[...state.selected].filter(id=>state.rows.some(r=>r.id===id&&!r.archivedAt));state.selected=new Set(selected);const count=state.selected.size;bulkBar.style.display=count?"flex":"none";selectedCount.textContent=count+" selected";const active=activeVisibleRows();selectAll.checked=active.length>0&&active.every(r=>state.selected.has(r.id));selectAll.indeterminate=count>0&&!selectAll.checked}
function render(){const rows=visibleRows();if(!rows.length){rowsEl.innerHTML='<tr><td colspan="7" class="empty">No registrations found.</td></tr>';updateBulk();return}let lastGroup="";rowsEl.innerHTML=rows.map(r=>{const group=r.group||"Other";const divider=group!==lastGroup?\`<tr class="group-row"><td colspan="7">\${esc(group)}</td></tr>\`:"";lastGroup=group;return divider+\`<tr class="\${r.archivedAt?"is-archived":""}"><td class="select">\${r.archivedAt?"":\`<input class="rowcheck" type="checkbox" data-select="\${esc(r.id)}" aria-label="Select \${esc(r.firstName)} \${esc(r.lastName)}" \${state.selected.has(r.id)?"checked":""}>\`}</td><td><div class="name">\${esc(r.firstName)} \${esc(r.lastName)}</div><div class="small">Updated \${date(r.updatedAt)}</div></td><td><a href="mailto:\${esc(r.email)}">\${esc(r.email)}</a></td><td>\${(r.displaySessions||r.sessions||[]).map(s=>\`<span class="chip">\${esc(s)}</span>\`).join("")}</td><td><div>\${date(r.createdAt)}</div><div class="small">\${r.archivedAt?"Removed "+date(r.archivedAt):""}</div></td><td><div class="status">Confirmation: \${esc(r.emailStatus||"")}</div><div class="status">Last sent: \${date(r.lastConfirmationSentAt)||"n/a"}</div><div class="status">Resends: \${r.resendCount||0}</div></td><td><div class="actions">\${r.archivedAt?"":\`<button class="btn" data-edit="\${esc(r.id)}">Edit</button><button class="btn btn--danger" data-archive="\${esc(r.id)}">Remove</button>\`}</div></td></tr>\`}).join("");updateBulk()}
function editRow(id){const r=state.rows.find(row=>row.id===id);if(!r)return;document.getElementById("editId").value=r.id;document.getElementById("editFirst").value=r.firstName||"";document.getElementById("editLast").value=r.lastName||"";document.getElementById("editEmail").value=r.email||"";document.getElementById("editIntro").checked=(r.sessions||[]).includes("Intro Talk");document.getElementById("editDay").checked=(r.sessions||[]).includes("Day Quest");editor.showModal()}
document.getElementById("search").addEventListener("input",e=>{state.filter=e.target.value;render()});
document.getElementById("refresh").addEventListener("click",()=>load().catch(e=>showError(e.message)));
document.getElementById("showArchived").addEventListener("change",()=>load().catch(e=>showError(e.message)));
selectAll.addEventListener("change",()=>{const rows=activeVisibleRows();rows.forEach(r=>selectAll.checked?state.selected.add(r.id):state.selected.delete(r.id));render()});
rowsEl.addEventListener("change",e=>{const box=e.target.closest("[data-select]");if(!box)return;box.checked?state.selected.add(box.dataset.select):state.selected.delete(box.dataset.select);updateBulk()});
rowsEl.addEventListener("click",async e=>{const edit=e.target.closest("[data-edit]"),archive=e.target.closest("[data-archive]");if(edit)editRow(edit.dataset.edit);if(archive&&confirm("Remove this registration from the active list?")){try{await api("/admin/archive",{method:"POST",body:JSON.stringify({id:archive.dataset.archive})});await load()}catch(err){showError(err.message)}}});
document.getElementById("bulkRemove").addEventListener("click",async()=>{const ids=[...state.selected];if(!ids.length)return;if(confirm("Remove "+ids.length+" selected registration"+(ids.length===1?"":"s")+" from the active list?")){try{await api("/admin/archive-bulk",{method:"POST",body:JSON.stringify({ids})});await load()}catch(err){showError(err.message)}}});
document.getElementById("saveEdit").addEventListener("click",async e=>{e.preventDefault();const sessions=[];if(document.getElementById("editIntro").checked)sessions.push("Intro Talk");if(document.getElementById("editDay").checked)sessions.push("Day Quest");try{await api("/admin/update",{method:"POST",body:JSON.stringify({id:document.getElementById("editId").value,firstName:document.getElementById("editFirst").value,lastName:document.getElementById("editLast").value,email:document.getElementById("editEmail").value,sessions})});editor.close();await load()}catch(err){showError(err.message)}});
load().catch(e=>showError(e.message));
</script>
</body>
</html>`;
}

function toCsv(rows) {
  const header = [
    "created_at", "updated_at", "first_name", "last_name", "email", "sessions",
    "email_status", "last_confirmation_sent_at", "resend_count", "archived_at"
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.createdAt,
      row.updatedAt,
      row.firstName,
      row.lastName,
      row.email,
      (row.displaySessions || row.sessions).join(" + "),
      row.emailStatus,
      row.lastConfirmationSentAt || "",
      row.resendCount,
      row.archivedAt || ""
    ].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function base64UrlText(value) {
  return new TextDecoder().decode(base64UrlBytes(value));
}

function base64UrlBytes(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
  const sessions = normalizePublicSessions(payload.sessions);

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

function normalizePublicSessions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const session of value) {
    if (typeof session === "string" && PUBLIC_SESSION_SET.has(session)) {
      seen.add(session);
    }
  }
  return PUBLIC_SESSION_ORDER.filter((session) => seen.has(session));
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

async function sendAdminActionNotification(env, details) {
  const to = cleanEmail(env.ADMIN_ACTION_NOTIFY_EMAIL || env.ADMIN_EMAIL);
  if (!to || !env.RESEND_API_KEY) return { status: "skipped" };

  try {
    await sendResend(env, buildAdminActionEmail(to, details, env));
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: shortError(error) };
  }
}

function buildAdminActionEmail(to, details, env) {
  const actor = details.actorEmail || "unknown admin";
  const subject = details.action === "edited"
    ? `Wilderness Quest admin edit: ${adminRowName(details.after || details.before)}`
    : `Wilderness Quest admin removal by ${actor}`;
  const body = details.action === "edited"
    ? adminEditActionHtml(details.before, details.after, actor)
    : adminRemovalActionHtml(details.removed || [details.before].filter(Boolean), actor);

  return {
    from: env.FROM_EMAIL,
    to,
    subject,
    html: emailShell({
      eyebrow: "Admin activity",
      title: "Wilderness Quest registration update",
      body,
      siteUrl: env.SITE_URL
    }),
    text: adminActionText(details, actor)
  };
}

function adminEditActionHtml(before, after, actor) {
  const diffs = adminEditDiffs(before, after);
  const rows = diffs.length
    ? diffs.map((diff) => `
        <tr>
          <td style="padding:10px 14px;border-top:1px solid #e1d5bd;font-weight:700;">${escapeHtml(diff.label)}</td>
          <td style="padding:10px 14px;border-top:1px solid #e1d5bd;color:#6b5e4c;">${escapeHtml(diff.before || "blank")}</td>
          <td style="padding:10px 14px;border-top:1px solid #e1d5bd;">${escapeHtml(diff.after || "blank")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="3" style="padding:10px 14px;border-top:1px solid #e1d5bd;">No field values changed.</td></tr>`;

  return `
    <p style="margin:0 0 12px;"><strong>Edited by:</strong> ${escapeHtml(actor)}</p>
    <p style="margin:0 0 18px;"><strong>Registration:</strong> ${escapeHtml(adminRowName(after))} (${escapeHtml(after.email)})</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;border:1px solid #e1d5bd;background:#fffdf7;">
      <tr>
        <td style="padding:10px 14px;font-weight:700;">Field</td>
        <td style="padding:10px 14px;font-weight:700;">From</td>
        <td style="padding:10px 14px;font-weight:700;">To</td>
      </tr>
      ${rows}
    </table>
  `;
}

function adminRemovalActionHtml(rows, actor) {
  const items = rows.map((row) => `
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #e1d5bd;">${escapeHtml(adminRowName(row))}</td>
      <td style="padding:10px 14px;border-top:1px solid #e1d5bd;"><a href="mailto:${escapeAttr(row.email)}" style="color:#9A4A2B;">${escapeHtml(row.email)}</a></td>
      <td style="padding:10px 14px;border-top:1px solid #e1d5bd;">${escapeHtml(adminRowSessions(row))}</td>
    </tr>
  `).join("");

  return `
    <p style="margin:0 0 18px;"><strong>Removed by:</strong> ${escapeHtml(actor)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;border:1px solid #e1d5bd;background:#fffdf7;">
      <tr>
        <td style="padding:10px 14px;font-weight:700;">Name</td>
        <td style="padding:10px 14px;font-weight:700;">Email</td>
        <td style="padding:10px 14px;font-weight:700;">Registration</td>
      </tr>
      ${items}
    </table>
  `;
}

function adminEditDiffs(before, after) {
  const fields = [
    ["First name", "firstName"],
    ["Last name", "lastName"],
    ["Email", "email"]
  ];
  const diffs = fields
    .filter(([, key]) => String(before[key] || "") !== String(after[key] || ""))
    .map(([label, key]) => ({ label, before: before[key], after: after[key] }));

  const beforeSessions = adminRowSessions(before);
  const afterSessions = adminRowSessions(after);
  if (beforeSessions !== afterSessions) {
    diffs.push({ label: "Registration", before: beforeSessions, after: afterSessions });
  }

  return diffs;
}

function adminActionText(details, actor) {
  if (details.action === "edited") {
    const diffs = adminEditDiffs(details.before, details.after);
    return [
      `Wilderness Quest registration edited by ${actor}`,
      "",
      `Registration: ${adminRowName(details.after)} <${details.after.email}>`,
      "",
      "Changes:",
      ...(diffs.length ? diffs.map((diff) => `- ${diff.label}: ${diff.before || "blank"} -> ${diff.after || "blank"}`) : ["- No field values changed."])
    ].join("\n");
  }

  const rows = details.removed || [details.before].filter(Boolean);
  return [
    `Wilderness Quest registration removed by ${actor}`,
    "",
    ...rows.map((row) => `- ${adminRowName(row)} <${row.email}> - ${adminRowSessions(row)}`)
  ].join("\n");
}

function adminRowName(row) {
  return `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.email || row.id || "Unknown registration";
}

function adminRowSessions(row) {
  return (row.displaySessions || row.sessions || []).join(" + ");
}

function buildRegistrantEmail(registration, env) {
  const hasIntro = registration.sessions.includes("Intro Talk");
  const hasDay = registration.sessions.includes("Day Quest");
  const title = hasIntro && hasDay
    ? "Wilderness Quest registration confirmed"
    : hasIntro
      ? "Wilderness Quest Intro Talk registration"
      : "Wilderness Quest Day Quest registration received";

  const introHtml = hasIntro ? introSectionHtml(env) : "";
  const dayHtml = hasDay ? daySectionHtml() : "";
  const introText = hasIntro ? introSectionText(env) : "";
  const dayText = hasDay ? daySectionText() : "";
  const attachments = undefined;

  return {
    from: env.FROM_EMAIL,
    to: registration.email,
    subject: title,
    html: emailShell({
      eyebrow: "Healthy Hour presents",
      title,
      body: `
        <p style="margin:0 0 16px;">Hi ${escapeHtml(registration.firstName)},</p>
        <p style="margin:0 0 20px;">Thank you for registering for the Wilderness Quest. Your registration is confirmed for: <strong>${escapeHtml(registration.sessions.join(" + "))}</strong>.</p>
        ${introHtml}
        ${dayHtml}
        <p style="margin:22px 0 0;color:#5d5447;">If your plans change, reply to this email so we can keep the group list accurate.</p>
      `,
      siteUrl: env.SITE_URL
    }),
    text: [
      `Hi ${registration.firstName},`,
      "",
      `Thank you for registering for the Wilderness Quest. Your registration is confirmed for: ${registration.sessions.join(" + ")}.`,
      "",
      introText,
      dayText,
      "If your plans change, reply to this email so we can keep the group list accurate.",
      "",
      `Wilderness Quest page: ${env.SITE_URL}`
    ].filter(Boolean).join("\n"),
    attachments
  };
}

function introSectionHtml() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #e1d5bd;border-radius:8px;background:#fffdf7;">
      <tr><td style="padding:18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Intro</td><td style="padding:18px;">${INTRO_EVENT.directions}</td></tr>
    </table>
  `;
}

function daySectionHtml() {
  const bringItems = DAY_EVENT.bring
    .map((item) => `<li style="margin:0 0 7px;">${escapeHtml(item)}</li>`)
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #e1d5bd;border-radius:8px;background:#fffdf7;">
      <tr><td style="padding:18px 18px 8px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Day Quest</td><td style="padding:18px 18px 8px;">${escapeHtml(DAY_EVENT.date)} at ${escapeHtml(DAY_EVENT.time)}</td></tr>
      <tr><td style="padding:8px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Where</td><td style="padding:8px 18px;">${escapeHtml(DAY_EVENT.location)}</td></tr>
      <tr><td style="padding:8px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Arrival</td><td style="padding:8px 18px;">${escapeHtml(DAY_EVENT.arrival)}</td></tr>
      <tr><td style="padding:8px 18px 18px;width:116px;color:#654f36;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;">Note</td><td style="padding:8px 18px 18px;">${escapeHtml(DAY_EVENT.note)}</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #d8caa9;border-radius:8px;background:#f7f0df;">
      <tr><td style="padding:18px;"><h2 style="margin:0 0 8px;color:#4a3829;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.25;font-weight:700;">What to bring</h2><ul style="margin:0;padding-left:20px;color:#51483b;">${bringItems}</ul></td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0;border:1px solid #e1d5bd;border-radius:8px;background:#fffdf7;">
      <tr>
        <td style="padding:18px;">
          <h2 style="margin:0 0 8px;color:#4a3829;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.25;font-weight:700;">Before you arrive</h2>
          <p style="margin:0 0 12px;color:#51483b;">${escapeHtml(DAY_EVENT.preparation)}</p>
          <p style="margin:0;color:#51483b;">${escapeHtml(DAY_EVENT.phone)}</p>
        </td>
      </tr>
    </table>
  `;
}

function introSectionText() {
  return [
    INTRO_EVENT.title,
    INTRO_EVENT.directions,
    ""
  ].join("\n");
}

function daySectionText() {
  return [
    DAY_EVENT.title,
    `When: ${DAY_EVENT.date} at ${DAY_EVENT.time}`,
    `Where: ${DAY_EVENT.location}`,
    `Arrival: ${DAY_EVENT.arrival}`,
    DAY_EVENT.note,
    "",
    "What to bring:",
    ...DAY_EVENT.bring.map((item) => `- ${item}`),
    "",
    `Before you arrive: ${DAY_EVENT.preparation}`,
    DAY_EVENT.phone,
    ""
  ].join("\n");
}

function buildAdminEmail(registration, id, createdAt, env) {
  const subject = `New Wilderness Quest registration: ${registration.firstName} ${registration.lastName}`;
  const sessions = registration.sessions.join(" + ");

  return {
    from: env.FROM_EMAIL,
    to: env.ADMIN_EMAIL,
    reply_to: registration.email,
    subject,
    html: emailShell({
      eyebrow: "New registration",
      title: "Wilderness Quest registration",
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
              <p style="margin:0 0 6px;">Healthy Hour | Wilderness Quest 2026</p>
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
