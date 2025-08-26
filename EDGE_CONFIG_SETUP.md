# Edge Config Setup Guide

## What is Edge Config?

Edge Config is Vercel's persistent key-value storage solution that provides reliable data persistence across serverless function invocations. Unlike file-based databases that get cleared between deployments, Edge Config maintains your data permanently.

## Setup Instructions

### 1. Create Edge Config in Vercel Dashboard

1. Go to your Vercel project dashboard
2. Navigate to **Storage** → **Edge Config**
3. Click **Create Edge Config**
4. Give it a name (e.g., `asset-reviewer-data`)
5. Select your project and click **Create**

### 2. Get Your Edge Config Connection String

1. In your Edge Config dashboard, click on your config
2. Copy the connection string (looks like: `https://your-config.edge-config.vercel.app`)
3. Add it to your Vercel environment variables:
   - Go to **Settings** → **Environment Variables**
   - Add a new variable:
     - **Name**: `EDGE_CONFIG`
     - **Value**: Your connection string
     - **Environment**: Production (and Preview if needed)

### 3. Deploy Your Application

The application will now use Edge Config for data persistence instead of file-based databases.

## Benefits of Edge Config

✅ **True Persistence**: Data survives deployments and cold starts  
✅ **Global Distribution**: Data is available worldwide with low latency  
✅ **Automatic Scaling**: No database management required  
✅ **Cost Effective**: Pay only for what you use  
✅ **Reliable**: Built on Vercel's infrastructure  

## How It Works

- **Asset Storage**: Each asset is stored as a key-value pair (`asset_12345` → asset data)
- **Automatic Fallback**: If Edge Config is unavailable, falls back to in-memory storage
- **Batch Operations**: Supports efficient bulk import/export operations
- **Real-time Updates**: Changes are immediately available across all instances

## Migration from File-based Database

If you have existing data in a file-based database:

1. Export your data using the **Backup & Restore** feature
2. Deploy the new Edge Config version
3. Import your data using the same backup file

Your data will be automatically migrated to Edge Config and persist permanently.

## Troubleshooting

### Edge Config Not Available
- Check that `EDGE_CONFIG` environment variable is set correctly
- Verify your Edge Config is created and active in Vercel dashboard
- The app will fall back to in-memory storage for local development

### Data Not Persisting
- Ensure you're using the production environment
- Check Vercel logs for Edge Config errors
- Verify your connection string is correct

### Performance Issues
- Edge Config has built-in caching for optimal performance
- Large datasets are automatically optimized
- Consider using batch operations for bulk data operations
