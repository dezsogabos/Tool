# Google Drive Asset Reviewer - User Guide

## 🎯 Overview

The Google Drive Asset Reviewer is a powerful tool designed for efficiently reviewing and managing image assets with AI predictions. This application helps you accept or reject predicted image matches, track your review progress, and export your results for analysis.

## 🚀 Getting Started

### First Time Setup

1. **Access the Application**
   - Open your web browser
   - Navigate to the application URL
   - Login with your credentials (default: admin/admin)

2. **Configure Google Drive Access** (if using online mode)
   - Set up Google Drive API credentials
   - Configure the `ALL_DATASET_FOLDER_ID` in `resources/.env` file
   - This folder should contain all your asset images

2. **Initial Configuration**
   - The application will automatically load your asset database
   - Review the interface and familiarize yourself with the layout

### Interface Overview

The application is organized into five main tabs:
- **Asset Review**: Main review interface
- **Export Data**: Data export and backup features
- **Settings**: Application configuration
- **Analytics**: Performance and progress tracking
- **About**: Application information

## 📋 Asset Review Tab

### Searching for Assets

#### Method 1: Direct Search
1. **Enter Asset ID**: Type the specific asset ID in the search field
2. **Press Enter** or click the **Search** button
3. **View Results**: The asset and its predicted matches will be displayed

#### Method 2: Browse Assets
1. **Use Pagination**: Navigate through pages using First/Previous/Next/Last buttons
2. **Filter Options**: Use the filter dropdown to view:
   - All assets
   - Accepted assets
   - Rejected assets
   - Not yet reviewed assets
3. **Page Size**: Adjust how many assets to display per page (10, 20, 50, 100)

### Asset Display

#### Reference Image
- **Main Asset**: The primary image you're reviewing
- **Asset ID**: Displayed below the image
- **Magnifier Icon**: Click to view the image in full-screen modal
- **Source Indicator**: Shows whether the image is loaded from local files or Google API

#### Predicted Images
- **AI Matches**: Images that AI has identified as similar
- **Score Display**: Confidence score for each prediction
- **Selection Interface**: Click to select/deselect predicted matches
- **Visual Feedback**: Selected images have green borders, rejected have red borders

### Review Actions

#### Accepting Assets
1. **Select Predictions**: Click on the predicted images you want to accept
2. **Choose Action**:
   - **Accept Selected**: Accept only the selected predictions
   - **Accept All**: Accept all predicted matches
   - **Complete Review**: Automatically determine status based on selections

#### Rejecting Assets
1. **Select Predictions**: Click on the predicted images you want to reject
2. **Choose Action**:
   - **Reject Selected**: Reject only the selected predictions
   - **Reject All**: Reject all predicted matches
   - **Complete Review**: Automatically determine status based on selections

#### Clearing Reviews
- **Clear Review**: Remove the current review and start over
- **Individual Selection**: Click on selected images to deselect them

### Navigation

#### Keyboard Shortcuts
- **Arrow Left/Right**: Navigate between assets
- **Enter**: Complete the current review
- **Delete**: Clear the current review

#### Visual Indicators
- **Asset Pills**: Color-coded asset IDs show review status
  - Gray: Not reviewed
  - Green: Accepted
  - Red: Rejected
- **Progress Tracking**: See your review progress in real-time

## 📊 Export Data Tab

### Export Options

#### CSV Export
- **Purpose**: Export filtered review data for analysis
- **Format**: Standard CSV with columns: Asset ID, Predicted ID, Score, Status
- **Filtering**: Export all data or filter by accepted/rejected status
- **Usage**: Click "Export to CSV" button

#### Backup Export
- **Purpose**: Create a complete backup of all review data
- **Format**: JSON file with metadata and complete review data
- **Features**: Includes export date, version, and statistics
- **Usage**: Click "Export Backup" button

#### Backup Import
- **Purpose**: Restore review data from a previous backup
- **Process**: 
  1. Click "Import Backup" button
  2. Select your backup JSON file
  3. Review the import details
  4. Type "IMPORT" to confirm
- **Safety**: Shows detailed comparison before importing

### Preview System

#### Data Preview
- **Table View**: See your data in a formatted table
- **Pagination**: Navigate through large datasets
- **Filtering**: Filter by accepted/rejected status
- **Page Size**: Adjust how many rows to display

#### Preview Controls
- **Filter Dropdown**: Select which data to preview
- **Page Navigation**: First, Previous, Next, Last buttons
- **Page Size**: Choose 5, 10, 20, or 50 items per page

## ⚙️ Settings Tab

### Appearance Settings

#### Dark Mode
- **Toggle**: Switch between light and dark themes
- **Automatic**: Setting is saved and restored automatically
- **Benefits**: Reduces eye strain in low-light conditions

### Offline Mode Settings

#### Enable Offline Mode
- **Purpose**: Use local image files instead of Google Drive API
- **Benefits**: Faster loading, works without internet
- **Setup**: 
  1. Check "Enable Offline Mode"
  2. Select your local image directory
  3. Images should be named with asset IDs (e.g., "12345.jpg")

#### Local Image Path
- **Selection**: Use the folder picker to select your image directory
- **Requirements**: Images must be named with asset IDs
- **Supported Formats**: JPG, JPEG, PNG, GIF, BMP, WebP
- **Fallback**: If local image not found, falls back to Google API

