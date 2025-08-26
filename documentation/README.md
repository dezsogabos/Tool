# Google Drive Asset Reviewer - Developer Documentation

## 🚀 Overview

The Google Drive Asset Reviewer is a comprehensive Vue.js 3 application designed for reviewing and managing image assets with AI predictions. It provides an intuitive interface for accepting/rejecting predicted images, managing review workflows, and exporting data for analysis.

## 🏗️ Architecture

### Frontend
- **Framework**: Vue.js 3 with Composition API
- **Build Tool**: Vite
- **Styling**: CSS with CSS Variables for theming
- **State Management**: Vue 3 reactive system with localStorage persistence

### Backend
- **Runtime**: Node.js with Express.js
- **Database**: SQLite with better-sqlite3
- **Authentication**: Simple username/password system
- **File Serving**: Static file serving for images and assets

### Key Technologies
- **Vue 3 Composition API**: Modern reactive state management
- **Express.js**: RESTful API server
- **SQLite**: Lightweight database for asset storage
- **Google Drive API**: Image retrieval and management
- **Local Storage**: Client-side data persistence

## 📁 Project Structure

```
rit-vue-app/
├── src/
│   ├── views/
│   │   └── HomeView.vue          # Main application component
│   ├── stores/
│   │   └── auth.js              # Authentication store
│   ├── components/              # Reusable components
│   └── assets/                  # Static assets
├── server/
│   ├── index.cjs               # Express server
│   ├── database.js             # Database operations
│   └── google-drive.js         # Google Drive API integration
├── resources/
│   ├── .env                     # Environment configuration
│   └── directional_all_assets_predictions.csv  # Initial data
└── documentation/              # This documentation
```

## 🛠️ Setup & Installation

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Google Drive API credentials

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd rit-vue-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd server
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the resources directory:
   ```env
   GOOGLE_DRIVE_API_KEY=your_api_key_here
   GOOGLE_DRIVE_CLIENT_ID=your_client_id_here
   GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret_here
   ALL_DATASET_FOLDER_ID=your_google_drive_folder_id_here
   USERNAME=admin
   PASSWORD=admin
   ```
   
   **Important**: All configuration is centralized in the `resources/.env` file. The `server/config.json` only contains the CSV path.

4. **Database Setup**
   The application automatically initializes the SQLite database from the CSV file on first run.

5. **Start the application**
   ```bash
   # Terminal 1: Start the backend server
   cd server
   node index.cjs
   
   # Terminal 2: Start the frontend development server
   cd ..
   npm run dev
   ```

## 🔧 Core Features

### 1. Asset Review System
- **Search by Asset ID**: Direct asset lookup
- **Pagination**: Navigate through large datasets
- **Filtering**: Filter by review status (all, accepted, rejected, not reviewed)
- **Keyboard Navigation**: Arrow keys for navigation, Enter for completion

### 2. Image Management
- **Reference Images**: Display main asset images
- **Predicted Images**: Show AI-predicted matches
- **Image Preview**: Modal view for detailed inspection
- **Source Tracking**: Local vs Google API image sources
- **Offline Mode**: Local file system integration

### 3. Review Workflow
- **Accept/Reject**: Binary decision system
- **Predicted ID Selection**: Choose specific predicted matches
- **Batch Operations**: Complete review with single action
- **Progress Tracking**: Visual indicators for review status

### 4. Data Export & Import
- **CSV Export**: Filtered data export for analysis
- **JSON Backup**: Complete data backup and restore
- **Preview System**: Data preview before export
- **Import Validation**: Safe data import with validation

### 5. Caching & Performance
- **Asset Caching**: In-memory asset data caching
- **Image URL Caching**: Optimized image loading
- **Pre-fetching**: Background loading of upcoming assets
- **LRU Eviction**: Automatic cache cleanup

### 6. Settings & Configuration
- **Dark Mode**: Theme switching
- **Offline Mode**: Local file system integration
- **Cache Management**: Performance monitoring and control
- **Data Persistence**: Automatic state saving

## 🗄️ Database Schema

### Assets Table
```sql
CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    reference_file_id TEXT,
    reference_asset_id TEXT,
    predicted_data TEXT  -- JSON string of predictions
);
```

### Key Data Structures

#### Asset Object
```javascript
{
  id: "asset_id",
  reference: {
    fileId: "google_drive_file_id",
    assetId: "asset_id"
  },
  predicted: [
    {
      id: "predicted_asset_id",
      fileId: "google_drive_file_id",
      score: 0.95
    }
  ]
}
```

