# Database Migration Strategy

## Local Development
```bash
# Use SQLite for local dev
pnpm db:switch:dev
pnpm db:dev:migrate
```

## Production Database Updates

### When to Run Migrations
Run production migrations **manually from your local machine** when you:
- Add/remove database tables
- Add/remove columns
- Change column types or constraints

### Step-by-Step Process

1.  **Test locally with Docker SQL Server first**:
    ```bash
    # Start local SQL Server
    docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Str0ngP@ssw0rd!" -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
    
    # Update .env to point to Docker
    # DATABASE_URL="sqlserver://localhost:1433;database=harbour-hair;user=sa;password=Str0ngP@ssw0rd!;encrypt=false;trustServerCertificate=true"
    
    # Generate migration files
    pnpm db:switch:prod
    pnpm db:prod:migrate
    ```

2.  **Deploy to AWS RDS**:
    ```bash
    # Update .env to point to AWS RDS
    # DATABASE_URL="sqlserver://harbour-hair-db.cbw4ui0m25cz.eu-west-2.rds.amazonaws.com:1433;database=harbour-hair;user=admin;password=HarbourHair2025!;encrypt=true;trustServerCertificate=true"
    
    # Apply migrations
    pnpm db:prod:deploy
    ```

3.  **Push code to deploy app**:
    ```bash
    git add .
    git commit -m "Update schema"
    git push origin main
    ```

### Why Manual?
- **Security**: Your production database should not be publicly accessible.
- **Control**: You review migrations before applying them to production.
- **Safety**: No automated process can accidentally break your production database.

### CI/CD Flow
1. **GitHub Actions**: Builds and pushes Docker image (no database access needed).
2. **App Runner**: Automatically deploys new image.
3. **You**: Run migrations manually when schema changes.

