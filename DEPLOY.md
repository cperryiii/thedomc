# Deploy — thedomc.org

## 1. Create the GitHub repo

```bash
gh repo create cperryiii/thedomc --public --source=. --remote=origin --push
```

Or, if doing it manually:
1. Create empty repo `cperryiii/thedomc` on GitHub (no README, no .gitignore — the local repo already has them).
2. From this directory:
   ```bash
   git init -b main
   git add .
   git commit -m "Initial: DOMC coming-soon + Vision Quest landing"
   git remote add origin git@github.com:cperryiii/thedomc.git
   git push -u origin main
   ```

## 2. Enable GitHub Pages

In the repo: **Settings → Pages**
- **Source**: GitHub Actions
- **Custom domain**: `thedomc.org` (already set via the `CNAME` file in the repo root)
- Check **Enforce HTTPS** once the certificate is issued (takes a few minutes after DNS is correct).

The Pages workflow is `.github/workflows/pages.yml`. It packages only the public static site files and ignores Worker/admin-only changes so those commits do not consume Pages deploy runs.

## 3. Namecheap DNS — primary domain (thedomc.org)

In Namecheap's **Advanced DNS** for `thedomc.org`:

| Type   | Host | Value                                  | TTL  |
|--------|------|----------------------------------------|------|
| A      | @    | 185.199.108.153                        | Auto |
| A      | @    | 185.199.109.153                        | Auto |
| A      | @    | 185.199.110.153                        | Auto |
| A      | @    | 185.199.111.153                        | Auto |
| CNAME  | www  | cperryiii.github.io                    | Auto |

Delete any default Namecheap parking records (URL Redirect Record on `@`, the CNAME on `www` pointing at `parkingpage.namecheap.com`, etc).

Wait 5–60 minutes for propagation, then verify in GitHub Pages settings — the DNS check should turn green.

## 4. Namecheap — the other 5 domains (URL Redirect to thedomc.org)

For each of:
- `thedomc.com`
- `thedisciplineofmentalcoherence.org`
- `thedisciplineofmentalcoherence.com`
- `disciplineofmentalcoherence.org`
- `disciplineofmentalcoherence.com`

Use **Domain → Redirect Domain** in Namecheap (NOT DNS records).

| Source         | Destination        | Type      |
|----------------|--------------------|-----------|
| @  (root)      | https://thedomc.org | Permanent (301), Mask = OFF |
| www            | https://thedomc.org | Permanent (301), Mask = OFF |

"Permanent (301)" tells browsers + search engines to consolidate ranking on the primary. Leave masking OFF so the address bar actually changes to `thedomc.org` — keeps the canonical clean.

## 5. Verify

After DNS propagates:
- `https://thedomc.org` → coming-soon page
- `https://thedomc.org/vision-quest/` → Vision Quest landing
- `https://thedomc.com` → 301 → `https://thedomc.org`
- All other domains → 301 → `https://thedomc.org`

Tools: https://www.whatsmydns.net/ for global DNS checks; `curl -I https://thedomc.com` to confirm the 301 chain.

## Future

When ready to add real content:
- Add page images next to the page that uses them, unless a shared assets folder is reintroduced intentionally.
- Add additional pages as new folders (e.g., `/about/index.html`) and add those paths to `.github/workflows/pages.yml`.
- Add `sitemap.xml` and `robots.txt` when SEO matters
