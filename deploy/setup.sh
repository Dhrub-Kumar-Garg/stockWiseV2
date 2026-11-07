#!/bin/bash
# Oracle Cloud Setup Script for StockWise V2
# Run this script with sudo: sudo bash deploy/setup.sh

set -e

# 1. Update and install dependencies
echo "Updating packages..."
apt-get update
apt-get upgrade -y
apt-get install -y curl ufw iptables-persistent

# Create a 2GB swap file to prevent Out of Memory errors on 1GB RAM Free Tier instances
if [ ! -f /swapfile ]; then
    echo "Creating 2GB swap file..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
fi
# 2. Install Node.js 22.x
if ! command -v node &> /dev/null
then
    echo "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

# 3. Open port 3002 in Ubuntu Firewall (UFW)
echo "Configuring firewall..."
ufw allow ssh
ufw allow 3002/tcp
ufw --force enable

# Also use iptables for Oracle Cloud specific default rules
iptables -I INPUT -6 -m state --state NEW -p tcp --dport 3002 -j ACCEPT || true
iptables -I INPUT -m state --state NEW -p tcp --dport 3002 -j ACCEPT || true
netfilter-persistent save

# 4. Install NPM dependencies
echo "Installing project dependencies..."
# Assumes we are in the fabinvest directory
npm install

echo "Installing web dependencies and building..."
cd web
npm install
npx next build
cd ..

# 5. Setup systemd services and environment
echo "Setting up environment and systemd services..."

# Get current absolute path of the fabinvest directory
PROJECT_DIR=$(pwd)
USER=$(whoami)
# If run with sudo, USER might be root. We want the original user (e.g., ubuntu)
if [ "$SUDO_USER" != "" ]; then
    USER=$SUDO_USER
fi

# Ensure .env file exists with a secure dashboard token
if [ ! -f "${PROJECT_DIR}/.env" ]; then
    echo "Creating .env configuration..."
    RANDOM_TOKEN=$(openssl rand -hex 24)
    cat > "${PROJECT_DIR}/.env" << EOL
STOCKWISE_DASHBOARD_TOKEN=${RANDOM_TOKEN}
STOCKWISE_TELEGRAM_ENABLED=false
STOCKWISE_ANALYST_ENABLED=false
EOL
    chown ${USER}:${USER} "${PROJECT_DIR}/.env"
    chmod 600 "${PROJECT_DIR}/.env"
fi

# Create Engine Service
cat > /etc/systemd/system/stockwise-engine.service << EOL
[Unit]
Description=StockWise V2 Engine
After=network.target

[Service]
ExecStart=/usr/bin/node scripts/v2/engine.mjs --paper
WorkingDirectory=${PROJECT_DIR}
StandardOutput=syslog
StandardError=syslog
Restart=always
RestartSec=5
User=${USER}
Environment=NODE_ENV=production
EnvironmentFile=${PROJECT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOL

# Create Dashboard Service
cat > /etc/systemd/system/stockwise-dashboard.service << EOL
[Unit]
Description=StockWise V2 Dashboard
After=network.target

[Service]
ExecStart=/usr/bin/npm run start -- -p 3002
WorkingDirectory=${PROJECT_DIR}/web
StandardOutput=syslog
StandardError=syslog
Restart=always
RestartSec=5
User=${USER}
Environment=NODE_ENV=production
EnvironmentFile=${PROJECT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOL

# 6. Enable and start services
echo "Enabling and starting services..."
systemctl daemon-reload
systemctl enable stockwise-engine
systemctl enable stockwise-dashboard
systemctl restart stockwise-engine
systemctl restart stockwise-dashboard

DASHBOARD_TOKEN=$(grep -E '^STOCKWISE_DASHBOARD_TOKEN=' "${PROJECT_DIR}/.env" | cut -d '=' -f2-)

echo "========================================="
echo "Setup Complete!"
echo "Dashboard is running on port 3002."
echo "Your Dashboard Access Token:"
echo "  ${DASHBOARD_TOKEN}"
echo "========================================="
echo "Check engine logs with: sudo journalctl -u stockwise-engine -f"
echo "Check dashboard logs with: sudo journalctl -u stockwise-dashboard -f"
echo "========================================="
