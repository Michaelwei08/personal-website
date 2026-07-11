# cpwei.qzz.io

Personal website for Chupeng Wei, focused on selected AI, evaluation, and
scientific-software projects.

The site is static HTML and CSS. It is designed for deployment on Cloudflare
Pages with security headers defined in `_headers`.

Public pages:

- `/` - selected projects, internship direction, resume, and contact
- `/projects` - selected project archive with evidence and next steps
- `/resume` - privacy-reviewed public resume
- `/three-body` - interactive reading platform case study
- unknown routes - custom not-found page

## Local preview

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.
