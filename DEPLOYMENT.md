# 🚀 Vercel Deployment Guide

## Prerequisites
- GitHub repository with your code
- Vercel account (free at vercel.com)

## Step 1: Connect to Vercel

1. **Go to [vercel.com](https://vercel.com)** and sign up/login
2. **Click "New Project"**
3. **Import your GitHub repository**: `dezsogabos/Tool`
4. **Select the repository** and click "Import"

## Step 2: Configure Environment Variables

In your Vercel project settings, add these environment variables:

### Required Environment Variables:
```
app_usr=your_username
app_auth=your_password
api_credentials={"type": "service_account","project_id": "your-project-id","private_key_id": "your-private-key-id","private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n","client_email": "your-service-account@your-project.iam.gserviceaccount.com","client_id": "your-client-id","auth_uri": "https://accounts.google.com/o/oauth2/auth","token_uri": "https://oauth2.googleapis.com/token","auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com","universe_domain": "googleapis.com"}
ALL_DATASET_FOLDER_ID=your_folder_id_here
CSV_PATH=directional_all_assets_predictions.csv
```

### How to add them:
1. Go to your project in Vercel Dashboard
2. Click "Settings" → "Environment Variables"
3. Add each variable with the appropriate value
4. Select "Production" and "Preview" environments

## Step 3: Deploy

1. **Click "Deploy"** in Vercel
2. **Wait for build to complete** (usually 2-3 minutes)
3. **Your app will be live** at `https://your-project-name.vercel.app`

## Step 4: Custom Domain (Optional)

1. Go to "Settings" → "Domains"
2. Add your custom domain
3. Follow DNS configuration instructions

## Troubleshooting

### Build Errors:
- Check that all environment variables are set
- Ensure `package.json` has correct build script
- Verify `vercel.json` configuration

### Runtime Errors:
- Check Vercel function logs in dashboard
- Verify Google API credentials are correct
- Ensure CSV file path is accessible

### Database Issues:
- SQLite database will be created automatically
- Data persists between deployments
- Consider using external database for production

## File Structure for Vercel:
```
├── vercel.json          # Vercel configuration
├── package.json         # Build scripts
├── vite.config.js       # Vite configuration
├── .vercelignore        # Files to exclude
├── src/                 # Vue.js frontend
├── server/              # Express.js backend
└── resources/           # Data files
```

## Support:
- Vercel Documentation: https://vercel.com/docs
- Vue.js on Vercel: https://vercel.com/guides/deploying-vuejs-to-vercel
- Express.js on Vercel: https://vercel.com/guides/deploying-expressjs-to-vercel
