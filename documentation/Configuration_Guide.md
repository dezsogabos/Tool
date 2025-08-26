# Google Drive Asset Reviewer - Configuration Guide

## 🎯 Single Configuration Source

All application configuration is centralized in **one file**: `resources/.env`

## 📁 Configuration File Location

```
rit-vue-app/
├── resources/
│   ├── .env                    # ← ALL CONFIGURATION HERE
│   └── directional_all_assets_predictions.csv
├── server/
│   ├── config.json            # ← Only CSV path (legacy)
│   └── index.cjs
└── ...
```

## 🔧 Required Configuration

### 1. Create the `.env` file
Create `resources/.env` with the following content:

```env
# Google Drive API Configuration
GOOGLE_DRIVE_API_KEY=your_api_key_here
GOOGLE_DRIVE_CLIENT_ID=your_client_id_here
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret_here
ALL_DATASET_FOLDER_ID=your_google_drive_folder_id_here

# Authentication
USERNAME=admin
PASSWORD=admin

# Server Configuration
PORT=5174
```

### 2. Required Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ALL_DATASET_FOLDER_ID` | Google Drive folder containing images | For online mode |
| `GOOGLE_DRIVE_API_KEY` | Google Drive API key | For online mode |
| `GOOGLE_DRIVE_CLIENT_ID` | Google Drive OAuth client ID | For online mode |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Google Drive OAuth client secret | For online mode |
| `USERNAME` | Login username | Yes |
| `PASSWORD` | Login password | Yes |
| `PORT` | Server port (default: 5174) | No |

## 🚀 Modes of Operation

### Online Mode (Google Drive)
- Requires all Google Drive API variables
- Images loaded from Google Drive
- Requires internet connection

### Offline Mode (Local Files)
- Only requires `USERNAME` and `PASSWORD`
- Images loaded from local file system
- Works without internet connection
- Configure local image path in the application settings

## ✅ Verification

After creating the `.env` file, restart the server and check the console output:

```
Environment variable check:
- ALL_DATASET_FOLDER_ID from env: SET
- Final ALL_DATASET_FOLDER_ID value: your_folder_id_here
✅ ALL_DATASET_FOLDER_ID is properly configured for Google Drive API
```

## 🚨 Common Issues

### "injecting env (0) from .env"
- **Cause**: `.env` file is empty or has formatting issues
- **Solution**: Check file format (no spaces around `=`, no quotes)

### "ALL_DATASET_FOLDER_ID from env: NOT SET"
- **Cause**: Variable not defined in `.env` file
- **Solution**: Add the variable to `resources/.env`

### File not found
- **Cause**: `.env` file in wrong location
- **Solution**: Ensure file is in `resources/.env` (not `server/.env`)

## 📝 File Format Rules

1. **No spaces around `=`**: `KEY=value` (not `KEY = value`)
2. **No quotes unless needed**: `KEY=value` (not `KEY="value"`)
3. **One variable per line**
4. **Comments start with `#`**
5. **No trailing spaces**

## 🔄 Migration from Legacy Config

If you previously used `server/config.json` for configuration:

1. **Move all variables** to `resources/.env`
2. **Keep only CSV path** in `server/config.json`
3. **Restart the server**

---

**Last Updated**: August 2025  
**Version**: 1.0.0
