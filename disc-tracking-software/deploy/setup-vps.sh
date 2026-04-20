#!/usr/bin/env bash
# ============================================================
# FlightIQ VPS Deployment Script
# Tested on Ubuntu 22.04+ / Debian 12+
#
# Usage:
#   chmod +x deploy/setup-vps.sh
#   sudo ./deploy/setup-vps.sh
#
# Prerequisites: SSH into your VPS as root or a sudo user.
# ============================================================

set -euo pipefail

DOMAIN="flightiq.pro"               # ← Change to your domain
APP_DIR="/opt/flightiq"
REPO_URL="https://github.com/YOUR_USER/disc-tracking-software.git"  # ← Your repo
NODE_VERSION="22"                    # LTS
GO_VERSION="1.24.2"                  # Match your go.mod

echo "==> Installing system dependencies..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git build-essential ufw

# ---- Firewall ----
echo "==> Configuring UFW firewall..."
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# ---- Node.js ----
echo "==> Installing Node.js ${NODE_VERSION}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs
npm install -g pm2

# ---- Go ----
echo "==> Installing Go ${GO_VERSION}..."
curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf /tmp/go.tar.gz
rm /tmp/go.tar.gz
export PATH=$PATH:/usr/local/go/bin
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile.d/go.sh

# ---- Clone / Pull Repo ----
echo "==> Setting up application directory..."
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/project2/disc-tracking-software"

# ---- Environment File ----
if [ ! -f .env.local ]; then
  echo "==> Creating .env.local template..."
  cat > .env.local <<'ENVEOF'
# --- Production Environment ---
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://flightiq.pro/api/v1
NEXT_PUBLIC_APP_URL=https://flightiq.pro

# Auth (generate: openssl rand -base64 32)
AUTH_SECRET=CHANGE_ME
JWT_SECRET=CHANGE_ME

# Neon PostgreSQL
DATABASE_URL=postgresql://USER:PASS@HOST/DB?sslmode=require

# Go backend
GIN_MODE=release
ALLOWED_ORIGINS=https://flightiq.pro
ENVEOF
  echo ""
  echo "  *** EDIT .env.local WITH YOUR REAL SECRETS BEFORE CONTINUING ***"
  echo "  nano ${APP_DIR}/project2/disc-tracking-software/.env.local"
  echo ""
  read -rp "Press Enter after editing .env.local..."
fi

# ---- Build Next.js ----
echo "==> Installing Node dependencies & building Next.js..."
npm ci --omit=dev
npm run build

# ---- Build Go Backend ----
echo "==> Building Go backend..."
cd app/api/go
go build -o disc-tracking .
cd ../../..

# ---- Create log directory ----
mkdir -p logs

# ---- Start with PM2 ----
echo "==> Starting services with PM2..."
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Auto-start on reboot
pm2 startup systemd -u root --hp /root
pm2 save

# ---- Caddy (recommended) or NGINX ----
echo ""
echo "==> Choose your reverse proxy:"
echo "    1) Caddy  (auto-HTTPS, recommended)"
echo "    2) NGINX  (manual certbot setup)"
echo ""
read -rp "Enter 1 or 2: " PROXY_CHOICE

if [ "$PROXY_CHOICE" = "1" ]; then
  echo "==> Installing Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy

  cp deploy/Caddyfile /etc/caddy/Caddyfile
  sed -i "s/flightiq.pro/${DOMAIN}/g" /etc/caddy/Caddyfile
  systemctl restart caddy
  systemctl enable caddy
  echo "==> Caddy is running. TLS certificates will be provisioned automatically."

elif [ "$PROXY_CHOICE" = "2" ]; then
  echo "==> Installing NGINX + Certbot..."
  apt-get install -y nginx certbot python3-certbot-nginx

  cp deploy/nginx.conf /etc/nginx/sites-available/flightiq
  sed -i "s/flightiq.pro/${DOMAIN}/g" /etc/nginx/sites-available/flightiq
  ln -sf /etc/nginx/sites-available/flightiq /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default

  # Test config before reloading
  nginx -t
  systemctl restart nginx
  systemctl enable nginx

  echo "==> Obtaining TLS certificate..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@${DOMAIN}"
  echo "==> NGINX + Certbot configured."
fi

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "  App:  https://${DOMAIN}"
echo "  API:  https://${DOMAIN}/api/v1"
echo ""
echo "  PM2 commands:"
echo "    pm2 status          # check processes"
echo "    pm2 logs            # tail logs"
echo "    pm2 restart all     # restart both"
echo "    pm2 monit           # live dashboard"
echo "============================================"
