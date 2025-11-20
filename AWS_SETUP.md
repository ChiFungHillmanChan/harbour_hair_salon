# AWS Deployment Setup Guide

This guide details the complete setup for deploying the Harbour Hair Salon application to AWS using App Runner, ECR, and RDS.

## Phase 1: AWS Infrastructure Setup

### 1. Create the Database (AWS RDS for SQL Server)
Since `schema.prod.prisma` uses SQL Server, we need an RDS instance.

1.  Log in to the AWS Console and search for **RDS**.
2.  Click **Create database**.
3.  Choose **Standard create** > **Microsoft SQL Server**.
4.  Edition: **SQL Server Express Edition** (Cheapest option).
5.  Templates: **Free tier** (if available) or **Dev/Test**.
6.  **Settings**:
    *   **DB instance identifier**: `harbour-hair-db`
    *   **Master username**: `admin`
    *   **Master password**: Create a strong password (e.g., `HarbourHair2025!`). **Save this!**
7.  **Connectivity**:
    *   **Public access**: **Yes** (Required for running migrations from your local machine).
    *   **VPC Security Group**: Create new. Name it `harbour-db-sg`.
8.  **Create Database**.
    *   *Wait ~5-10 minutes for it to become "Available".*
    *   **Finding the URL**: Once available, click the database name (`harbour-hair-db`).
    *   Look for the **Connectivity & security** tab.
    *   Copy the **Endpoint** (e.g., `harbour-hair-db.cw...eu-west-2.rds.amazonaws.com`).

### 2. Create the Container Registry (ECR)
This is where your Docker images will be stored.

1.  Search for **ECR** (Elastic Container Registry).
2.  Click **Create repository**.
3.  Visibility settings: **Private**.
4.  Repository name: `harbour-hair-salon` (Must match the name in `.github/workflows/deploy.yml`).
5.  Click **Create repository**.

### 3. Create an IAM User for GitHub Actions
This gives GitHub permission to upload files to your AWS.

1.  Search for **IAM**.
2.  Click **Users** > **Create user**.
3.  Name: `github-deployer`.
4.  **Permissions**: Attach policies directly > Search and select:
    *   `AmazonEC2ContainerRegistryFullAccess`
    *   `AWSAppRunnerFullAccess`
5.  Create user.
6.  Go to the user > **Security credentials** tab.
7.  **Create access key** > Select **Command Line Interface (CLI)**.
8.  **Copy** the `Access Key ID` and `Secret Access Key`. **You won't see these again.**

---

## Phase 2: Connect GitHub to AWS

1.  Go to your GitHub Repository.
2.  Click **Settings** > **Secrets and variables** > **Actions**.
3.  Add these **Repository secrets**:
    *   `AWS_ACCESS_KEY_ID`: Paste the Key ID from IAM.
    *   `AWS_SECRET_ACCESS_KEY`: Paste the Secret Key from IAM.
    *   `AWS_REGION`: `eu-west-2` (London) or `us-east-1` (N. Virginia) - wherever you created your resources.

---

## Phase 3: Initial Deployment & App Runner

### 1. Push your code
Now that the workflow file is ready, push your code to GitHub:
```bash
git add .
git commit -m "Setup AWS deployment pipeline"
git push origin main
```
*Go to the "Actions" tab in your GitHub repo. You should see the "Deploy to AWS App Runner" workflow running. Wait for it to finish (green checkmark).*

### 2. Create the App Runner Service (One-time setup)
Once the image is pushed to ECR (after the Action finishes):

1.  Search for **App Runner** in AWS.
2.  **Create service**.
3.  **Source**: Container registry.
    *   Provider: **Amazon ECR**.
    *   Image URI: Click **Browse** and select `harbour-hair-salon` with the tag `latest`.
4.  **Deployment settings**:
    *   Trigger: **Automatic** (This ensures every new git push deploys automatically).
    *   Create new service role (allow App Runner to pull from ECR).
5.  **Service configuration**:
    *   Service name: `harbour-hair-web`
    *   Port: `3000`
6.  **Networking (Secure Connection)**:
    *   **Incoming traffic**: Public.
    *   **Outgoing traffic**: Custom VPC.
    *   **Add new VPC connector**:
        *   Name: `harbour-app-connector`
        *   VPC: Select your default VPC (same one RDS is in).
        *   Subnets: Select all available subnets.
        *   Security Groups: Select `default` (or create a specific `app-runner-sg`).
7.  **Environment variables** (Add these here):
    *   `DATABASE_URL`: Construct this using your RDS info (see below).
    *   `NEXTAUTH_SECRET`: Generate a random string.
8.  **Create & Deploy**.

### 3. Configure Security Groups (Crucial for Connection)
To allow App Runner to talk to RDS without opening RDS to the world:

1.  Go to **EC2** > **Security Groups**.
2.  Find your RDS security group (`harbour-db-sg`).
3.  **Edit Inbound Rules**:
    *   **Rule 1 (For You)**:
        *   Type: MSSQL (TCP 1433)
        *   Source: **My IP** (Click the dropdown to select your current IP).
    *   **Rule 2 (For App Runner)**:
        *   Type: MSSQL (TCP 1433)
        *   Source: Select the Security Group ID used by your App Runner VPC Connector (e.g., `sg-xxxxxx` for `default` or `app-runner-sg`).

### How to Construct your DATABASE_URL
Your connection string follows this format:

```
sqlserver://<RDS_ENDPOINT>:1433;database=master;user=<USERNAME>;password=<PASSWORD>;encrypt=true;trustServerCertificate=true
```

*   **RDS_ENDPOINT**: Go to RDS > Databases > `harbour-hair-db` > Connectivity & security > **Endpoint**.
    *   Example: `harbour-hair-db.c123abc.eu-west-2.rds.amazonaws.com`
*   **USERNAME**: The master username you set in Phase 1 (e.g., `admin`).
*   **PASSWORD**: The master password you set in Phase 1.

**Example Result:**
`sqlserver://harbour-hair-db.c123abc.eu-west-2.rds.amazonaws.com:1433;database=master;user=admin;password=MySecurePass123!;encrypt=true;trustServerCertificate=true`

---

## Phase 4: Initialize the Database

Your app is running, but the database is empty. You need to apply the schema.
Run this **locally** on your machine:

```bash
# 1. Install dependencies if you haven't
pnpm install

# 2. Set the PROD database URL temporarily (Replace with your actual string)
export DATABASE_URL="sqlserver://<RDS_ENDPOINT>:1433;database=master;user=admin;password=<PASSWORD>;encrypt=true;trustServerCertificate=true"

# 3. Push the schema to the production DB
npx prisma db push --schema prisma/schema.prod.prisma
```

