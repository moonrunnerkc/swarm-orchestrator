#!/usr/bin/env bash
# WIRE-DB: Database migrations present (if DB used)
set -euo pipefail
DIR="$1"
ATTR="WIRE-DB"

# Check if project uses a database
DB_USED=false
if grep -rql "sequelize\|typeorm\|prisma\|knex\|mongoose\|sqlite3\|pg\|mysql\|sqlalchemy\|alembic\|django.*models" \
  "$DIR" --include="*.ts" --include="*.js" --include="*.py" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  DB_USED=true
fi

if ! $DB_USED; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": false, \"present\": false, \"evidence_path\": null}"
  exit 2
fi

# DB is used — check for migration files
if find "$DIR" -path "*/migrations/*" -o -path "*/migrate/*" -o -name "*.migration.*" | grep -q .; then
  EVIDENCE=$(find "$DIR" -path "*/migrations/*" -o -path "*/migrate/*" | head -1)
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$EVIDENCE\"}"
  exit 0
elif [ -f "$DIR/prisma/schema.prisma" ]; then
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": true, \"evidence_path\": \"$DIR/prisma/schema.prisma\"}"
  exit 0
else
  echo "{\"attribute_id\": \"$ATTR\", \"applicable\": true, \"present\": false, \"evidence_path\": null}"
  exit 1
fi
