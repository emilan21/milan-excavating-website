# Milan Excavating Website

Static website for Milan Excavating with Cloudflare deployment and hidden visitor analytics.

## Features

- **Static Site**: Simple HTML/CSS website hosted on Cloudflare Pages
- **Visitor Counter**: Tracks visits using Cloudflare KV (hidden from public view)
- **Admin Dashboard**: Private `/admin.html` page to view visitor statistics

## Project Structure

```
.
├── frontend/                  # Static website files
│   ├── index.html            # Main website
│   ├── admin.html            # Admin dashboard
│   ├── css/                  # Stylesheets
│   └── js/                   # JavaScript
│       └── track-visitors.js # Hidden visitor tracking
├── worker/                   # Cloudflare Worker for API
│   ├── index.js              # Visitor counter API
│   └── wrangler.toml         # Worker configuration
├── wrangler.toml             # Cloudflare Pages configuration
└── deploy.sh                 # Deployment script
```

## Setup

1. **Login to Cloudflare:**
   ```bash
   wrangler login
   ```

2. **Deploy the Worker:**
   ```bash
   cd worker
   wrangler deploy
   cd ..
   ```

3. **Deploy the Website:**
   ```bash
   ./deploy.sh
   ```

Or deploy manually:
```bash
wrangler pages deploy frontend
```

## GitHub Actions (Auto-Deploy)

Push to `master` and the site deploys automatically.

**Setup:**
1. Get Account ID: `wrangler whoami`
2. Create API Token at dash.cloudflare.com/profile/api-tokens
   - Permissions: `Cloudflare Pages:Edit`, `Account:Read`
3. Add GitHub Secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

## Viewing Stats

Visit: `milanexcavatingpa.com/admin.html`

## Custom Domain

Add your domain in the Cloudflare Dashboard under Pages > Custom Domains.
