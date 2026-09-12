# Milan Excavating Website

The website is static HTML hosted by Cloudflare Pages at `milanexcavatingpa.com` and `www.milanexcavatingpa.com`.

Cloudflare Web Analytics measures page views and Web Vitals. It is enabled on the `milan-excavating-site` Pages project with automatic beacon injection, so the repository contains no analytics JavaScript, visitor API, database, or admin dashboard. Analytics are available in the Cloudflare dashboard after Cloudflare's processing delay.

## Local development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

The site is served at <http://localhost:8000>. Cloudflare does not inject its analytics beacon during local development.

## Checks

Run the browser tests against a local static server:

```bash
python3 -m http.server 8000 --directory frontend
npm run test:e2e
```

HTML validation runs in GitHub Actions with `htmlproofer`.

## Deployment

The production GitHub environment needs only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The API token must be able to deploy the existing Pages project.

```bash
npm run deploy
```

GitHub Actions runs Cypress and HTML validation before deploying `frontend/` to the `milan-excavating-site` Pages project. Keep automatic Web Analytics beacon injection enabled in Cloudflare; production responses should contain `beacon.min.js`, and browsers submit measurements to `/cdn-cgi/rum`.
