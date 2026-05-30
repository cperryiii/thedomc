# thedomc

Static website for **The DOMC — The Discipline of Mental Coherence**.

- `/` — coming-soon landing
- `/vision-quest/` — full landing page for the Vision Quest series with Michele Angelini

Plain HTML + CSS, no build step. Hosted on GitHub Pages at `thedomc.org`.

## Local preview

Static server on the registered port (see `LOCAL_PORT_REGISTRY-claude.md` at the Projects root):

```bash
python -m http.server 8088 --bind 127.0.0.1
# then visit http://localhost:8088
```

Port 8088 is reserved for this project. Do not reassign without updating the registry.

## Deploy

GitHub Pages serves the repo root automatically. The `CNAME` file binds the site to `thedomc.org`.

See `DEPLOY.md` for first-time DNS setup at Namecheap and how to redirect the other 5 domains.

## File layout

```
thedomc/
├── index.html                  # The DOMC — coming soon
├── vision-quest/
│   └── index.html              # Vision Quest landing
├── assets/
│   ├── css/styles.css          # Shared design tokens + per-page themes
│   └── img/                    # Reserved for future imagery
├── CNAME                       # GitHub Pages custom-domain binding
├── README.md
├── DEPLOY.md
└── .gitignore
```

## Editing copy

Both pages are plain HTML. Headings, paragraphs, dates — all directly editable in the file. CSS lives in one place (`assets/css/styles.css`) and uses CSS custom properties so palette tweaks happen in one block per page theme (`.theme-domc`, `.theme-vq`).
