#!/bin/sh
# Daily SQLite backup: consistent snapshot via VACUUM INTO, keep last 7.
# Install on VPS: cp to /opt/todo-app/deploy, then add to root crontab:
#   0 4 * * * /opt/todo-app/deploy/backup-db.sh >> /var/log/todo-backup.log 2>&1
set -e

APP_DIR=/opt/todo-app
DEST=/opt/todo-app-backups
STAMP=$(date +%F)

mkdir -p "$DEST"
cd "$APP_DIR"

docker compose exec -T app node -e "
const sqlite3 = require('sqlite3');
const fs = require('fs');
try { fs.unlinkSync('/data/backup-tmp.db'); } catch {}
const db = new sqlite3.Database('/data/data.db');
db.run(\"VACUUM INTO '/data/backup-tmp.db'\", (e) => {
  if (e) { console.error('backup failed:', e.message); process.exit(1); }
  db.close(() => process.exit(0));
});
"

docker compose cp app:/data/backup-tmp.db "$DEST/data-$STAMP.db"
docker compose exec -T app rm -f /data/backup-tmp.db

# Keep newest 7 backups
ls -1t "$DEST"/data-*.db | tail -n +8 | xargs -r rm

echo "$(date '+%F %T') backup OK -> $DEST/data-$STAMP.db"
