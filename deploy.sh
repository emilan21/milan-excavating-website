#!/bin/bash
# Deploy script for Milan Excavating Website

set -e

echo "======================================="
echo "  Milan Excavating - Deploy Script     "
echo "======================================="

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Error: wrangler CLI is not installed"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

# Deploy the visitor counter worker
echo ""
echo "======================================="
echo "  Deploying Visitor Counter Worker     "
echo "======================================="
cd worker
wrangler deploy
cd ..

# Deploy the static site to Cloudflare Pages
echo ""
echo "======================================="
echo "  Deploying Static Site to Pages       "
echo "======================================="
wrangler pages deploy frontend

echo ""
echo "======================================="
echo "  Deployment Complete!                 "
echo "======================================="
echo ""
echo "Main site: https://milanexcavatingpa.com"
echo "Admin dashboard: https://milanexcavatingpa.com/admin.html"
