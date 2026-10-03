---
name: audit-screenshot-traps
description: Traps when auditing dwfinance pages with Playwright screenshots (downscaled full-page images lie; signup writes to demo.db)
metadata:
  type: project
---
Full-page phone screenshots of the dashboard are 20,000+ px tall; when viewed they get downscaled so far that text looks wrong (e.g. "S$$3,019.50" that is really "S$3,019.50"). Confirm any visual "bug" with a viewport-sized clip or the DOM before reporting it.

**Why:** 2026-10-03 audit nearly reported a double-dollar bug that was a resize artifact.
**How to apply:** for audits, take viewport screenshots scrolled to each card (`scrollIntoViewIfNeeded`) and read text from `innerText`, not from the image.

Also: on the demo, `/signup` is live and creating an account writes to `prisma/demo.db`; an audit must not submit it. Unauthenticated `/login` on the demo redirects to `/demo` (auto sign-in), so it never shows a form.
