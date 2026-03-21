#!/bin/sh
# Run Prisma schema push to sync database schema, then start the app.
echo "Running Prisma db push..."
npx prisma db push --accept-data-loss 2>&1 || echo "Warning: prisma db push failed, continuing anyway"
echo "Starting application..."
exec node dist/app.js
