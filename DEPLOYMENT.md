# Deployment Guide: GitHub & AWS App Runner

This guide details how to deploy the Harbour Hair Salon application to AWS App Runner using GitHub Actions.

## Prerequisites

1.  **GitHub Account**: A repository for this project.
2.  **AWS Account**: Access to the AWS Console with billing enabled.
3.  **Domain Name (Optional)**: For a custom URL (e.g., `harbourhair.co.uk`).

## Step 1: GitHub Setup

1.  **Create a Repository**:
    *   Go to GitHub and create a new repository (e.g., `harbour-hair-salon`).
    *   Do *not* initialize with README/gitignore (we already have them).

2.  **Push Code**:
    ```bash
    git init
    git add .
    git commit -m "Initial commit"
    git branch -M main
    git remote add origin https://github.com/<YOUR_USERNAME>/harbour-hair-salon.git
    git push -u origin main
    ```

## Step 2: AWS Setup

### 2.1. Create an IAM User for Deployment
1.  Go to **IAM** > **Users** > **Create user**.
2.  Name: `github-actions-deployer`.
3.  Attach policies directly:
    *   `AmazonEC2ContainerRegistryFullAccess` (to push Docker images).
    *   `AWSAppRunnerFullAccess` (to update the service).
4.  Create Access Keys for this user:
    *   Go to the user > **Security credentials** > **Create access key**.
    *   Select **Command Line Interface (CLI)**.
    *   **Save the Access Key ID and Secret Access Key immediately.**

### 2.2. Create an ECR Repository
1.  Go to **Elastic Container Registry (ECR)**.
2.  Click **Create repository**.
3.  Visibility: **Private**.
4.  Name: `harbour-hair-salon`.
5.  Create.

### 2.3. Create App Runner Service
*Note: The first deployment will be easier *after* the first image is pushed. You can trigger the GitHub Action first (see Step 3), OR manually push the image once.*

1.  Go to **AWS App Runner**.
2.  **Create service**.
3.  **Source**: Container registry.
4.  **Provider**: Amazon ECR.
5.  **Image URI**: Select the image you pushed (or wait for the first GitHub Action run).
6.  **Deployment settings**: Automatic (Triggers a new deployment when a new image is pushed).
7.  **Configuration**:
    *   CPU: 1 vCPU.
    *   Memory: 2 GB.
    *   Port: `3000`.
    *   **Environment variables**:
        *   `DATABASE_URL`: Your production SQL Server connection string.
        *   `NEXTAUTH_SECRET`: A random string for auth.
        *   `NEXT_PUBLIC_BASE_URL`: Your production URL.

## Step 3: GitHub Secrets

Go to your GitHub Repository > **Settings** > **Secrets and variables** > **Actions**.
Add the following Repository secrets:

*   `AWS_ACCESS_KEY_ID`: (From Step 2.1)
*   `AWS_SECRET_ACCESS_KEY`: (From Step 2.1)
*   `AWS_REGION`: `eu-west-2` (London) or your preferred region.
*   `ECR_REPOSITORY`: `harbour-hair-salon`
*   `DATABASE_URL`: Your production database connection string.

## Step 4: Database (Production)

Since we are using `sqlserver` in `schema.prod.prisma`, you need a SQL Server instance (AWS RDS or Azure SQL).

**Applying Schema to Production:**
You must run the migration to create tables in your production database. Run this locally:

```bash
# 1. Set the environment variable temporarily
export DATABASE_URL="sqlserver://<your-prod-db-url>"

# 2. Push the schema
npx prisma db push --schema prisma/schema.prod.prisma

# 3. (Optional) Seed initial data
npx prisma db seed
```

**Important**: Ensure the database allows connections from your IP (for migration) and AWS IP addresses (for the running app).

## Step 5: Go Live!

Once the secrets are set, any push to the `main` branch will:
1.  Build the Docker image.
2.  Push it to AWS ECR.
3.  App Runner will detect the new image and automatically deploy.

Visit the App Runner URL to see your live site.
