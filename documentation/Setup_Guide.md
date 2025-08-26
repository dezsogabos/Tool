# Google Drive Asset Reviewer - Setup Guide

## 🔧 Configuration Requirements

### 1. Google Drive API Setup

To use the online mode (Google Drive API), you need to configure the following:

#### A. Google Drive API Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API
4. Create credentials (API Key and OAuth 2.0 Client ID)
5. Download the credentials

#### B. Environment Configuration
You have two options for configuration:

**Option 1: Using .env file (Recommended)**
Create a `.env` file in the `resources/` directory:
```env
GOOGLE_DRIVE_API_KEY=your_api_key_here
GOOGLE_DRIVE_CLIENT_ID=your_client_id_here
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret_here
ALL_DATASET_FOLDER_ID=your_folder_id_here
USERNAME=admin
PASSWORD=admin
```

**Option 2: Using config.json (Legacy - Not Recommended)**
The `server/config.json` file only contains the CSV path. All other configuration should be in `resources/.env`.

### 2. Finding Your Google Drive Folder ID

1. **Open Google Drive** in your browser
2. **Navigate** to the folder containing your asset images
3. **Copy the folder ID** from the URL:
   - URL format: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - The folder ID is the long string after `/folders/`

### 3. Offline Mode Setup

If you prefer to use local files instead of Google Drive:

1. **Enable Offline Mode** in the Settings tab
2. **Set Local Image Path** to your image directory
3. **File Naming Convention**: Images should be named with their asset ID (e.g., `12345.jpg`)

### 4. Verification

After configuration:

1. **Start the server**: `cd server && node index.cjs`
2. **Start the frontend**: `npm run dev`
3. **Check console logs** for any configuration errors
4. **Test image loading** by searching for an asset ID

## 🚨 Common Issues

### "Missing ALL_DATASET_FOLDER_ID" Error
- **Cause**: The Google Drive folder ID is not configured in `resources/.env`
- **Solution**: 
  - **Option 1**: Set `ALL_DATASET_FOLDER_ID` to a valid Google Drive folder ID in `resources/.env` for online mode
  - **Option 2**: Use offline mode with local images (recommended if you don't need Google Drive)
  - **Note**: The application will work in offline mode even without Google Drive configuration

### "API Key Invalid" Error
- **Cause**: Google Drive API credentials are incorrect
- **Solution**: Verify your API key and ensure Google Drive API is enabled

### Images Not Loading
- **Cause**: Folder ID is incorrect or permissions are wrong
- **Solution**: Verify the folder ID and ensure the folder is accessible

## 📞 Support

If you encounter issues:
1. Check the console logs for detailed error messages
2. Verify all configuration values are correct
3. Ensure Google Drive API is properly enabled
4. Test with a simple asset ID first

---

**Last Updated**: August 2025  
**Version**: 1.0.0
