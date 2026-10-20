# Tests

`npm test` runs everything: the server tests against an in-memory stand-in for Netlify Blobs, then the screen tests
in a real browser (Chromium, through Playwright) on a phone-sized and a desktop-sized window, against the local
desk server (`scripts/dev-server.mjs`) with stand-ins for Anthropic, Microsoft and Wix. Nothing real is called:
no email, no SharePoint, no Claude.

    npm test                 everything
    npm test -- server       the server tests only (no browser needed)
    npm test -- receipts     any suite whose file name contains "receipts"

The screen tests need Playwright and a Chromium. If Playwright is not installed in this folder, point at one:
`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs` and, for a browser Playwright did not install,
`CHROMIUM_PATH=/path/to/chrome`. Screenshots the screen tests take land next to them and are not kept in git.

The people in the test data are made up.
