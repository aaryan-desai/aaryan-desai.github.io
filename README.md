# aaryan-desai.github.io

Portfolio site. Static, no build step, no dependencies, no framework.
Edit the HTML, `git push`, it's live.

**Live:** https://aaryan-desai.github.io

```
index.html                  landing: about, experience timeline, skills, contact
work/index.html             project index — discipline matrix + filters
work/*.html                 one page per project (7)
assets/site.css             the entire design system; tokens in the first ~80 lines
assets/AaryanDesai-Resume.pdf
.nojekyll                   stops GitHub Pages running Jekyll
```

Pages is already enabled and serving from `main` / root. Every change is just:

```bash
git add -A && git commit -m "..." && git push
```

Preview locally with `python3 -m http.server 8080` from this directory — matches how
Pages serves it, including directory indexes.

## Design system

**Aenami "Lantern Glow"**, derived from the terminal palette in
`~/ubuntu-rice/aenami-theme/palette/aenami.json` (sampled from Alena Aenami's
*In Search of Peace*). Dark is the primary; the light theme is the same palette
inverted, with `base #0c1a24` becoming the ink.

Colours live only as custom properties at the top of `assets/site.css`, in three blocks
that must be edited together:

| Block | Covers |
|---|---|
| `:root` | light theme (also the default for `prefers-color-scheme: light`) |
| `@media (prefers-color-scheme: dark) > :root:not([data-theme="light"])` | system dark |
| `:root[data-theme="dark"]` | the toggle overriding either direction |

Token roles: `--signal` is the lantern (figures and metrics), `--accent` is cyan
(anything clickable), `--head` is the warm neutral (project titles), `--glow-a`/`--glow-b`
drive the hero luminosity gradient.

**Two constraints worth keeping.** Nothing goes below **15px** — the floor was raised
deliberately. And every colour pairing clears WCAG AA: body text ≥ 4.5:1, accents ≥ 3:1,
and text on a tinted wash needs its own `-on` token, because accent-on-its-own-wash
fails contrast every time.

## Adding a project

1. Copy any file in `work/` and rewrite the content. Keep the section spine:
   **Problem → Results → Approach**. Every page carries a `Status` cell in its title block.
2. Add an `.index-row` to `work/index.html` inside `<div class="index-list">`.
3. Set `data-tags` on the row to any of `MECH CTRL DATA SW`, and mirror it in the
   four-cell `.matrix` with `data-on="1"` on the ones that apply.
4. Bump the filter chip counts and the `entry-count` span.

## Image slots

Each `.plate-empty` is a labelled slot. Replace:

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

Keep the `<figcaption>`. Export ~1600px wide, JPG for photos and renders, PNG for
dashboards and screenshots. Always write a real `alt`.

### Shot list, highest value first

| Page | File | Why it matters |
|---|---|---|
| production-planning | `planning-queue.png` | The UI *is* the deliverable here, and it's currently only described |
| production-planning | `planning-runlist.png` | What the floor actually works from |
| plc-telemetry | `powerbi-cycle-dashboard.png` | The only proof of the data half of the profile |
| vision-inspection | `vision-fixture.jpg` | Proves mechanical design, not just integration |
| die-transfer | `die-transfer-profile.png` | Before/after trace of 1.7s → 1.1s |
| mars-rover | `rover-cad.png` | Plus a 3–4s pick-and-place GIF if any teammate has trial video |
| weld-cell | `weld-cell-layout.png` | Reach envelope and fixture placement |
| weld-cell | `die-components.png` | Die components and precision fixturing |
| vision-inspection | `vision-panel.jpg` | Control panel / relay schematic |
| tesla-internships | `universal-eoat.png` | **Verify clearance before adding** |

## Custom domain

1. Buy the domain (Cloudflare Registrar or Namecheap, ~$12/yr).
2. Add these DNS records at the registrar:

   | Type  | Name  | Value |
   |-------|-------|-------|
   | A     | `@`   | `185.199.108.153` |
   | A     | `@`   | `185.199.109.153` |
   | A     | `@`   | `185.199.110.153` |
   | A     | `@`   | `185.199.111.153` |
   | CNAME | `www` | `aaryan-desai.github.io` |

3. `echo "yourdomain.com" > CNAME`, commit, push.
4. Settings → Pages → Custom domain → enter it → tick **Enforce HTTPS** once the cert
   issues (up to an hour).

## Before sending the link

- [ ] Fill or delete all **6 `.revnote`** blocks — they are notes to you, not to recruiters.
      `grep -rn revnote work/`
- [ ] Fill or delete all **10 `.plate-empty`** slots. An empty slot reads worse than no figure.
- [ ] Confirm Tesla image clearance before adding `universal-eoat.png`.
- [ ] Verify the 2025–2026 date range on the planning tool page.
- [ ] Update `Status` in the landing title block each application season.
- [ ] **Graduation (May 2028):** remove `aaryand@andrew.cmu.edu` from the contact table in
      `index.html` — the address stops working and becomes a dead link on a live site.
- [ ] Re-export `assets/AaryanDesai-Resume.pdf` when the résumé changes.

## Notes

- The planning tool's source lives at `github.com/aa-desai/Production-Planning`, a separate
  account. The link is off the site until that repo is transferred here; add it back to the
  Status cell in `work/production-planning.html` once it is.
- `work/tesla-internships.html` is the one page not on the Problem/Results/Approach
  spine; it covers two internship terms, so it's organised by site instead.
