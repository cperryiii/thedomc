# Vision Quest Registration Backend

This Worker receives the `thedomc.org/vision-quest/` registration form, stores private registrations in Cloudflare D1, and sends registrant confirmations through Resend.

## Where registrations live

Fast admin URL:

https://vision-quest-registration.cperryiii.workers.dev/admin/

This path is protected by Cloudflare Access and only allows `cpiii@thedomc.org` and `mangelini3@gmail.com`.
Use the one-time PIN sent to the authorized email address.

Cloudflare Access configuration:

- Application: `Vision Quest Admin`
- Protected path: `vision-quest-registration.cperryiii.workers.dev/admin*`
- Allowed identity provider: One-time PIN
- Allowed emails: `cpiii@thedomc.org`, `mangelini3@gmail.com`
- Application session duration: `72h`
- Policy session duration: `72h`

The Worker also validates the Cloudflare Access JWT server-side and rejects any admin request whose verified email is not in the configured admin allowlist. This check is not client-side.

Cloudflare D1 database: `vision_quest_registrations`  
Table: `registrations`

Fallback Cloudflare dashboard path:

1. Log in to Cloudflare.
2. Open Workers & Pages.
3. Open D1 SQL Database.
4. Select `vision_quest_registrations`.
5. Use the Console / query view.

Useful query:

```sql
SELECT
  created_at,
  updated_at,
  first_name,
  last_name,
  email,
  sessions,
  email_status,
  last_confirmation_sent_at,
  resend_count
FROM registrations
ORDER BY created_at DESC;
```

## Duplicate behavior

Email address is the registration identity.

- New email: create a registration and send a confirmation.
- Existing email + new session: update the existing registration and send an updated confirmation.
- Existing email + no new sessions: do not create a duplicate and do not send email automatically.
- Existing email + resend request: resend the confirmation and increment `resend_count`.

Per-registration admin email notifications are currently disabled by `SEND_ADMIN_EMAIL = "false"` in `wrangler.toml`. Edit and remove notifications still go to `ADMIN_EMAIL`.

## Admin behavior

- `/admin/` shows active registrants.
- `/admin/export.csv` downloads a CSV export.
- Edit updates first name, last name, email, and session selection.
- Remove soft-archives a row by setting `archived_at`; it does not hard-delete the data.
- Registrations are labeled as `Intro Talk 1`, `Wilderness Quest #1`, or `Wilderness Quest #2` in the admin view and CSV export.
- Any edit or remove action sends an owner notification with the acting admin and changed values.
- Admin responses send `X-Robots-Tag: noindex, nofollow, noarchive` and are not linked from the public site.
