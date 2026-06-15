# cpwei.qzz.io

Personal website for Chupeng Wei, focused on AI, healthcare, computational
genomics, medical imaging, and selected engineering projects.

The site is static HTML and CSS. It is designed for deployment on Cloudflare
Pages with security headers defined in `_headers`.

Public pages:

- `/` - research, projects, internship direction, and contact
- `/projects.html` - complete project archive with evidence and next steps
- `/resume.html` - privacy-reviewed public resume
- `/three-body.html` - interactive reading platform case study
- `/404.html` - custom not-found page

## Local preview

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.