#### Review Data
```javascript
{
  "asset_id": {
    status: "accepted" | "rejected",
    predictedIds: ["id1", "id2"],
    predictedData: [
      { id: "id1", score: 0.95 },
      { id: "id2", score: 0.87 }
    ]
  }
}
```

## 🔌 API Endpoints

### Authentication
- `POST /api/login` - User authentication

### Asset Management
- `GET /api/assets/:id` - Get specific asset data
- `GET /api/assets-page` - Get paginated assets
- `GET /api/images/:fileId` - Serve Google Drive images
- `GET /api/local-images/:filename` - Serve local images

### Data Export
- `GET /api/export/csv` - Export review data as CSV

## 🎨 UI Components

### Main Components
- **SearchBar**: Asset ID input and search
- **AssetGrid**: Paginated asset display
- **ImagePreview**: Modal image viewer
- **ReviewControls**: Accept/reject buttons
- **ExportPanel**: Data export interface
- **SettingsPanel**: Application configuration

### Styling System
- **CSS Variables**: Theme-aware styling
- **Responsive Design**: Mobile-friendly layout
- **Dark Mode**: Complete theme switching
- **Animations**: Smooth transitions and effects

## 🔄 State Management

### Reactive Variables
```javascript
// Core state
const assetId = ref('')
const reviewedAssets = ref({})
const page = ref(1)
const loading = ref(false)

// Settings
const darkMode = ref(false)
const offlineMode = ref(false)
const localImagePath = ref('')

// Cache system
const assetCache = ref(new Map())
const imageUrlCache = ref(new Map())
```

### Persistence Strategy
- **localStorage**: Client-side data persistence
- **Auto-save**: Debounced state saving
- **Data validation**: Timestamp-based validation
- **Error recovery**: Graceful fallbacks

## 🚀 Performance Optimizations

### Caching Strategy
- **Asset Cache**: 5-minute TTL with LRU eviction
- **Image Cache**: URL-based caching with offline mode support
- **Pre-fetching**: Background loading of next 3 assets
- **Lazy Loading**: Images loaded on demand

### Memory Management
- **Cache Size Limits**: Maximum 100 cached items
- **Automatic Cleanup**: Expired cache removal
- **Memory Monitoring**: Cache statistics tracking

## 🧪 Development Guidelines

### Code Style
- **Vue 3 Composition API**: Use `ref`, `computed`, `watch`
- **Reactive Patterns**: Proper dependency tracking
- **Error Handling**: Try-catch blocks with user feedback
- **Performance**: Debounced operations and caching

### Adding Features
1. **State Management**: Add reactive variables
2. **UI Components**: Create reusable components
3. **API Integration**: Add backend endpoints
4. **Persistence**: Implement localStorage saving
5. **Testing**: Add error handling and validation

### Debugging
- **Console Logging**: Comprehensive logging system
- **Cache Monitoring**: Real-time cache statistics
- **Error Tracking**: Detailed error messages
- **Performance Metrics**: Cache hit/miss tracking

## 🔒 Security Considerations

### Authentication
- **Simple Auth**: Username/password system
- **Session Management**: Server-side session handling
- **API Protection**: Protected endpoints

### Data Security
- **Input Validation**: Client and server-side validation
- **File Upload**: Secure file handling
- **Data Sanitization**: XSS prevention

## 📊 Monitoring & Analytics

### Performance Metrics
- **Cache Hit Rate**: Real-time cache performance
- **Load Times**: Asset and image loading metrics
- **User Actions**: Review completion tracking
- **Error Rates**: Application error monitoring

### Data Export
- **Review Statistics**: Accepted/rejected counts
- **Progress Tracking**: Completion percentages
- **Performance Data**: Cache and loading metrics

## 🚀 Deployment

### Production Build
```bash
npm run build
```

### Server Deployment
- **Static Files**: Serve from `dist/` directory
- **API Server**: Deploy Express.js server
- **Database**: Ensure SQLite file permissions
- **Environment**: Configure production environment variables in `resources/.env` (single configuration source)

### Docker Deployment
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5174
CMD ["node", "server/index.cjs"]
```

## 🤝 Contributing

### Development Workflow
1. **Feature Branch**: Create feature-specific branches
2. **Code Review**: Submit pull requests for review
3. **Testing**: Ensure all features work correctly
4. **Documentation**: Update relevant documentation

### Code Standards
- **ESLint**: Follow linting rules
- **Prettier**: Consistent code formatting
- **Vue Style Guide**: Follow Vue.js best practices
- **Performance**: Consider performance implications

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For technical support or questions:
- **Issues**: Create GitHub issues for bugs
- **Documentation**: Refer to user documentation
- **Code**: Review source code and comments

---

**Last Updated**: August 2025
**Version**: 1.0.0
