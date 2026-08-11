# CSS-RMS VPS Management Guide

**Server:** InterServer KVM VPS · Ubuntu 24.04 LTS  
**IP:** `162.35.183.2`  
**Domain:** `rms.cssgrouprms.com`  
**Monthly cost:** $3/month (flat rate — no usage surprises)  
**Purpose:** Production hosting for CSS-RMS, parallel to Railway deployment at `cssgrouprms.com`

---

## Table of Contents

1. [Server Information & Credentials](#1-server-information--credentials)
2. [Connecting to the Server](#2-connecting-to-the-server)
3. [Understanding the Server Layout](#3-understanding-the-server-layout)
4. [App Management with PM2](#4-app-management-with-pm2)
5. [Environment Variables (.env)](#5-environment-variables-env)
6. [Deploying New Code](#6-deploying-new-code)
7. [Database Management (PostgreSQL)](#7-database-management-postgresql)
8. [Nginx Web Server Management](#8-nginx-web-server-management)
9. [SSL Certificate Management](#9-ssl-certificate-management)
10. [Server Health Monitoring](#10-server-health-monitoring)
11. [Log Management](#11-log-management)
12. [Firewall & Security](#12-firewall--security)
13. [File Transfer (Upload & Download)](#13-file-transfer-upload--download)
14. [Backup & Restore](#14-backup--restore)
15. [PM2.io Web Monitoring Dashboard](#15-pm2io-web-monitoring-dashboard)
16. [Emergency Troubleshooting](#16-emergency-troubleshooting)
17. [Quick Reference — All Commands](#17-quick-reference--all-commands)

---

## 1. Server Information & Credentials

### Server Details

| Item | Value |
|------|-------|
| Provider | InterServer |
| Plan | KVM VPS Slice |
| IP Address | `162.35.183.2` |
| Operating System | Ubuntu 24.04.4 LTS |
| Domain | `rms.cssgrouprms.com` |
| DNS | Cloudflare (A record → 162.35.183.2, orange cloud proxy) |
| Cloudflare SSL Mode | Full (accepts self-signed cert on origin) |

### Login Credentials

| User | Password | Used For |
|------|----------|----------|
| `root` | `7$ABUqpZ` | Full server control via SSH |
| `deploy` | `CssGroup@2026` | VNC desktop login, app ownership |

### App Details

| Item | Value |
|------|-------|
| App directory | `/var/www/cssrms/` |
| Config file | `/var/www/cssrms/.env` |
| PM2 app name | `cssrms` |
| App port | `3000` (internal only — Nginx proxies traffic) |
| GitHub repo | `https://github.com/Ephraimraxy/CSS-RMS.git` |
| PM2.io link key | `f5s06168ekh762y zeqveuct451og8y` |

---

## 2. Connecting to the Server

### Method A — SSH from Windows (PowerShell or VS Code Terminal)

This is the recommended method for everyday management.

**Step 1:** Open PowerShell or the VS Code terminal (press `Ctrl + Backtick`)

**Step 2:** Type the SSH command:
```bash
ssh root@162.35.183.2
```

**Step 3:** First time only — it asks:
```
Are you sure you want to continue connecting (yes/no)?
```
Type `yes` and press Enter.

**Step 4:** Enter the password when asked:
```
root@162.35.183.2's password:
```
Type `7$ABUqpZ` — nothing appears as you type, that is normal. Press Enter.

**Step 5:** You are now logged in. You will see:
```
root@vps3547778:~#
```

**To disconnect:**
```bash
exit
```
Or press `Ctrl + D`.

---

### Method B — SSH from Mac or Linux Terminal

Open Terminal and run:
```bash
ssh root@162.35.183.2
```
Same steps as Method A above.

---

### Method C — VS Code SSH Extension (Persistent Connection)

VS Code can stay permanently connected so you can browse server files and edit them visually.

**Step 1:** Install the "Remote - SSH" extension in VS Code (search in Extensions sidebar).

**Step 2:** Press `Ctrl + Shift + P` → search "Remote-SSH: Connect to Host" → click it.

**Step 3:** Type `root@162.35.183.2` and press Enter.

**Step 4:** Enter password `7$ABUqpZ`.

**Step 5:** VS Code opens on the server. You can now open `/var/www/cssrms/` as a folder and edit `.env` visually.

---

### Method D — VNC Browser Desktop (Backup Method)

Use this if you cannot SSH (e.g. on a phone, or SSH is blocked on a network).

**Step 1:** Go to [my.interserver.net](https://my.interserver.net) and log in.

**Step 2:** Click your VPS → click **View Desktop** (opens a browser tab with a Linux desktop).

**Step 3:** At the VNC login screen:
- Username: `deploy`
- Password: `CssGroup@2026`

**Step 4:** Right-click the desktop → **Open Terminal Emulator**.

**Step 5:** To get root access inside VNC terminal:
```bash
su -
```
Enter root password `7$ABUqpZ` when asked.

> **Note:** VNC is slower than SSH. Use SSH for all regular management. VNC is only a backup.

---

## 3. Understanding the Server Layout

### Directory Structure

```
/var/www/cssrms/              ← App root (everything lives here)
├── .env                      ← Environment variables (secrets)
├── serve.js                  ← Main Node.js server file
├── ecosystem.config.js       ← PM2 configuration
├── start.sh                  ← PM2 startup wrapper (sources .env)
├── package.json
├── rms_backend/
│   └── prisma/
│       └── schema.prisma     ← Database schema
└── rms_frontend/
    └── dist/                 ← Built React app (served by Nginx)

/etc/nginx/sites-available/cssrms   ← Nginx site configuration
/var/log/pm2/                        ← PM2 log files
/var/log/nginx/                      ← Nginx log files
/etc/ssl/certs/cssrms-selfsigned.crt ← SSL certificate
/etc/ssl/private/cssrms-selfsigned.key ← SSL private key
```

### Running Services

| Service | What It Does | How to Check |
|---------|-------------|--------------|
| `pm2` (cssrms) | Runs the Node.js app on port 3000 | `pm2 status` |
| `nginx` | Handles HTTPS traffic, proxies to port 3000 | `systemctl status nginx` |
| `postgresql` | Database server | `systemctl status postgresql` |

### How Traffic Flows

```
Browser
  → Cloudflare (adds HTTPS, hides your IP)
    → Nginx on port 443 (your VPS)
      → Node.js app on port 3000 (internal only)
        → PostgreSQL database
```

---

## 4. App Management with PM2

PM2 is the process manager that keeps your Node.js app running 24/7. It automatically restarts the app if it crashes, and starts it again when the server reboots.

### Check App Status

```bash
pm2 status
```

**What to look for:**
- `online` (green) = app is running normally ✓
- `stopped` = app was manually stopped
- `errored` = app crashed — run `pm2 logs cssrms` to see why

```bash
pm2 list
```
Same as `pm2 status` with a slightly different layout.

---

### View Live Logs

```bash
pm2 logs cssrms
```

Shows live streaming logs (new log lines appear as users make requests). Press `Ctrl + C` to stop watching.

```bash
pm2 logs cssrms --lines 50
```

Shows the last 50 lines, then streams new ones. Useful to see recent history.

```bash
pm2 logs cssrms --nostream
```

Shows the last lines without streaming. Useful for quick checks.

```bash
pm2 logs cssrms --err
```

Shows only error logs (ignores regular output).

---

### Restart the App

```bash
pm2 restart cssrms
```

Restarts the app with zero downtime — the old process keeps serving while the new one starts up. **Use this every time you edit `.env`.**

```bash
pm2 reload cssrms
```

Graceful reload — waits for ongoing requests to finish before restarting. Use for production restarts.

---

### Stop and Start the App

```bash
pm2 stop cssrms       # stop the app (site goes down)
pm2 start cssrms      # start it again
```

---

### Delete and Re-add from Config

If the process is missing or in a broken state:
```bash
pm2 delete cssrms
pm2 start /var/www/cssrms/ecosystem.config.js
pm2 save
```

---

### Live CPU and Memory Monitor

```bash
pm2 monit
```

Opens an interactive terminal dashboard showing CPU usage, memory, and log stream in real time. Press `Ctrl + C` or `q` to exit.

---

### Save PM2 Process List (Survive Reboots)

```bash
pm2 save
```

Saves the current list of running processes so they automatically restart when the server reboots. Run this after any change to the process list.

---

### Check PM2 Startup Service

```bash
pm2 startup
```

Shows the command needed to make PM2 start on boot. This is already configured — run it only if you reinstall Node.js or PM2.

---

### Flush (Clear) All Logs

```bash
pm2 flush cssrms
```

Clears the log files for the `cssrms` app. Use this if logs are taking up too much disk space.

```bash
pm2 flush
```

Clears logs for ALL PM2 apps.

---

### Show Detailed App Info

```bash
pm2 show cssrms
```

Shows all configuration details: script path, PID, uptime, restart count, memory, CPU, log file paths.

---

### View PM2 Configuration File

```bash
cat /var/www/cssrms/ecosystem.config.js
```

The current ecosystem config looks like this:
```javascript
module.exports = {
  apps: [{
    name: 'cssrms',
    script: '/var/www/cssrms/start.sh',
    interpreter: '/bin/bash',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '400M',
    exp_backoff_restart_delay: 100,
    env: { NODE_ENV: 'production', PORT: 3000 },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/pm2/cssrms-error.log',
    out_file: '/var/log/pm2/cssrms-out.log',
    merge_logs: true,
  }],
};
```

> **Why `start.sh` instead of `serve.js` directly?** PM2 only sets `NODE_ENV` and `PORT` from ecosystem.config.js. All other environment variables (database URL, JWT secrets, etc.) need to be loaded from `.env`. The `start.sh` wrapper sources the `.env` file before starting Node.js, so all variables are available to the app.

---

### View the start.sh Wrapper

```bash
cat /var/www/cssrms/start.sh
```

Contents:
```bash
#!/bin/bash
set -a
source /var/www/cssrms/.env
set +a
exec node /var/www/cssrms/serve.js
```

---

## 5. Environment Variables (.env)

The `.env` file is equivalent to Railway's Variables tab. It stores all secrets: database URL, JWT secret, email credentials, API keys, etc.

**File location:** `/var/www/cssrms/.env`

> **Important:** After any change to `.env`, you must restart the app: `pm2 restart cssrms`

---

### View All Variables (Read Only)

```bash
cat /var/www/cssrms/.env
```

Shows all variables in plain text.

---

### Open the File to Edit (Nano Editor)

```bash
nano /var/www/cssrms/.env
```

**Inside nano — keyboard shortcuts:**

| Key | Action |
|-----|--------|
| Arrow keys | Move cursor |
| `Ctrl + W` | Search for text (type variable name, press Enter) |
| `Ctrl + K` | Cut the current line |
| `Ctrl + U` | Paste cut line |
| `Ctrl + O` then `Enter` | **Save** the file |
| `Ctrl + X` | **Close** nano |

**After saving:** always restart the app:
```bash
pm2 restart cssrms
```

---

### Open with VS Code (if using VS Code SSH)

If you connected VS Code via Remote-SSH:
1. Open the file explorer (Ctrl+Shift+E)
2. Navigate to `/var/www/cssrms/`
3. Click `.env`
4. Edit, save (Ctrl+S)
5. In the terminal: `pm2 restart cssrms`

---

### Change One Variable Without Opening the File

```bash
# Syntax: sed -i 's|VARIABLE_NAME=.*|VARIABLE_NAME="new-value"|' /var/www/cssrms/.env
# Then restart:

# Example — change email password:
sed -i 's|EMAIL_PASS=.*|EMAIL_PASS="newpassword123"|' /var/www/cssrms/.env
pm2 restart cssrms
```

---

### Add a New Variable

```bash
# Append to bottom of .env
echo 'NEW_VARIABLE="value-here"' >> /var/www/cssrms/.env
pm2 restart cssrms
```

---

### Delete a Variable

```bash
# Remove the line containing the variable name
sed -i '/^VARIABLE_NAME=/d' /var/www/cssrms/.env
pm2 restart cssrms
```

---

### Search for a Specific Variable

```bash
grep 'JWT_SECRET' /var/www/cssrms/.env
grep 'DATABASE_URL' /var/www/cssrms/.env
grep 'VAPID' /var/www/cssrms/.env
```

---

### Verify a Variable Is Loaded by the App

```bash
# Test that the variable is actually available to the running app
sudo -u deploy bash -c 'set -a; source /var/www/cssrms/.env; set +a; node -e "console.log(process.env.JWT_SECRET)"'
```

Replace `JWT_SECRET` with the variable name you want to check.

---

### Current .env Variables Reference

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs user login tokens |
| `APP_BASE_URL` | `https://rms.cssgrouprms.com` |
| `CORS_ORIGIN` | `https://rms.cssgrouprms.com` |
| `VAPID_PUBLIC_KEY` | Web push notifications |
| `VAPID_PRIVATE_KEY` | Web push notifications |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `EMAIL_*` | Email sending credentials |
| `TWILIO_*` | SMS notifications (needs real credentials) |
| `TERMII_*` | SMS notifications Nigeria (needs real credentials) |

---

## 6. Deploying New Code

### Method A — GitHub Actions (Recommended)

This is fully automated — one click deploys new code.

**Step 1:** Go to [github.com/Ephraimraxy/CSS-RMS](https://github.com/Ephraimraxy/CSS-RMS)

**Step 2:** Click the **Actions** tab at the top.

**Step 3:** On the left sidebar, click **"Deploy to VPS (InterServer)"**.

**Step 4:** Click the **"Run workflow"** button (top right of the workflow list).

**Step 5:** Select branch `main` → click **"Run workflow"**.

**Step 6:** Watch the progress. Green checkmark = success. Red X = something failed, click it to see the error.

> **Setup required:** For GitHub Actions to work, you need 3 secrets in GitHub → Settings → Secrets and variables → Actions → New repository secret:
> - `VPS_HOST` = `162.35.183.2`
> - `VPS_USER` = `deploy`
> - `VPS_SSH_KEY` = your SSH private key (generate with `ssh-keygen -t ed25519`)

---

### Method B — Manual Deploy via SSH

SSH into the server, then:

```bash
# Go to app directory
cd /var/www/cssrms

# Pull latest code from GitHub
git fetch origin main
git reset --hard origin/main

# Install any new dependencies
npm install --include=dev

# Install frontend dependencies if package.json changed
cd rms_frontend && npm install --legacy-peer-deps && cd ..

# Run database migrations if schema changed
DATABASE_URL=$(grep 'DATABASE_URL' .env | cut -d'"' -f2) \
  npx prisma migrate deploy --schema=rms_backend/prisma/schema.prisma

# Rebuild the React frontend
cd rms_frontend && npm run build && cd ..

# Restart the app
pm2 restart cssrms

# Check it's running
pm2 status
pm2 logs cssrms --lines 20 --nostream
```

---

### Method C — Copy a Single File

If you only changed one file and want to apply it without a full deploy:

```bash
# Edit the file directly on the server
nano /var/www/cssrms/serve.js
pm2 restart cssrms
```

Or from your local machine, use SCP to upload a file:
```bash
# From Windows PowerShell (uploads local file to server)
scp "C:\Users\USER\Downloads\Pro-RMS\serve.js" root@162.35.183.2:/var/www/cssrms/serve.js
```
Then SSH in and run `pm2 restart cssrms`.

---

### Running Database Migrations

Only needed when the database schema (`schema.prisma`) changes:

```bash
cd /var/www/cssrms

# Method 1 — inline DATABASE_URL
DATABASE_URL=$(grep 'DATABASE_URL' .env | cut -d'"' -f2) \
  npx prisma migrate deploy --schema=rms_backend/prisma/schema.prisma

# Method 2 — source .env first
set -a; source .env; set +a
npx prisma migrate deploy --schema=rms_backend/prisma/schema.prisma
```

---

## 7. Database Management (PostgreSQL)

The database is PostgreSQL 15 running locally on the server. It stores all app data: users, requisitions, budgets, approvals, etc.

### Database Credentials

| Item | Value |
|------|-------|
| Database name | `cssrms` |
| Database user | `cssrms_user` |
| Host | `localhost` (internal only) |
| Port | `5432` |
| Full URL | See `DATABASE_URL` in `/var/www/cssrms/.env` |

---

### Connect to Database Shell

```bash
sudo -u postgres psql cssrms
```

You enter the `psql` shell. Prompt changes to `cssrms=#`.

**Common psql commands:**

| Command | What It Does |
|---------|-------------|
| `\dt` | List all tables |
| `\d "User"` | Show columns in the User table |
| `\q` | Quit / exit the shell |
| `\l` | List all databases |
| `\du` | List all database users |

---

### Run a Quick Query Without Entering Shell

```bash
# Count total users
sudo -u postgres psql cssrms -c 'SELECT COUNT(*) FROM "User";'

# Count requisitions by status
sudo -u postgres psql cssrms -c 'SELECT status, COUNT(*) FROM "Requisition" GROUP BY status;'

# View recent users
sudo -u postgres psql cssrms -c 'SELECT id, email, "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 5;'

# Count all tables
sudo -u postgres psql cssrms -c "\dt" | wc -l
```

---

### Check Database Service Status

```bash
systemctl status postgresql
systemctl is-active postgresql   # outputs "active" if running
```

---

### Start / Stop / Restart PostgreSQL

```bash
systemctl restart postgresql
systemctl stop postgresql
systemctl start postgresql
```

> **Warning:** Stopping PostgreSQL takes the app's database offline. The app will crash. Always restart immediately.

---

### Check Database Size

```bash
sudo -u postgres psql cssrms -c "SELECT pg_size_pretty(pg_database_size('cssrms'));"
```

---

### Backup the Database

Creates a `.sql` dump file you can restore from:

```bash
# Backup to /tmp with today's date in the filename
sudo -u postgres pg_dump cssrms > /tmp/cssrms-backup-$(date +%Y%m%d).sql

# Verify the backup was created
ls -lh /tmp/cssrms-backup-*.sql
```

---

### Download a Backup to Your Laptop

From your Windows PowerShell (not SSH):
```bash
scp root@162.35.183.2:/tmp/cssrms-backup-20260811.sql C:\Users\USER\Downloads\cssrms-backup-20260811.sql
```

---

### Restore from a Backup

```bash
# Drop existing data and restore from backup
sudo -u postgres psql cssrms < /tmp/cssrms-backup-20260811.sql
```

> **Warning:** Restoring overwrites all current data. Stop the app first: `pm2 stop cssrms`

---

### Delete a User (Admin Task)

```bash
sudo -u postgres psql cssrms -c "DELETE FROM \"User\" WHERE email = 'user@example.com';"
```

---

### Reset a User's Password

```bash
# First, get the bcrypt hash of the new password
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('NewPassword123', 10).then(h => console.log(h));"

# Then update in the database (replace HASH with the output above)
sudo -u postgres psql cssrms -c "UPDATE \"User\" SET password = 'HASH' WHERE email = 'user@example.com';"
```

---

## 8. Nginx Web Server Management

Nginx is the web server that sits in front of your Node.js app. It handles HTTPS traffic, redirects HTTP to HTTPS, serves the built React frontend files, and proxies API requests to the Node.js app on port 3000.

### Config File Location

```
/etc/nginx/sites-available/cssrms
```

### Test Configuration

**Always run this before reloading Nginx** — it catches syntax errors:
```bash
nginx -t
```

Expected output:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

---

### Reload Nginx (Apply Config Changes)

```bash
# Reload — applies config changes, zero downtime
nginx -t && systemctl reload nginx
```

---

### Restart Nginx

```bash
systemctl restart nginx
```

Use this if Nginx is completely unresponsive (brief downtime).

---

### Check Nginx Status

```bash
systemctl status nginx
```

---

### View Nginx Config

```bash
cat /etc/nginx/sites-available/cssrms
```

---

### Edit Nginx Config

```bash
nano /etc/nginx/sites-available/cssrms
# Make changes, then:
nginx -t && systemctl reload nginx
```

---

### View Nginx Error Log

```bash
# Last 30 lines of Nginx errors
tail -30 /var/log/nginx/cssrms-error.log

# Live stream Nginx errors
tail -f /var/log/nginx/cssrms-error.log

# Last 30 lines of access log (all requests)
tail -30 /var/log/nginx/cssrms-access.log
```

---

### Check What Ports Nginx Is Listening On

```bash
ss -tlnp | grep nginx
```

Should show ports 80 and 443.

---

## 9. SSL Certificate Management

The server uses a self-signed SSL certificate. Cloudflare proxies all traffic and provides the browser-trusted HTTPS — your self-signed cert is only between Cloudflare and your server (which is why Cloudflare SSL mode must be "Full", not "Full Strict").

### Check Certificate Expiry

```bash
openssl x509 -enddate -noout -in /etc/ssl/certs/cssrms-selfsigned.crt
```

The current cert expires in 10 years (generated with `-days 3650`).

---

### View Certificate Details

```bash
openssl x509 -text -noout -in /etc/ssl/certs/cssrms-selfsigned.crt
```

---

### Renew / Regenerate Self-Signed Certificate

If the cert expires or gets corrupted:
```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/ssl/private/cssrms-selfsigned.key \
  -out /etc/ssl/certs/cssrms-selfsigned.crt \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=CSS Group/CN=rms.cssgrouprms.com"

systemctl reload nginx
```

---

### Verify Nginx Can See the Cert

```bash
nginx -t
```

If it fails, check the cert paths in `/etc/nginx/sites-available/cssrms` match the actual file locations.

---

## 10. Server Health Monitoring

### Disk Space

```bash
df -h /
```

**What the output means:**
- `Size` = total disk space
- `Used` = space currently used
- `Avail` = free space left
- `Use%` = percentage used

> **Warning:** If `Use%` reaches 85%+, clear logs or old files. A full disk crashes everything.

---

### Memory (RAM) Usage

```bash
free -h
```

**What to look for:**
- `Mem available` = RAM free for new processes
- If available RAM is below 50MB, the server is under memory pressure

---

### CPU and Processes

```bash
top
```

Interactive process monitor. Press `q` to quit. Press `Shift + M` to sort by memory.

```bash
htop
```

Better version of top. Press `q` to quit. May need to install: `apt-get install -y htop`

---

### Server Uptime

```bash
uptime
```

Shows how long the server has been running and the load average.

---

### Who Is Connected

```bash
who
w
```

Shows which users are currently logged in.

---

### Network Connections

```bash
ss -tlnp
```

Shows all listening ports and which process is using them.

---

### All Service Status at Once

```bash
systemctl is-active postgresql nginx
pm2 status
```

---

### Monitor Everything — One-Line Summary

```bash
echo "=== PM2 ===" && pm2 status && echo "=== DISK ===" && df -h / && echo "=== MEMORY ===" && free -h && echo "=== SERVICES ===" && systemctl is-active postgresql nginx
```

---

## 11. Log Management

### PM2 App Logs

```bash
# Live stream
pm2 logs cssrms

# Last 100 lines only
pm2 logs cssrms --lines 100 --nostream

# Errors only
pm2 logs cssrms --err --nostream

# Log file locations
ls -lh /var/log/pm2/
cat /var/log/pm2/cssrms-out.log   # regular output
cat /var/log/pm2/cssrms-error.log # errors only
```

---

### Clear Logs (Free Disk Space)

```bash
# Clear PM2 logs for cssrms app
pm2 flush cssrms

# Clear all PM2 logs
pm2 flush

# Check disk space after
df -h /
```

---

### Nginx Logs

```bash
# Error log
tail -50 /var/log/nginx/cssrms-error.log

# Access log (all HTTP requests)
tail -50 /var/log/nginx/cssrms-access.log

# Live stream Nginx error log
tail -f /var/log/nginx/cssrms-error.log
```

---

### System Log

```bash
# Recent system messages
journalctl -n 50

# PM2 service logs
journalctl -u pm2-deploy -n 50
```

---

### Rotate Logs Manually

Nginx and PostgreSQL handle log rotation automatically. For PM2 logs, use `pm2 flush`.

---

## 12. Firewall & Security

### Check Firewall Status

```bash
ufw status verbose
```

---

### View Open Ports

```bash
ss -tlnp
```

Expected open ports:
- `22` — SSH
- `80` — HTTP (redirected to HTTPS by Nginx)
- `443` — HTTPS (Nginx)
- `5432` — PostgreSQL (only on 127.0.0.1, not public)
- `3000` — Node.js (only on 127.0.0.1, not public)

---

### Add a Firewall Rule (if needed)

```bash
# Allow a new port
ufw allow 8080

# Block a port
ufw deny 8080

# Check rules
ufw status numbered
```

---

### Change Root SSH Password

```bash
passwd root
# Enter new password twice
```

---

### Change Deploy User Password

```bash
echo 'deploy:NewPassword' | chpasswd
```

---

## 13. File Transfer (Upload & Download)

### Upload a File from Your Laptop to Server

**From Windows PowerShell (not SSH — open a new terminal window):**
```bash
# Upload a file
scp "C:\path\to\local\file.txt" root@162.35.183.2:/var/www/cssrms/

# Upload a whole folder
scp -r "C:\path\to\folder" root@162.35.183.2:/var/www/cssrms/
```

### Download a File from Server to Your Laptop

```bash
# From Windows PowerShell
scp root@162.35.183.2:/var/www/cssrms/.env "C:\Users\USER\Downloads\cssrms-env-backup.txt"

# Download a database backup
scp root@162.35.183.2:/tmp/cssrms-backup-20260811.sql "C:\Users\USER\Downloads\"
```

### View Files on Server

```bash
# List app files (not including node_modules)
ls -la /var/www/cssrms/

# Show directory sizes
du -sh /var/www/cssrms/*/
```

---

## 14. Backup & Restore

### Full Backup Plan (Recommended Monthly)

```bash
# 1. Backup database
sudo -u postgres pg_dump cssrms > /tmp/cssrms-db-$(date +%Y%m%d).sql

# 2. Backup .env file
cp /var/www/cssrms/.env /tmp/cssrms-env-$(date +%Y%m%d).bak

# 3. Download both to your laptop (from PowerShell, not SSH)
scp root@162.35.183.2:/tmp/cssrms-db-*.sql "C:\Users\USER\Downloads\"
scp root@162.35.183.2:/tmp/cssrms-env-*.bak "C:\Users\USER\Downloads\"

# 4. Clean up temp files on server
rm /tmp/cssrms-db-*.sql /tmp/cssrms-env-*.bak
```

---

### Restore Database from Backup

```bash
# Stop the app first
pm2 stop cssrms

# Restore
sudo -u postgres psql cssrms < /path/to/backup.sql

# Start the app again
pm2 start cssrms
```

---

### Restore .env from Backup

```bash
cp /path/to/cssrms-env-backup.bak /var/www/cssrms/.env
pm2 restart cssrms
```

---

## 15. PM2.io Web Monitoring Dashboard

PM2.io gives you a web dashboard to monitor the app without needing to SSH in.

**Dashboard URL:** [app.pm2.io](https://app.pm2.io)

**What you can see:**
- CPU and memory usage graphs
- Restart count
- Recent logs (last few lines)
- App online/offline status

**Free tier includes:** Up to 4 processes, basic monitoring.

### Connect Server to PM2.io

If the server loses connection to PM2.io (after a reboot, etc.):

```bash
# SSH into server first, then:
sudo -u deploy pm2 link f5s06168ekh762y zeqveuct451og8y
```

### Verify PM2.io Connection

```bash
pm2 show cssrms
```

Look for `km_link: true` in the output.

---

## 16. Emergency Troubleshooting

### App is Down — Site Not Loading

**Step 1: Check what's running**
```bash
pm2 status
systemctl is-active nginx postgresql
```

**Step 2: Read the error**
```bash
pm2 logs cssrms --lines 50 --nostream
```

**Step 3: Try restarting**
```bash
pm2 restart cssrms
# Wait 5 seconds
pm2 status
```

**Step 4: Check if the app is responding internally**
```bash
curl http://127.0.0.1:3000/
```
If this gives a response but the website is still down, the problem is in Nginx.

**Step 5: Check Nginx**
```bash
nginx -t
systemctl status nginx
tail -20 /var/log/nginx/cssrms-error.log
```

---

### App Crashed — Need to See the Real Error

```bash
# Run the app manually to see the full error message
sudo -u deploy bash -c 'set -a; source /var/www/cssrms/.env; set +a; node /var/www/cssrms/serve.js'
```

The error will appear in the terminal. Press `Ctrl + C` to stop. Send the error message to Claude for help.

---

### App Keeps Crashing in a Loop

```bash
# Stop the restart loop
pm2 stop cssrms

# Look at recent error logs
pm2 logs cssrms --err --lines 100 --nostream

# Try running manually to see real error
sudo -u deploy bash -c 'set -a; source /var/www/cssrms/.env; set +a; node /var/www/cssrms/serve.js'
```

Common causes:
- Missing or wrong value in `.env` (check `pm2 logs` — it will say which env var)
- Failed database connection (check `DATABASE_URL` in `.env`)
- Port 3000 already in use — check with `ss -tlnp | grep 3000`

---

### Environment Variable Not Found Error

If logs say `Error: Environment variable not found: SOME_VAR`:

```bash
# Check if the variable is in .env
grep 'SOME_VAR' /var/www/cssrms/.env

# If missing, add it
echo 'SOME_VAR="value"' >> /var/www/cssrms/.env
pm2 restart cssrms
```

---

### "Port Already in Use" Error

```bash
# Find what's using port 3000
ss -tlnp | grep 3000

# Kill the process using port 3000 (replace PID with the number shown)
kill -9 PID

# Restart normally
pm2 start cssrms
```

---

### Database Connection Error

If logs show `connection refused` or `ECONNREFUSED`:
```bash
# Check if PostgreSQL is running
systemctl status postgresql

# Start it if stopped
systemctl start postgresql

# Restart app
pm2 restart cssrms
```

If PostgreSQL is running but connection still fails, check `DATABASE_URL` in `.env`.

---

### Disk Full

```bash
# Check disk
df -h /

# Find what's using space
du -sh /var/log/pm2/ /var/log/nginx/ /var/www/cssrms/node_modules/

# Clear PM2 logs
pm2 flush

# Clear old Nginx logs
> /var/log/nginx/cssrms-access.log
> /var/log/nginx/cssrms-error.log

# Check again
df -h /
```

---

### Nginx 502 Bad Gateway

This means Nginx is running but can't reach the Node.js app on port 3000.

```bash
# Check if app is running
pm2 status

# Check if app is on port 3000
ss -tlnp | grep 3000

# Restart app
pm2 restart cssrms

# Wait a few seconds, check again
pm2 status
curl http://127.0.0.1:3000/
```

---

### Server Won't Respond (Can't SSH)

1. Go to [my.interserver.net](https://my.interserver.net)
2. Check if VPS status is **Running**
3. If stopped → click **Start**
4. If running → click **Restart** (hard reboot)
5. Wait 60 seconds
6. Try SSH again

After a reboot, PM2 should automatically start the app (because `pm2 startup` was configured). If not:
```bash
pm2 start /var/www/cssrms/ecosystem.config.js
pm2 save
```

---

### Forgot Passwords

- Root SSH password: `7$ABUqpZ`
- VNC deploy user password: `CssGroup@2026`

If both are lost: InterServer dashboard → Reinstall OS (wipes the server — last resort, requires full setup again).

---

## 17. Quick Reference — All Commands

### Connect

```bash
ssh root@162.35.183.2              # SSH into server
exit                                # Disconnect from server
```

### App (PM2)

```bash
pm2 status                          # Check app status
pm2 logs cssrms                     # Live logs
pm2 logs cssrms --lines 50 --nostream  # Last 50 lines
pm2 restart cssrms                  # Restart app
pm2 reload cssrms                   # Graceful restart
pm2 stop cssrms                     # Stop app
pm2 start cssrms                    # Start app
pm2 delete cssrms                   # Remove from PM2
pm2 start /var/www/cssrms/ecosystem.config.js  # Start from config
pm2 save                            # Save process list (persist reboots)
pm2 monit                           # Live CPU/memory monitor
pm2 show cssrms                     # Detailed info
pm2 flush cssrms                    # Clear logs
```

### Environment Variables

```bash
cat /var/www/cssrms/.env                        # View all
nano /var/www/cssrms/.env                       # Edit in nano
grep 'VAR_NAME' /var/www/cssrms/.env            # Search for one variable
echo 'NEW_VAR="value"' >> /var/www/cssrms/.env  # Add new variable
sed -i 's|VAR=.*|VAR="new"|' /var/www/cssrms/.env  # Change a value
sed -i '/^VAR=/d' /var/www/cssrms/.env          # Delete a variable
```

### Deploy

```bash
cd /var/www/cssrms
git fetch origin main && git reset --hard origin/main
npm install --include=dev
cd rms_frontend && npm run build && cd ..
pm2 restart cssrms
```

### Database

```bash
sudo -u postgres psql cssrms                     # Open DB shell
sudo -u postgres psql cssrms -c "SELECT COUNT(*) FROM \"User\";"
sudo -u postgres pg_dump cssrms > /tmp/backup.sql   # Backup
sudo -u postgres psql cssrms < /tmp/backup.sql      # Restore
systemctl status postgresql                          # Check DB service
```

### Nginx

```bash
nginx -t                                 # Test config
systemctl reload nginx                   # Apply changes
systemctl restart nginx                  # Full restart
systemctl status nginx                   # Check status
cat /etc/nginx/sites-available/cssrms    # View config
tail -30 /var/log/nginx/cssrms-error.log # Error log
```

### Server Health

```bash
df -h /                     # Disk space
free -h                     # Memory
uptime                      # Uptime and load
top                         # Processes (q to quit)
ss -tlnp                    # Open ports
systemctl is-active postgresql nginx  # Service status
```

### File Transfer (from your laptop, not SSH)

```bash
# Upload file to server
scp "C:\path\to\file" root@162.35.183.2:/var/www/cssrms/

# Download file from server
scp root@162.35.183.2:/tmp/backup.sql "C:\Users\USER\Downloads\"
```

---

## Useful Links

| Resource | URL |
|----------|-----|
| Live site | https://rms.cssgrouprms.com |
| InterServer dashboard | https://my.interserver.net |
| PM2.io monitoring | https://app.pm2.io |
| GitHub repo | https://github.com/Ephraimraxy/CSS-RMS |
| Cloudflare DNS | https://dash.cloudflare.com |
| Railway (parallel deployment) | https://railway.app |

---

*Last updated: 2026-08-11 · CSS Group RMS VPS — InterServer KVM*
