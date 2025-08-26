# Turso SQLite Database Setup Guide

This guide will help you set up Turso SQLite database for the RIT Vue Prototype application.

## What is Turso?

Turso is a serverless SQLite database that provides:
- Global edge deployment
- Automatic scaling
- Built-in replication
- SQLite compatibility
- Cost-effective pricing

## Prerequisites

1. **Turso CLI**: Install the Turso CLI tool
2. **Turso Account**: Create a free account at [turso.tech](https://turso.tech)

## Installation

### 1. Install Turso CLI

**macOS/Linux:**
```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

**Windows:**
```bash
powershell -c "irm https://get.tur.so/install.ps1 | iex"
```

**Alternative (using npm):**
```bash
npm install -g @libsql/cli
```

### 2. Login to Turso

```bash
turso auth login
```

This will open your browser to authenticate with your Turso account.

## Database Setup

### 1. Create a Database

```bash
turso db create rit-vue-prototype
```

This creates a new database named `rit-vue-prototype`.

### 2. Get Database URL

```bash
turso db show rit-vue-prototype --url
```

Copy the URL (it will look like: `libsql://rit-vue-prototype-username.turso.io`)

### 3. Create Auth Token

```bash
turso db tokens create rit-vue-prototype
```

Copy the generated token.

## Environment Variables

Add the following environment variables to your `.env` file or Vercel environment:

```env
TURSO_DATABASE_URL=libsql://rit-vue-prototype-username.turso.io
TURSO_AUTH_TOKEN=your-auth-token-here
```

## Database Schema

The application will automatically create the following tables when it starts:

### Assets Table
```sql
CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  predicted_asset_ids TEXT,
  matching_scores TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Import Jobs Table
```sql
CREATE TABLE IF NOT EXISTS import_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT,
  total_records INTEGER,
  processed INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  error_details TEXT,
  progress INTEGER DEFAULT 0,
  options TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Import Chunks Table
```sql
CREATE TABLE IF NOT EXISTS import_chunks (
  job_id TEXT,
  chunk_index INTEGER,
  chunk_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id, chunk_index)
)
```

## Vercel Deployment

### 1. Add Environment Variables

In your Vercel dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add:
   - `TURSO_DATABASE_URL`: Your database URL
   - `TURSO_AUTH_TOKEN`: Your auth token

### 2. Deploy

The application will automatically:
- Connect to Turso on startup
- Create the required tables if they don't exist
- Handle all database operations through the libSQL client

## Local Development

### 1. Install Dependencies

```bash
npm install @libsql/client
```

### 2. Set Environment Variables

Create a `.env` file in your project root:
```env
TURSO_DATABASE_URL=libsql://rit-vue-prototype-username.turso.io
TURSO_AUTH_TOKEN=your-auth-token-here
```

### 3. Run the Application

```bash
npm run dev
```

## Database Management

### View Database Info
```bash
turso db show rit-vue-prototype
```

### List All Databases
```bash
turso db list
```

### Delete Database (if needed)
```bash
turso db destroy rit-vue-prototype
```

### Connect to Database Shell
```bash
turso db shell rit-vue-prototype
```

## Performance Tips

1. **Use Transactions**: The application uses transactions for batch operations to improve performance
2. **Indexing**: The primary key on `asset_id` provides fast lookups
3. **Connection Pooling**: The libSQL client handles connection management automatically
4. **Edge Deployment**: Turso provides global edge deployment for low latency

## Troubleshooting

### Connection Issues
- Verify your `TURSO_DATABASE_URL` is correct
- Ensure your `TURSO_AUTH_TOKEN` is valid
- Check if your database exists: `turso db list`

### Schema Issues
- The application automatically creates tables on startup
- Check logs for any SQL errors
- You can manually run schema creation in the Turso shell

### Performance Issues
- Monitor your database usage in the Turso dashboard
- Consider upgrading your plan if you hit limits
- Use batch operations for large imports

## Migration from Redis

If you're migrating from Redis:
1. Export your data from Redis (if needed)
2. Set up Turso as described above
3. Import your data through the application's import functionality
4. Update your environment variables
5. Deploy the updated application

## Cost Considerations

Turso offers a generous free tier:
- 1 database
- 1GB storage
- 1 billion row reads per month
- 100 million row writes per month

For most use cases, the free tier should be sufficient. Monitor your usage in the Turso dashboard.

## Support

- [Turso Documentation](https://docs.turso.tech/)
- [libSQL Documentation](https://docs.libsql.org/)
- [Turso Discord](https://discord.gg/turso)
