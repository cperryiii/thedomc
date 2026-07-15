# thedomc

Static website for **The DOMC — The Discipline of Mental Coherence**.

- `/` — coming-soon landing
- `/vision-quest/` — full landing page for the Vision Quest series with Michele Angelini

Plain HTML + CSS, no app build step. Hosted on GitHub Pages at `thedomc.org`.

## Local preview

Static server on the registered port (see `LOCAL_PORT_REGISTRY-claude.md` at the Projects root):

```bash
python -m http.server 8088 --bind 127.0.0.1
# then visit http://localhost:8088
```

Port 8088 is reserved for this project. Do not reassign without updating the registry.

## Deploy

GitHub Pages deploys with `.github/workflows/pages.yml`. The workflow only runs when public site files change:

- `index.html`
- `CNAME`
- `vision-quest/**`
- `.github/workflows/pages.yml`

Worker/admin changes under `workers/**` do not redeploy the public site. The `CNAME` file binds the site to `thedomc.org`.

See `DEPLOY.md` for first-time DNS setup at Namecheap and how to redirect the other 5 domains.

## File layout

```
thedomc/
├── index.html                  # The DOMC — coming soon
├── vision-quest/
│   ├── index.html              # Vision Quest landing
│   ├── vq.css
│   ├── vq.js
│   └── *.jpg, *.png            # Vision Quest page images + social preview
├── workers/
│   └── vision-quest-registration/
├── CNAME                       # GitHub Pages custom-domain binding
├── .github/workflows/pages.yml # Path-filtered GitHub Pages deploy
├── README.md
├── DEPLOY.md
└── .gitignore
```

## Editing copy

The homepage is a self-contained HTML file. The Vision Quest page uses `vision-quest/index.html`, `vision-quest/vq.css`, and `vision-quest/vq.js`. Headings, paragraphs, dates, and event copy are directly editable in the matching page files.
