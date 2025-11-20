# DB Workflow Guide

## 1. Local Development (SQLite)

**Goal**: Develop features locally using a fast SQLite database.

1.  Ensure `.env` has:
    ```env
    DATABASE_URL="file:./dev.db"
    ```
2.  Switch Prisma Client to Dev mode:
    ```bash
    pnpm db:switch:dev
    ```
3.  Create/Apply Migrations:
    ```bash
    pnpm db:dev:migrate
    ```
    *This creates migrations in `prisma/dev/migrations/`*

---

## 2. Prepare Production Migration (Docker/Local SQL Server)

**Goal**: Create migration files compatible with SQL Server before deploying.

1.  Start local SQL Server (Docker):
    ```bash
    docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Str0ngP@ssw0rd!" -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
    ```
2.  Update `.env` to point to Docker:
    ```env
    # DATABASE_URL="file:./dev.db"
    DATABASE_URL="sqlserver://localhost:1433;database=harbour-hair;user=sa;password=Str0ngP@ssw0rd!;encrypt=false;trustServerCertificate=true"
    ```
3.  Switch Prisma Client to Prod mode:
    ```bash
    pnpm db:switch:prod
    ```
4.  Create Production Migration:
    ```bash
    pnpm db:prod:migrate
    ```
    *This creates migrations in `prisma/prod/migrations/`*

---

## 3. Deploy to Production (AWS RDS)

**Goal**: Apply the generated production migrations to the real AWS database.

1.  Update `.env` to point to AWS RDS:
    ```env
    # DATABASE_URL="sqlserver://localhost:1433..."
    DATABASE_URL="sqlserver://harbour-hair-db.cbw4ui0m25cz.eu-west-2.rds.amazonaws.com:1433;database=harbour-hair;user=admin;password=HarbourHair2025!;encrypt=true;trustServerCertificate=true"
    ```
2.  Deploy Migrations:
    ```bash
    pnpm db:prod:deploy
    ```
    *This applies the migrations from `prisma/prod/migrations/` to the AWS database.*

