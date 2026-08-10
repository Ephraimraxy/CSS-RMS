#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  CSS-RMS — InterServer VPS Initial Setup Script
#  Run ONCE as root on a fresh Ubuntu 22.04 VPS.
#  Usage:  bash server-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/var/www/cssrms"
REPO_URL="https://github.com/CssRms/RMS.git"
DOMAIN="cssgrouprms.com"
DB_NAME="cssrms"
DB_USER="cssrms_user"
LOG_DIR="/var/log/pm2"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${GREEN}══ $1 ${NC}"; }
note() { echo -e "${YELLOW}   ⚠  $1${NC}"; }

step "1/11  Update system packages"
apt-get update -qq
apt-get upgrade -y -qq

step "2/11  Install Node.js 20 (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
apt-get install -y nodejs
node -v && npm -v

step "3/11  Install PM2 globally"
npm install -g pm2
mkdir -p "$LOG_DIR"

step "4/11  Install PostgreSQL 15 (PGDG)"
apt-get install -y wget gnupg lsb-release
wget -qO - https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y postgresql-15
systemctl enable --now postgresql

step "5/11  Install Nginx + Certbot"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx

step "6/11  Create PostgreSQL database and user"
DB_PASS=$(openssl rand -hex 24)
sudo -u postgres psql <<SQL
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
echo ""
echo "  DATABASE_URL ready — copy this into your .env:"
echo "  DATABASE_URL=\"$DATABASE_URL\""
note "Save the DATABASE_URL above — you will need it in step 9."

step "7/11  Create deploy SSH user"
if ! id deploy &>/dev/null; then
  adduser --disabled-password --gecos "" deploy
  mkdir -p /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  touch /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys
  chown -R deploy:deploy /home/deploy/.ssh
fi
# Allow deploy user to restart PM2 via sudo without password
echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2, /usr/local/bin/pm2" \
  > /etc/sudoers.d/deploy-pm2
note "Add your deploy public SSH key to /home/deploy/.ssh/authorized_keys"
note "Generate a key pair: ssh-keygen -t ed25519 -C 'cssrms-deploy'"
note "Then copy the PUBLIC key into authorized_keys on this server."
echo ""
read -rp "  Press ENTER once authorized_keys is populated to continue..."

step "8/11  Clone repo and install dependencies"
mkdir -p "$APP_DIR"
chown deploy:deploy "$APP_DIR"
sudo -u deploy git clone "$REPO_URL" "$APP_DIR" || \
  sudo -u deploy bash -c "cd $APP_DIR && git pull origin main"
cd "$APP_DIR"
sudo -u deploy npm install --include=dev
sudo -u deploy bash -c "cd $APP_DIR/rms_frontend && npm install --legacy-peer-deps"

step "9/11  Configure environment (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s|DATABASE_URL=.*|DATABASE_URL=\"$DATABASE_URL\"|" "$APP_DIR/.env"
  note ".env created from .env.example."
  note "You MUST fill in: JWT_SECRET, R2 keys, email credentials, APP_BASE_URL, CORS_ORIGIN."
  note "Edit now:  nano $APP_DIR/.env"
  echo ""
  read -rp "  Press ENTER when you have finished editing .env to continue..."
fi

step "10/11  Restore database, build frontend, start PM2"
cd "$APP_DIR"

note "If you have a Railway database dump (.sql file), import it now BEFORE migrating:"
note "  psql $DATABASE_URL < /tmp/railway-backup.sql"
echo ""
read -rp "  Press ENTER to run Prisma migrations and start the app..."

sudo -u deploy bash -c "cd $APP_DIR && \
  npx prisma generate --schema=rms_backend/prisma/schema.prisma && \
  npx prisma migrate deploy --schema=rms_backend/prisma/schema.prisma"

sudo -u deploy bash -c "cd $APP_DIR/rms_frontend && npm run build"

sudo -u deploy bash -c "cd $APP_DIR && pm2 start ecosystem.config.js"
sudo -u deploy bash -c "pm2 save"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u deploy --hp /home/deploy
chown -R deploy:deploy "$APP_DIR"

step "11/11  Configure Nginx + SSL"
cp "$APP_DIR/nginx/cssrms.conf" /etc/nginx/sites-available/cssrms
ln -sf /etc/nginx/sites-available/cssrms /etc/nginx/sites-enabled/cssrms
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

note "Make sure your DNS A record for $DOMAIN points to this server's IP first!"
echo ""
read -rp "  Press ENTER to run Certbot for SSL (or Ctrl+C to do it manually)..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos \
  --email "hoseaephraim50@gmail.com" --redirect

systemctl reload nginx

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════"
echo "  ✓  CSS-RMS is live on https://$DOMAIN"
echo ""
echo "  Useful commands:"
echo "    pm2 logs cssrms       — live app logs"
echo "    pm2 status            — process status"
echo "    pm2 restart cssrms    — restart app"
echo "    nginx -t              — test nginx config"
echo -e "════════════════════════════════════════════════════${NC}"
echo ""
echo "Final steps:"
echo "  1. Add VPS_HOST, VPS_USER=deploy, VPS_SSH_KEY to GitHub Actions secrets"
echo "  2. Run 'Deploy to VPS' workflow from GitHub Actions to test auto-deploy"
echo "  3. Update DATABASE_URL GitHub secret to point to this VPS (for backups)"
echo ""
