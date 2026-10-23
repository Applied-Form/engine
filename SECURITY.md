# Security policy

## Supported versions

The latest minor release receives security fixes. Earlier releases do not.

## Reporting a vulnerability

Report it privately through this repository's **Security** tab, using **Report a vulnerability**.
Do not open a public issue for a security problem.

Include the version, the command or MCP tool call that triggers it, and the smallest page or token
file that reproduces it. A report is acknowledged within five working days. A confirmed flaw gets a
fix, a release and a published advisory crediting the reporter, unless the reporter asks not to be
named.

## What Standards does that matters for security

Standards opens pages in a headless Chromium and reads what the browser rendered. That is its job,
and it is also its main exposure.

- **It renders a page it did not write, and that page's scripts run.** `standards lint`, `standards fix`, `standards drift`
  and the MCP server load whatever page they are given. Chromium runs without its operating-system
  sandbox, which is Playwright's default. Do not run Standards as a privileged user, and do not
  point it at an untrusted page you would not open in a browser on the same machine.
- **A page loaded from a file reads only its own directory and Standards' files.** The browser
  is started with `--allow-file-access-from-files` so local pages can load their stylesheets,
  fonts and modules. That flag would also let a page read any local file, so every `file://`
  request is checked: a page may read its own directory, the working directory and Standards'
  files, and nothing else. `test/confine.test.mjs` holds this.
- **The MCP server accepts HTML from a model.** `standards_lint` and `standards_drift` write a draft to a fresh
  temporary directory and render it from there. A draft may read that directory and Standards'
  files, and not the working directory, which is usually the person's project. A `url` the model
  supplies is loaded as given. `standards_fix` returns the page it fixed, so it takes `html` only and
  refuses a `url`: a url would let it return the full text of any file the server can read. Its
  draft gets the same roots as a `standards_lint` draft, and what it returns is the draft's own source
  with one appended style block.
- **Files it writes.** Reports, surveys and baselines are written only where a flag names them.
  `standards fix` writes `<name>.fixed.html` beside its input, or where `--out` names, and writes the
  input only when `--out` names it.
- **The evaluation harness calls model providers.** It reads API keys from the environment and
  never writes them to a record. It is a research tool, run from a clone, and is not part of the
  published package.

## Out of scope

- Findings about a page Standards linted. Those are the page's, not Standards'.
- The accuracy of an accessibility result. Standards is not an accessibility audit and says so in
  `docs/accessibility-scope.md`.
