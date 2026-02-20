#!/bin/bash

# Colors for output
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Install Ruby if not present (required for html-proofer)
if ! command -v ruby &> /dev/null; then
    echo -e "${YELLOW}Ruby not found. Installing Ruby...${NC}"
    
    # Detect OS and install Ruby
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            # Debian/Ubuntu
            sudo apt-get update && sudo apt-get install -y ruby-full
        elif command -v yum &> /dev/null; then
            # RHEL/CentOS/Fedora
            sudo yum install -y ruby
        elif command -v pacman &> /dev/null; then
            # Arch Linux
            sudo pacman -S ruby
        else
            echo "Could not detect package manager. Please install Ruby manually."
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install ruby
        else
            echo "Homebrew not found. Please install Ruby manually or install Homebrew first."
            exit 1
        fi
    else
        echo "Unsupported OS. Please install Ruby manually."
        exit 1
    fi
fi

# Now install html-proofer
echo "Installing html-proofer..."
gem install html-proofer

# Install npm packages
echo "Installing http-server..."
npm install http-server -g

echo "Installing cypress..."
npm install cypress --save-dev

echo -e "${GREEN}Requirements installation complete${NC}"
