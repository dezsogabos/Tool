<template>
  <div class="import-container">
    <div class="import-card">
      <h2>📁 Import CSV Data</h2>
      <p class="description">
        Upload your CSV file to initialize the database with asset prediction data.
      </p>

      <!-- File Upload Section -->
      <div class="upload-section">
        <div 
          class="upload-area"
          :class="{ 'drag-over': isDragOver, 'has-file': selectedFile }"
          @drop="handleDrop"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @click="triggerFileInput"
        >
          <div v-if="!selectedFile" class="upload-placeholder">
            <div class="upload-icon">📄</div>
            <p>Drop your CSV file here or click to browse</p>
            <p class="file-types">Supported: .csv files</p>
          </div>
          <div v-else class="file-info">
            <div class="file-icon">📄</div>
            <div class="file-details">
              <p class="file-name">{{ selectedFile.name }}</p>
              <p class="file-size">{{ formatFileSize(selectedFile.size) }}</p>
            </div>
            <button @click.stop="removeFile" class="remove-btn">✕</button>
          </div>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept=".csv"
          @change="handleFileSelect"
          style="display: none"
        />
      </div>

      <!-- Import Options -->
      <div v-if="selectedFile" class="import-options">
        <h3>Import Options</h3>
        
        <div class="option-group">
          <label class="checkbox-label">
            <input 
              type="checkbox" 
              v-model="options.clearExisting"
              :disabled="importing"
            />
            <span class="checkmark"></span>
            Clear existing data before import
          </label>
        </div>

        <div class="option-group">
          <label class="checkbox-label">
            <input 
              type="checkbox" 
              v-model="options.skipDuplicates"
              :disabled="importing"
            />
            <span class="checkmark"></span>
            Skip duplicate entries
          </label>
        </div>

        <div class="option-group">
          <label>Batch Size:</label>
          <select v-model="options.batchSize" :disabled="importing">
            <option value="100">100 records</option>
            <option value="500">500 records</option>
            <option value="1000">1000 records</option>
            <option value="5000">5000 records</option>
          </select>
        </div>
      </div>

      <!-- Import Button -->
      <div v-if="selectedFile" class="import-actions">
        <button 
          @click="startImport"
          :disabled="importing"
          class="import-btn"
          :class="{ 'importing': importing }"
        >
          <span v-if="!importing">🚀 Start Import</span>
          <span v-else>
            <span class="spinner"></span>
            Importing... {{ importProgress }}%
          </span>
        </button>
      </div>

      <!-- Progress Section -->
      <div v-if="importing" class="progress-section">
        <div class="progress-bar">
          <div 
            class="progress-fill"
            :style="{ width: importProgress + '%' }"
          ></div>
        </div>
        <p class="progress-text">
          {{ progressMessage }}
        </p>
      </div>

      <!-- Results Section -->
      <div v-if="importResult" class="results-section">
        <h3>Import Results</h3>
        <div class="result-stats">
          <div class="stat-item">
            <span class="stat-label">Total Records:</span>
            <span class="stat-value">{{ importResult.totalRecords }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Imported:</span>
            <span class="stat-value success">{{ importResult.imported }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Skipped:</span>
            <span class="stat-value warning">{{ importResult.skipped }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Errors:</span>
            <span class="stat-value error">{{ importResult.errors }}</span>
          </div>
        </div>
        
        <div v-if="importResult.errorDetails.length > 0" class="error-details">
          <h4>Error Details:</h4>
          <div class="error-list">
            <div v-for="(error, index) in importResult.errorDetails" :key="index" class="error-item">
              <span class="error-line">Line {{ error.line }}:</span>
              <span class="error-message">{{ error.message }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Database Status -->
      <div class="database-status">
        <h3>Database Status</h3>
        <div class="status-info">
          <p><strong>Current Records:</strong> {{ dbStatus.totalRecords || 'Loading...' }}</p>
          <p><strong>Last Updated:</strong> {{ dbStatus.lastUpdated || 'Never' }}</p>
        </div>
        <button @click="refreshDbStatus" class="refresh-btn" :disabled="refreshing">
          🔄 Refresh Status
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ImportView',
  data() {
    return {
      selectedFile: null,
      isDragOver: false,
      importing: false,
      refreshing: false,
      importProgress: 0,
      progressMessage: '',
      options: {
        clearExisting: false,
        skipDuplicates: true,
        batchSize: 1000
      },
      importResult: null,
      dbStatus: {
        totalRecords: null,
        lastUpdated: null
      }
    }
  },
  mounted() {
    this.refreshDbStatus()
  },
  methods: {
    triggerFileInput() {
      this.$refs.fileInput.click()
    },
    
    handleFileSelect(event) {
      const file = event.target.files[0]
      if (file && file.type === 'text/csv' || file.name.endsWith('.csv')) {
        this.selectedFile = file
      } else {
        alert('Please select a valid CSV file')
      }
    },
    
    handleDrop(event) {
      event.preventDefault()
      this.isDragOver = false
      
      const files = event.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
          this.selectedFile = file
        } else {
          alert('Please drop a valid CSV file')
        }
      }
    },
    
    handleDragOver(event) {
      event.preventDefault()
      this.isDragOver = true
    },
    
    handleDragLeave(event) {
      event.preventDefault()
      this.isDragOver = false
    },
    
    removeFile() {
      this.selectedFile = null
      this.importResult = null
      this.$refs.fileInput.value = ''
    },
    
    formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    },
    
    async startImport() {
      if (!this.selectedFile) return
      
      this.importing = true
      this.importProgress = 0
      this.progressMessage = 'Reading CSV file...'
      this.importResult = null
      
      try {
        const formData = new FormData()
        formData.append('file', this.selectedFile)
        formData.append('options', JSON.stringify(this.options))
        
        const response = await fetch('/api/import-csv', {
          method: 'POST',
          body: formData
        })
        
        if (!response.ok) {
          throw new Error(`Import failed: ${response.statusText}`)
        }
        
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line)
                if (data.type === 'progress') {
                  this.importProgress = data.progress
                  this.progressMessage = data.message
                } else if (data.type === 'result') {
                  this.importResult = data.result
                  this.importProgress = 100
                  this.progressMessage = 'Import completed!'
                }
              } catch (e) {
                // Skip invalid JSON lines
              }
            }
          }
        }
        
        // Refresh database status after import
        await this.refreshDbStatus()
        
      } catch (error) {
        console.error('Import error:', error)
        this.progressMessage = `Import failed: ${error.message}`
        this.importResult = {
          totalRecords: 0,
          imported: 0,
          skipped: 0,
          errors: 1,
          errorDetails: [{ line: 0, message: error.message }]
        }
      } finally {
        this.importing = false
      }
    },
    
    async refreshDbStatus() {
      this.refreshing = true
      try {
        const response = await fetch('/api/db-status')
        if (response.ok) {
          this.dbStatus = await response.json()
        }
      } catch (error) {
        console.error('Failed to get database status:', error)
      } finally {
        this.refreshing = false
      }
    }
  }
}
</script>

