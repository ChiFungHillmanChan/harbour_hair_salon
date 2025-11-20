# How to Check App Runner Logs

Your app is failing health checks. To diagnose the issue, we need to see the actual error messages from the application.

## Step 1: View Application Logs in AWS Console

1. Go to **AWS Console** > **App Runner**
2. Click on your service: `harbour-hair-web`
3. Click the **Logs** tab
4. Select **Application logs** (not Deployment logs)
5. Look for errors around the time of the failed deployment (9:47 PM)

## Step 2: Common Errors to Look For

### Error 1: Missing Prisma Client
```
Error: Cannot find module '@prisma/client'
```
**Fix**: Already addressed in Dockerfile by copying `.prisma` and `@prisma` folders

### Error 2: Missing Environment Variables
```
Error: Environment variable DATABASE_URL is not defined
```
**Fix**: Add `DATABASE_URL` in App Runner > Configuration > Environment variables

### Error 3: Database Connection Failed
```
Error: P1001: Can't reach database server
```
**Fix**: Check VPC connector and security group configuration

### Error 4: Prisma Binary Not Compatible
```
Error: The current platform "linux-musl" is not supported
```
**Fix**: Already addressed with `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`

### Error 5: Port Already in Use (unlikely in App Runner)
```
Error: Port 3000 is already in use
```

### Error 6: Next.js Build Issue
```
Error: Cannot find module 'next/dist/...'
```
**Fix**: Issue with standalone build

## Step 3: Share the Logs

Please copy and paste the **last 50-100 lines** of the Application logs here so I can help diagnose the specific issue.

Look for:
- Any lines starting with `Error:`
- Any stack traces
- The last few log messages before the health check failed

## Step 4: Quick Test - Check Environment Variables

In App Runner Console > Configuration > Environment variables, verify you have:

1. **DATABASE_URL**:
   ```
   sqlserver://harbour-hair-db.cbw4ui0m25cz.eu-west-2.rds.amazonaws.com:1433;database=harbour-hair;user=admin;password=HarbourHair2025!;encrypt=true;trustServerCertificate=true
   ```

2. **NEXTAUTH_SECRET** (any random string):
   ```
   your-random-secret-key-here
   ```

3. **Optional but recommended**:
   ```
   NODE_ENV=production
   ```

## Step 5: Alternative - Use AWS CLI

If you prefer command line:

```bash
# List recent log streams
aws logs describe-log-streams \
  --log-group-name /aws/apprunner/harbour-hair-web \
  --order-by LastEventTime \
  --descending \
  --max-items 5

# Get logs from the most recent stream
aws logs get-log-events \
  --log-group-name /aws/apprunner/harbour-hair-web \
  --log-stream-name <stream-name-from-above> \
  --limit 100
```

---

**Once you share the logs, I can provide a specific fix for your issue.**

