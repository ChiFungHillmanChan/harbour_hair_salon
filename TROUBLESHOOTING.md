# Troubleshooting Guide

## Issue: App Runner Deployment Fails

### Symptom
```
[AppRunner] Successfully pulled your application image from ECR.
[AppRunner] Failed to deploy your application image.
```

### Common Causes & Solutions

#### 1. Missing Prisma Client in Docker Image
**Symptom**: App crashes on startup with "Cannot find module '@prisma/client'"

**Solution**: The Dockerfile now explicitly copies Prisma files:
```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
```

#### 2. Health Check Failures
**Symptom**: "Health check failed on protocol TCP [Port: '3000']"

**Solution**: Configure App Runner health check:
- Protocol: **HTTP** (not TCP)
- Path: `/api/health`
- Timeout: 5 seconds
- Interval: 10 seconds
- Unhealthy threshold: 3

**To Update**:
1. Go to App Runner > `harbour-hair-web` > Configuration tab
2. Edit Health check settings
3. Change protocol to HTTP
4. Set path to `/api/health`
5. Deploy

#### 3. Missing Environment Variables
**Symptom**: App crashes immediately after starting

**Required Environment Variables in App Runner**:
```
DATABASE_URL=sqlserver://harbour-hair-db...
NEXTAUTH_SECRET=<random-32-char-string>
NEXT_PUBLIC_BASE_URL=https://your-app-runner-url.awsapprunner.com
```

**To Check/Add**:
1. App Runner > `harbour-hair-web` > Configuration tab
2. Environment variables section
3. Verify all are present and correct

#### 4. Database Connection Issues
**Symptom**: App starts but crashes when trying to connect to DB

**Solution**: Check security group configuration:

1. **VPC Connector**: Ensure App Runner has a VPC connector configured
   - App Runner > Configuration > Networking
   - Should show VPC connector with your VPC and subnets

2. **RDS Security Group**: Must allow traffic from App Runner
   - EC2 > Security Groups > `harbour-db-sg`
   - Inbound rules should include:
     ```
     Type: MSSQL
     Port: 1433
     Source: <app-runner-vpc-connector-security-group>
     ```

#### 5. Check Logs
**Always check logs first**:
1. App Runner > `harbour-hair-web` > Logs tab
2. Look for:
   - `Error: Cannot find module '@prisma/client'` → Prisma not copied
   - `ECONNREFUSED` → Database connection issue
   - `Cannot read property of undefined` → Missing env vars
   - `Port 3000 is already in use` → Shouldn't happen in App Runner

---

## Issue: GitHub Actions Fails

### CI - Build & Lint Failures
**Check**: GitHub Actions > Failed workflow > CI - Build & Lint step

Common fixes:
```bash
# Locally test before pushing
pnpm lint
pnpm build
```

### Deploy - ECR Push Failures
**Symptom**: "Error: Cannot perform an interactive login from a non TTY device"

**Solution**: Verify GitHub secrets are set correctly:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`

---

## Issue: Local Development Issues

### Cannot Generate Prisma Client
```bash
# Ensure you're using the correct schema
pnpm db:switch:dev    # For local development
pnpm db:switch:prod   # For production work
```

### Migration Errors
```bash
# Dev (SQLite)
pnpm db:dev:migrate

# Prod (SQL Server) - requires Docker
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Str0ngP@ssw0rd!" \
  -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest

# Then update .env to point to localhost:1433
pnpm db:prod:migrate
```

---

## Quick Diagnostic Checklist

### ✅ Pre-Deployment Checklist
- [ ] Local build succeeds: `pnpm build`
- [ ] No lint errors: `pnpm lint`
- [ ] Prisma client generated for prod: `pnpm db:prod:generate`
- [ ] Database schema applied to AWS RDS: `pnpm db:prod:deploy`
- [ ] GitHub secrets configured (AWS keys, DATABASE_URL)
- [ ] ECR repository exists: `harbour-hair-salon`

### ✅ App Runner Configuration Checklist
- [ ] Service created with correct image (latest tag)
- [ ] Port set to 3000
- [ ] Health check: HTTP protocol, `/api/health` path
- [ ] VPC connector configured with correct VPC
- [ ] All environment variables set (DATABASE_URL, NEXTAUTH_SECRET)
- [ ] Automatic deployment enabled

### ✅ Network Configuration Checklist
- [ ] RDS has public access enabled (for local migrations)
- [ ] RDS security group allows:
  - Your IP (for running migrations)
  - App Runner VPC connector SG (for app connection)
- [ ] VPC connector uses correct subnets (same AZ as RDS)
- [ ] No VPC Network ACLs blocking traffic

---

## Getting More Help

### View App Runner Logs
```bash
# Via AWS CLI
aws apprunner list-operations --service-arn <your-service-arn>
```

### View Application Logs
App Runner Console > Logs tab > Application logs

### Test Health Endpoint Locally
```bash
pnpm build
pnpm start
curl http://localhost:3000/api/health
# Should return: {"status":"healthy","timestamp":"..."}
```

### Test Database Connection Locally
```bash
# Set DATABASE_URL to AWS RDS
export DATABASE_URL="sqlserver://harbour-hair-db..."

# Try to connect
pnpm db:prod:generate
npx prisma studio --schema prisma/prod/schema.prisma
```

