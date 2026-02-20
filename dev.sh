#!/bin/bash

# Development server startup script for milanexcavatingpa.com
# This starts both the Pages dev server and the Worker API

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}=== Milan's Excavating Website - Development Server ===${NC}"
echo ""

# Step 1: Install test requirements
echo -e "${BLUE}Step 1: Installing test requirements...${NC}"
bash "$SCRIPT_DIR/test/requirements.sh"
echo -e "${GREEN}✓ Test requirements installed${NC}"
echo ""

# Step 2: Run HTML validation tests (if htmlproofer is available and working)
echo -e "${BLUE}Step 2: Running HTML validation tests...${NC}"
if command -v htmlproofer &> /dev/null; then
    bash "$SCRIPT_DIR/test/htmlproofer.sh"
    HTMLPROOFER_EXIT=$?
    if [ $HTMLPROOFER_EXIT -ne 0 ]; then
        echo -e "${YELLOW}⚠ HTML validation tests failed or had issues${NC}"
        echo -e "${YELLOW}  Continuing anyway (this is non-critical)${NC}"
    else
        echo -e "${GREEN}✓ HTML validation tests passed${NC}"
    fi
else
    echo -e "${YELLOW}⚠ htmlproofer not available - skipping HTML validation${NC}"
fi
echo ""

# Step 3: Check if wrangler is installed
echo -e "${BLUE}Step 3: Checking wrangler installation...${NC}"
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}Wrangler not found. Installing...${NC}"
    npm install -g wrangler
fi
echo -e "${GREEN}✓ Wrangler is installed${NC}"
echo ""

# Step 4: Check if user is logged in
echo -e "${BLUE}Step 4: Checking Cloudflare login...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Please login to Cloudflare first:${NC}"
    wrangler login
fi
echo -e "${GREEN}✓ Logged into Cloudflare${NC}"
echo ""

# Step 5: Start development servers
echo -e "${BLUE}Step 5: Starting development servers...${NC}"
echo ""
echo -e "${YELLOW}Services will be available at:${NC}"
echo "  - Website:    http://localhost:8000"
echo "  - Worker API: http://localhost:8787"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo ""

# Start the Worker in the background
echo -e "${BLUE}Starting Worker API on port 8787...${NC}"
wrangler dev worker/index.js --port=8787 &
WORKER_PID=$!

# Wait a moment for worker to start
sleep 2

# Start the Pages dev server
echo -e "${BLUE}Starting Pages dev server on port 8000...${NC}"
wrangler pages dev frontend --port=8000 --compatibility-date=2024-01-01 &
PAGES_PID=$!

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down development servers...${NC}"
    kill $WORKER_PID 2>/dev/null || true
    kill $PAGES_PID 2>/dev/null || true
    exit 0
}

# Trap Ctrl+C and cleanup
trap cleanup INT TERM

# Wait for both processes
wait
