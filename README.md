# aaryandesai.com — portfolio

Static site. No build step, no dependencies, no framework. Edit the HTML, push, done.

```
index.html              homepage: hero, project index, experience, capabilities, contact
assets/site.css         the entire design system (tokens at the top)
assets/*.png|.jpg       project images — see "Image slots" below
projects/*.html         one page per project
.nojekyll               tells GitHub Pages not to run Jekyll
```

## Deploy to GitHub Pages

```bash
cd ~/portfolio
git init -b main
git add -A
git commit -m "Portfolio site"
gh repo create aaryan-desai.github.io --public --source=. --push
```

The repo **must** be named `aaryan-desai.github.io` for a user site. It goes live at
`https://aaryan-desai.github.io` within a minute or two. If Pages doesn't turn on by
itself: repo Settings → Pages → Source: `Deploy from a branch` → `main` / `(root)`.

Every later change is just `git add -A && git commit -m "..." && git push`.

## Custom domain

1. Buy `aaryandesai.com` (Cloudflare Registrar and Namecheap are both fine, ~$12/yr).
2. At the registrar, add these DNS records:

   | Type  | Name  | Value                                            |
   |-------|-------|--------------------------------------------------|
   | A     | `@`   | `185.199.108.153`                                |
   | A     | `@`   | `185.199.109.153`                                |
   | A     | `@`   | `185.199.110.153`                                |
   | A     | `@`   | `185.199.111.153`                                |
   | CNAME | `www` | `aaryan-desai.github.io`                         |

3. `echo "aaryandesai.com" > CNAME`, then commit and push.
4. Settings → Pages → Custom domain → enter it → tick **Enforce HTTPS** once the cert issues
   (takes up to an hour).

## Image slots

Every `.plate-empty` block in a project page is a labelled slot. To fill one, replace:

```html
<div class="plate-empty">
  <span class="slot">Plate 1</span>
  <span class="hint">assets/vision-fixture.jpg</span>
</div>
```

with:

```html
<img src="../assets/vision-fixture.jpg" alt="Inspection fixture, datum scheme and sensor positions">
```

Keep the `<figcaption>` underneath either way. Images: export at ~1600px wide, JPG for
photos and renders, PNG for dashboards and screenshots. Always write a real `alt`.

### Shot list, highest value first

| Slot | File | Why it matters |
|------|------|----------------|
| Mars rover | `rover-demo.gif` | A 3–4s pick-and-place clip. Strongest single asset on the site. |
| PLC telemetry | `powerbi-cycle-dashboard.png` | The only proof of the data-viz half of your profile. |
| Vision inspection | `vision-fixture.jpg` | Proves mechanical design, not just integration. |
| Weld cell | `die-transfer-profile.png` | Before/after trace of 1.7s → 1.1s. Controls interviewers love this. |
| Weld cell | `weld-cell-layout.png` | Reach envelope and fixture placement. |
| Vision inspection | `vision-panel.jpg` | Control panel / relay schematic. |
| Material handling | `universal-eoat.png` | **Verify clearance before adding.** |

## Editing the design

All colors live as CSS custom properties in the first 60 lines of `assets/site.css`.
Change `--accent` in all three blocks (`:root`, the `prefers-color-scheme` block, and
`:root[data-theme="dark"]`) and the whole site follows.

## Adding a project

Copy any file in `projects/`, edit the content, then add an `.index-row` block to
`index.html` under `<div class="index-list">`. Tags are free text — `MECH`, `CTRL`,
`DATA`, `SW`, `ROBOTICS`, `SENSING`. `data-d="MECH"` is what tints a tag with the accent.

## Before you send the link

- [ ] Fill or delete every `.revnote` block — they are notes to you, not to recruiters.
- [ ] Fill or delete every `.plate-empty` slot. An empty slot reads worse than no figure.
- [ ] Update `Status` in the homepage title block each application season.
- [ ] Re-export `assets/AaryanDesai-Resume.pdf` when the résumé changes.
