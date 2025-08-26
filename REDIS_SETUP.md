# Redis Setup Guide

This application now uses Redis for persistent data storage instead of Vercel Blob Store. Redis provides much better performance and reliability for datasets under 30MB.

## Setup Options

### Option 1: Redis Cloud (Recommended for Production)

1. **Sign up for Redis Cloud** (https://redis.com/try-free/)
   - Free tier includes 30MB storage
   - Perfect for this application

2. **Create a new database**
   - Choose the free tier
   - Select a region close to your Vercel deployment

3. **Get your connection details**
   - Copy the Redis URL from your dashboard
   - Format: `redis://username:password@host:port`

4. **Set environment variable in Vercel**
   ```bash
   REDIS_URL=redis://username:password@host:port
   ```

### Option 2: Upstash Redis (Vercel Integration)

1. **Install Upstash Redis** in your Vercel project
   - Go to your Vercel dashboard
   - Navigate to Storage tab
   - Add Upstash Redis integration

2. **Environment variable will be automatically set**
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

3. **Update the Redis client configuration** in `server/index.cjs`:
   ```javascript
   const url = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL || 'redis://localhost:6379'
   ```

### Option 3: Local Redis (Development)

1. **Install Redis locally**
   ```bash
   # macOS
   brew install redis
   
   # Ubuntu/Debian
   sudo apt-get install redis-server
   
   # Windows (WSL recommended)
   sudo apt-get install redis-server
   ```

2. **Start Redis server**
   ```bash
   redis-server
   ```

3. **Default connection** (no environment variable needed)
   - Uses `redis://localhost:6379` by default

## Environment Variables

Add to your `.env` file or Vercel environment:

```bash
# For Redis Cloud or other Redis providers
REDIS_URL=redis://username:password@host:port

# For Upstash Redis (if using Vercel integration)
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

## Performance Benefits

- **Faster operations**: Redis is an in-memory database with disk persistence
- **Batch operations**: Uses Redis pipelines for efficient batch writes
- **No storage limits**: Unlike Vercel Blob Store, Redis has much higher limits
- **Better reliability**: Redis is designed for high-performance data storage

## Data Structure

Assets are stored in Redis with the following key pattern:
- Key: `asset:{assetId}`
- Value: JSON string containing asset data

Example:
```
Key: asset:3877
Value: {"asset_id":"3877","predicted_asset_ids":"[123,456,789]","matching_scores":"[0.95,0.87,0.76]"}
```

## Monitoring

You can monitor your Redis usage through:
- Redis Cloud dashboard
- Upstash dashboard
- Redis CLI: `redis-cli info memory`

## Troubleshooting

1. **Connection issues**: Check your `REDIS_URL` environment variable
2. **Memory limits**: Monitor your Redis memory usage
3. **Performance**: Redis pipelines are used for batch operations to improve performance

## Migration from Blob Store

If you have existing data in Vercel Blob Store:
1. Export your data using the existing export functionality
2. Set up Redis as described above
3. Import your data using the import functionality
4. The application will automatically use Redis for new operations