### Review Data Management

#### Clear All Reviews
- **Purpose**: Reset all review data to start fresh
- **Warning**: This action cannot be undone
- **Confirmation**: Type "I AM SURE" to confirm
- **Alternative**: Use individual "Clear Review" buttons instead

#### Ultimate Reset
- **Purpose**: Reset all application data including settings
- **Scope**: Clears reviews, settings, cache, and navigation state
- **Warning**: This is a complete factory reset
- **Confirmation**: Type "RESET EVERYTHING" to confirm

## 📈 Analytics Tab

### Review Analytics

#### Progress Tracking
- **Total Assets**: Total number of assets in the database
- **Total Reviewed**: Number of assets you've reviewed
- **Accepted**: Number of accepted assets
- **Rejected**: Number of rejected assets
- **Target IDs**: Total number of selected predicted IDs

### Cache Analytics

#### Performance Metrics
- **Asset Cache**: Number of cached asset data items
- **Image Cache**: Number of cached image URLs
- **Cache Hit Rate**: Percentage of cache hits vs misses
- **Cache Size**: Estimated memory usage in MB
- **Pre-fetched Assets**: Number of assets loaded in background
- **Pre-fetching Status**: Active or Idle

#### Cache Management
- **Clear All Caches**: Free up memory and reset performance metrics
- **Automatic Cleanup**: Caches are automatically cleaned up
- **Performance Impact**: Higher cache hit rates mean faster loading

## 🔧 Advanced Features

### Image Source Tracking

#### Source Indicators
- **Local File Icon**: Image loaded from local file system
- **Cloud Icon**: Image loaded from Google Drive API
- **Automatic Detection**: Application automatically detects the source
- **Fallback System**: If local file fails, automatically tries Google API

### Pre-fetching System

#### Background Loading
- **Automatic**: Next 3 assets are loaded in the background
- **Performance**: Reduces perceived loading times
- **Memory Management**: Automatically manages memory usage
- **Status Tracking**: See pre-fetching status in Analytics

### Data Persistence

#### Automatic Saving
- **Review Data**: All reviews are automatically saved
- **Settings**: All settings are automatically saved
- **Navigation State**: Current page and position are saved
- **Recovery**: Data is restored when you return to the application

#### Backup Strategy
- **Regular Backups**: Export your data regularly
- **Multiple Formats**: Use both CSV and JSON backups
- **Version Control**: Backup files include version information
- **Safe Import**: Import system validates data before restoring

## 🎯 Best Practices

### Efficient Reviewing

1. **Use Keyboard Shortcuts**: Arrow keys for navigation, Enter for completion
2. **Batch Operations**: Use "Complete Review" for faster processing
3. **Filter Strategically**: Use filters to focus on specific asset types
4. **Regular Backups**: Export your data regularly to prevent loss

### Performance Optimization

1. **Enable Offline Mode**: Use local images for faster loading
2. **Monitor Cache**: Check cache hit rates in Analytics
3. **Clear Caches**: Periodically clear caches to free memory
4. **Use Appropriate Page Sizes**: Balance between speed and usability

### Data Management

1. **Regular Exports**: Export data regularly for analysis
2. **Backup Strategy**: Create backups before major changes
3. **Import Validation**: Always review import details before confirming
4. **Progress Tracking**: Monitor your progress in Analytics

## 🆘 Troubleshooting

### Common Issues

#### Images Not Loading
- **Check Internet**: Ensure you have internet connection
- **Verify Path**: Check local image path in settings
- **File Names**: Ensure local images are named with asset IDs
- **File Formats**: Check if file format is supported

#### Slow Performance
- **Clear Caches**: Use "Clear All Caches" in Analytics
- **Check Cache Hit Rate**: Monitor performance in Analytics
- **Reduce Page Size**: Use smaller page sizes
- **Enable Offline Mode**: Use local images for faster loading

#### Data Loss
- **Check Backups**: Look for recent backup files
- **Import Backup**: Use the import feature to restore data
- **Check localStorage**: Data is automatically saved in browser
- **Contact Support**: If issues persist, contact technical support

#### Login Issues
- **Check Credentials**: Verify username and password
- **Clear Browser Cache**: Clear browser cache and cookies
- **Try Different Browser**: Test with a different browser
- **Contact Admin**: Contact system administrator

### Error Messages

#### "No assets match the current filter"
- **Solution**: Change the filter or review some assets first
- **Action**: Use the filter dropdown to select "All" or "Not Yet Reviewed"

#### "Local image not found"
- **Solution**: Check local image path and file names
- **Action**: Verify images are named with asset IDs and in the correct directory

#### "Failed to save application state"
- **Solution**: Check browser storage space
- **Action**: Clear browser cache or try a different browser

## 📞 Support

### Getting Help
- **Documentation**: Refer to this user guide
- **Analytics**: Check performance metrics for issues
- **Settings**: Review application configuration
- **Technical Support**: Contact your system administrator

### Feature Requests
- **Suggestions**: Provide feedback on new features
- **Improvements**: Report usability issues
- **Enhancements**: Request additional functionality

---

**Last Updated**: August 2025  
**Version**: 1.0.0  
**Application**: Google Drive Asset Reviewer