<style scoped>
.import-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.import-card {
  background: white;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

h2 {
  color: #2c3e50;
  margin-bottom: 10px;
  text-align: center;
}

.description {
  color: #666;
  text-align: center;
  margin-bottom: 30px;
}

.upload-section {
  margin-bottom: 30px;
}

.upload-area {
  border: 2px dashed #ddd;
  border-radius: 8px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: #fafafa;
}

.upload-area:hover {
  border-color: #3498db;
  background: #f0f8ff;
}

.upload-area.drag-over {
  border-color: #3498db;
  background: #e3f2fd;
  transform: scale(1.02);
}

.upload-area.has-file {
  border-color: #27ae60;
  background: #f0fff4;
}

.upload-placeholder .upload-icon {
  font-size: 48px;
  margin-bottom: 15px;
}

.upload-placeholder p {
  margin: 5px 0;
  color: #666;
}

.file-types {
  font-size: 14px;
  color: #999;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
}

.file-icon {
  font-size: 32px;
}

.file-details {
  text-align: left;
}

.file-name {
  font-weight: bold;
  margin: 0;
  color: #2c3e50;
}

.file-size {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.remove-btn {
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remove-btn:hover {
  background: #c0392b;
}

.import-options {
  margin-bottom: 30px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
}

.import-options h3 {
  margin-top: 0;
  color: #2c3e50;
}

.option-group {
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500;
}

.checkbox-label input[type="checkbox"] {
  display: none;
}

.checkmark {
  width: 20px;
  height: 20px;
  border: 2px solid #ddd;
  border-radius: 4px;
  position: relative;
  transition: all 0.3s ease;
}

.checkbox-label input[type="checkbox"]:checked + .checkmark {
  background: #3498db;
  border-color: #3498db;
}

.checkbox-label input[type="checkbox"]:checked + .checkmark::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 12px;
  font-weight: bold;
}

.option-group select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
}

.import-actions {
  text-align: center;
  margin-bottom: 30px;
}

.import-btn {
  background: linear-gradient(135deg, #3498db, #2980b9);
  color: white;
  border: none;
  padding: 15px 30px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 200px;
}

.import-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
}

.import-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.import-btn.importing {
  background: linear-gradient(135deg, #f39c12, #e67e22);
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
  margin-right: 8px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.progress-section {
  margin-bottom: 30px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3498db, #2980b9);
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  color: #666;
  margin: 0;
}

.results-section {
  margin-bottom: 30px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
}

.results-section h3 {
  margin-top: 0;
  color: #2c3e50;
}

.result-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background: white;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.stat-label {
  font-weight: 500;
  color: #666;
}

.stat-value {
  font-weight: bold;
  color: #2c3e50;
}

.stat-value.success {
  color: #27ae60;
}

.stat-value.warning {
  color: #f39c12;
}

.stat-value.error {
  color: #e74c3c;
}

.error-details {
  border-top: 1px solid #ddd;
  padding-top: 15px;
}

.error-details h4 {
  margin-top: 0;
  color: #e74c3c;
}

.error-list {
  max-height: 200px;
  overflow-y: auto;
}

.error-item {
  display: flex;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid #eee;
}

.error-line {
  font-weight: bold;
  color: #e74c3c;
  min-width: 80px;
}

.error-message {
  color: #666;
}

.database-status {
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
}

.database-status h3 {
  margin-top: 0;
  color: #2c3e50;
}

.status-info {
  margin-bottom: 15px;
}

.status-info p {
  margin: 5px 0;
  color: #666;
}

.refresh-btn {
  background: #95a5a6;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.3s ease;
}

.refresh-btn:hover:not(:disabled) {
  background: #7f8c8d;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
