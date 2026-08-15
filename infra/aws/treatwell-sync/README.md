# Treatwell sync — legacy AWS trigger (runbook)

> **DO NOT DEPLOY THIS.** There is currently **no** scheduled trigger for the
> sync, on Vercel or here — the `vercel.json` cron was removed and the route
> itself is gated behind `TREATWELL_SYNC_ENABLED`, which is off.
>
> Why: the route's first act is a database query, so scheduling it at all wakes
> Neon's compute. At a 5-minute cadence the endpoint never idles long enough to
> suspend (Neon's threshold is 5 minutes), which pinned it awake 24/7 and burned
> the monthly CU-hour allowance — for a run that did nothing, because no stylist
> has ever had an iCal feed URL. Standing this Lambda up would reintroduce that
> cost while bypassing the kill-switch's intent.
>
> Keep this only as a fallback for the day the sync is genuinely needed *and*
> the trigger has to live outside Vercel. Before deploying: map iCal URLs to
> stylists, set `TREATWELL_SYNC_ENABLED=true`, use an interval **over** 5
> minutes (30 is plenty) within a business-hours window, and never run this
> alongside a `vercel.json` cron.

Drives `GET /api/cron/treatwell-sync` on a schedule **without** paying for Vercel
Pro (Hobby caps cron at once/day). EventBridge Scheduler → Lambda → Vercel route.
The Lambda only makes an authenticated HTTPS call — **it never touches the
database**. The route writes to Neon (`harbour-hair-db`) via the app's
`POSTGRES_URL`.

## Cost

Effectively **$0/month**: EventBridge Scheduler has 14M free invocations/month
(we use ~8.6k at a 5-min cadence); Lambda free tier covers the calls.
**Do not put the Lambda in a VPC** — it only needs the public internet, and a VPC
would pull in a NAT Gateway (~$32/mo). Neon is a public endpoint, so no VPC is
needed even if you later move the work into the Lambda.

## Facts to fill in

- AWS account ID: `575108933055` (no alias)
- Region: `eu-west-2`
- `SYNC_URL`: `https://<your-domain>/api/cron/treatwell-sync`
- `CRON_SECRET`: copy the value from Vercel (Production env, already set)

## Deploy

```bash
cd infra/aws/treatwell-sync
zip function.zip index.mjs

# One-time IAM role for the Lambda (logging only — no VPC, no NAT)
aws iam create-role --role-name treatwell-sync-lambda \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name treatwell-sync-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws lambda create-function --function-name treatwell-sync \
  --runtime nodejs20.x --handler index.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::575108933055:role/treatwell-sync-lambda \
  --timeout 30 \
  --region eu-west-2 \
  --environment "Variables={SYNC_URL=https://<your-domain>/api/cron/treatwell-sync,CRON_SECRET=<same-as-vercel>}"
```

## Schedule (every 5 minutes)

```bash
# Role allowing Scheduler to invoke the Lambda
aws iam create-role --role-name treatwell-sync-scheduler \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name treatwell-sync-scheduler --policy-name invoke \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:eu-west-2:575108933055:function:treatwell-sync"}]}'

aws scheduler create-schedule --name treatwell-sync-5min \
  --region eu-west-2 \
  --schedule-expression "rate(5 minutes)" \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target '{"Arn":"arn:aws:lambda:eu-west-2:575108933055:function:treatwell-sync","RoleArn":"arn:aws:iam::575108933055:role/treatwell-sync-scheduler"}'
```

## Verify

```bash
aws lambda invoke --function-name treatwell-sync --region eu-west-2 /dev/stdout
# Expect: {"statusCode":200,"body":"{\"ok\":true,\"results\":[...]}"}
```

`results` is empty until at least one stylist has a Treatwell iCal URL
(set it in Admin → Stylists → Edit → Integrations).

## Update the Lambda code later

```bash
cd infra/aws/treatwell-sync && zip function.zip index.mjs
aws lambda update-function-code --function-name treatwell-sync --zip-file fileb://function.zip --region eu-west-2
```

## Alternative — no Lambda (EventBridge API Destination)

You can instead point an EventBridge Scheduler universal target at an API
Destination that calls the route directly. It avoids the Lambda but needs a
Connection (stored in Secrets Manager, ~$0.40/mo). The Lambda path above is
simpler and truly $0, so it's the default.
```
