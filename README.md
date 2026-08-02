# cpwei.qzz.io

Personal website for Chupeng Wei, focused on selected AI, evaluation, and
scientific-software projects.

The site is static HTML and CSS except for the isolated, client-side
Ultimate Tic-Tac-Toe route. It is designed for deployment on Cloudflare Pages
with security headers defined in `_headers`.

Public pages:

- `/` - selected projects, internship direction, resume, and contact
- `/projects` - selected project archive with evidence and next steps
- `/fun` - game hub for playable systems and upcoming titles
- `/resume` - privacy-reviewed public resume
- `/three-body` - interactive reading platform case study
- `/three-body/demo/` - public, pre-generated interactive reading demo
- `/ultimate-tic-tac-toe` - playable game against an on-device search bot
- unknown routes - custom not-found page

## Local preview

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.
