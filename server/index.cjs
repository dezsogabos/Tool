const express = require('express')
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const dotenv = require('dotenv')
const { parse } = require('csv-parse/sync')
const fileUpload = require('express-fileupload')
const { createClient } = require('@vercel/edge-config')
const { createClient: createTursoClient } = require('@libsql/client')

// Load env (if present)
dotenv.config()
// Also try loading from resources directory
try {
  const resourcesEnvPath = path.resolve(__dirname, '../resources/.env')
  if (fs.existsSync(resourcesEnvPath)) {
    dotenv.config({ path: resourcesEnvPath })
  }
} catch (_) {}
// Also try loading the Streamlit source .env as a fallback
try {
  const streamlitEnvPath = path.resolve(__dirname, '../../Streamlit source/.env')
  if (fs.existsSync(streamlitEnvPath)) {
    dotenv.config({ path: streamlitEnvPath })
  }
} catch (_) {}

const app = express()

// Middleware
app.use(express.json({ limit: '10mb' })) // Increase limit to 10MB for large review datasets
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  abortOnLimit: true,
  createParentPath: true
}))

// CORS headers for Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err)
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message,
    timestamp: new Date().toISOString()
  })
})

const PORT = process.env.PORT || 3001

// Load config from file if available
const configPath = path.resolve(__dirname, 'config.json')
let fileConfig = {}
if (fs.existsSync(configPath)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch (e) {
    console.warn('Failed to parse server/config.json:', e.message)
  }
}

function resolveCsvPath() {
  const rawCandidates = []
  if (process.env.CSV_PATH) rawCandidates.push(process.env.CSV_PATH)
  if (fileConfig.CSV_PATH) rawCandidates.push(fileConfig.CSV_PATH)
  rawCandidates.push(path.resolve(__dirname, '../../Streamlit source/directional_all_assets_predictions.csv'))
  for (const raw of rawCandidates) {
    if (!raw) continue
    const probes = []
    if (path.isAbsolute(raw)) {
      probes.push(raw)
    } else {
      probes.push(
        path.resolve(__dirname, raw),
        path.resolve(__dirname, '../resources/', raw),
        path.resolve(__dirname, '../', raw),
        path.resolve(__dirname, '../../Streamlit source/', raw),
        path.resolve(process.cwd(), raw),
      )
    }
    for (const p of probes) {
      if (fs.existsSync(p)) return p
    }
  }
  return ''
}

const CSV_PATH = resolveCsvPath()
console.log('Resolved CSV path:', CSV_PATH)
console.log('CSV exists:', CSV_PATH ? fs.existsSync(CSV_PATH) : false)
const ALL_DATASET_FOLDER_ID = process.env.ALL_DATASET_FOLDER_ID || ''
let apiCredentialsStr = process.env.api_credentials || process.env.API_CREDENTIALS || ''
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || ''

// Debug logging for environment variables
console.log('Environment variable check:')
console.log('- ALL_DATASET_FOLDER_ID from env:', process.env.ALL_DATASET_FOLDER_ID ? 'SET' : 'NOT SET')
console.log('- Final ALL_DATASET_FOLDER_ID value:', ALL_DATASET_FOLDER_ID ? ALL_DATASET_FOLDER_ID : 'EMPTY')

if (!ALL_DATASET_FOLDER_ID) {
  console.warn('Warning: ALL_DATASET_FOLDER_ID is not properly configured. Google Drive API features will be disabled. Use offline mode with local images instead.')
} else {
  console.log('✅ ALL_DATASET_FOLDER_ID is properly configured for Google Drive API')
}

let driveClient = null
function getDrive() {
  if (driveClient) return driveClient
  
  // If no Google Drive credentials are configured, return null
  if (!ALL_DATASET_FOLDER_ID || (!apiCredentialsStr && !credentialsPath)) {
    console.log('Google Drive API not configured - running in offline mode')
    return null
  }
  
  let serviceAccountInfo = null
  try {
    if (apiCredentialsStr) {
      serviceAccountInfo = JSON.parse(apiCredentialsStr)
    } else if (credentialsPath && fs.existsSync(path.resolve(__dirname, credentialsPath))) {
      const raw = fs.readFileSync(path.resolve(__dirname, credentialsPath), 'utf-8')
      serviceAccountInfo = JSON.parse(raw)
    } else if (credentialsPath && fs.existsSync(credentialsPath)) {
      const raw = fs.readFileSync(credentialsPath, 'utf-8')
      serviceAccountInfo = JSON.parse(raw)
    } else {
      console.warn('Google Drive API credentials not found - running in offline mode')
      return null
    }
    
    const auth = new (require('googleapis').google.auth.GoogleAuth)({
      credentials: serviceAccountInfo,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
    driveClient = require('googleapis').google.drive({ version: 'v3', auth })
    return driveClient
  } catch (error) {
    console.error('Error initializing Google Drive API:', error.message)
    console.warn('Running in offline mode without Google Drive API')
    return null
  }
}

let dataset = null
function loadDataset() {
  if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at ${CSV_PATH || '(unset)'}`)
  }
  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const records = parse(content, { columns: true, skip_empty_lines: true })
  dataset = records
}

// Turso SQLite client for persistent data storage
// This ensures data persists between serverless function invocations and sessions

// Edge Config client setup (for configuration only, not data storage)
let edgeConfigClient = null
function getEdgeConfig() {
  if (!edgeConfigClient) {
    try {
      edgeConfigClient = createClient(process.env.EDGE_CONFIG)
      console.log('✅ Edge Config client initialized for configuration')
    } catch (error) {
      console.warn('⚠️ Edge Config not available for configuration:', error.message)
      edgeConfigClient = null
    }
  }
  return edgeConfigClient
}

// Turso client setup
let tursoClient = null
async function getTursoClient() {
  if (!tursoClient) {
    try {
      const url = process.env.TURSO_DATABASE_URL
      const authToken = process.env.TURSO_AUTH_TOKEN
      
      // For local development, use in-memory SQLite if no Turso URL is provided
      if (!url || !authToken) {
        console.log('🔧 Local development detected - using in-memory SQLite')
        // For local development, create an in-memory database
        tursoClient = createTursoClient({
          url: 'file::memory:?cache=shared'
        })
      } else {
        console.log('🌐 Production detected - using Turso SQLite')
        tursoClient = createTursoClient({
          url: url,
          authToken: authToken
        })
      }
      
      // Test the connection
      await tursoClient.execute('SELECT 1')
      console.log('✅ SQLite client connected')
      
      // Initialize the database schema (pass the client directly to avoid circular dependency)
      await initializeTursoSchema(tursoClient)
      
    } catch (error) {
      console.error('❌ Failed to initialize SQLite client:', error.message)
      tursoClient = null
    }
  }
  return tursoClient
}

// Initialize SQLite database schema
async function initializeTursoSchema(client = null) {
  try {
    if (!client) {
      client = await getTursoClient()
    }
    if (!client) return
    
    // Create assets table if it doesn't exist
    await client.execute(`
      CREATE TABLE IF NOT EXISTS assets (
        asset_id TEXT PRIMARY KEY,
        predicted_asset_ids TEXT,
        matching_scores TEXT,
        file_ids TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Add file_ids column if it doesn't exist (for existing databases)
    try {
      await client.execute(`
        ALTER TABLE assets ADD COLUMN file_ids TEXT
      `)
      console.log('✅ Added file_ids column to assets table')
    } catch (error) {
      // Column already exists, ignore error
      console.log('ℹ️ file_ids column already exists or could not be added')
    }
    
    // Create import_jobs table for chunked imports
    await client.execute(`
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
    `)
    
    // Create import_chunks table for storing chunk data
    await client.execute(`
      CREATE TABLE IF NOT EXISTS import_chunks (
        job_id TEXT,
        chunk_index INTEGER,
        chunk_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (job_id, chunk_index)
      )
    `)
    
    console.log('✅ SQLite database schema initialized')
  } catch (error) {
    console.error('❌ Failed to initialize SQLite schema:', error.message)
  }
}

// Asset storage functions using SQLite
async function getAsset(assetId) {
  try {
    console.log(`🔍 Getting asset ${assetId} from SQLite`)
    
    const client = await getTursoClient()
    if (!client) {
      console.log(`🔍 SQLite client not available`)
      return null
    }
    
    const result = await client.execute({
      sql: 'SELECT asset_id, predicted_asset_ids, matching_scores, file_ids FROM assets WHERE asset_id = ?',
      args: [assetId]
    })
    
    if (result.rows.length > 0) {
      const row = result.rows[0]
      const assetData = {
        asset_id: row.asset_id,
        predicted_asset_ids: row.predicted_asset_ids,
        matching_scores: row.matching_scores,
        file_ids: row.file_ids
      }
      console.log(`🔍 Asset ${assetId} retrieved from Turso`)
      return assetData
    } else {
      console.log(`🔍 Asset ${assetId} not found in Turso`)
      return null
    }
  } catch (error) {
    console.warn(`Failed to get asset ${assetId} from Turso:`, error.message)
    return null
  }
}

async function setAsset(assetId, data) {
  try {
    console.log(`🔍 setAsset called for ${assetId} - saving to SQLite`)
    
    const client = await getTursoClient()
    if (!client) {
      console.error(`❌ Turso client not available for asset ${assetId}`)
      throw new Error('Turso client not available')
    }
    
    console.log(`🔍 Executing SQL for asset ${assetId}`)
    
    // Insert or update the asset data
    await client.execute({
      sql: `INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores, file_ids, updated_at) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [assetId, data.predicted_asset_ids, data.matching_scores, data.file_ids]
    })
    
    console.log(`✅ Asset ${assetId} saved to SQLite`)
  } catch (error) {
    console.error(`❌ Failed to save asset ${assetId} to SQLite:`, error.message)
    console.error(`❌ Error stack:`, error.stack)
    throw error
  }
}

// Simple asset operations - no batching needed for SQLite
async function setAssetsBatch(assetsData) {
  try {
    console.log(`🔍 Saving ${Object.keys(assetsData).length} assets to Turso`)
    
    const client = await getTursoClient()
    if (!client) {
      throw new Error('Turso client not available')
    }
    
    let successful = 0
    let failed = 0
    const errors = []
    
    for (const [assetId, data] of Object.entries(assetsData)) {
      try {
        await client.execute({
          sql: `INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores, file_ids, updated_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          args: [assetId, data.predicted_asset_ids, data.matching_scores, data.file_ids]
        })
        successful++
      } catch (error) {
        console.error(`❌ Failed to save asset ${assetId}:`, error.message)
        failed++
        errors.push({ assetId, error: error.message })
      }
    }
    
    console.log(`✅ Save completed: ${successful} successful, ${failed} failed`)
    return { successful, failed, errors }
  } catch (error) {
    console.error('❌ Save failed:', error.message)
    throw error
  }
}

// Simple batch deletion - no transaction needed
async function deleteAssetsBatch(assetIds) {
  try {
    console.log(`🔍 Deleting ${assetIds.length} assets from Turso`)
    
    const client = await getTursoClient()
    if (!client) {
      throw new Error('Turso client not available')
    }
    
    let successful = 0
    let failed = 0
    const errors = []
    
    for (const assetId of assetIds) {
      try {
        await client.execute({
          sql: 'DELETE FROM assets WHERE asset_id = ?',
          args: [assetId]
        })
        successful++
      } catch (error) {
        console.error(`❌ Failed to delete asset ${assetId}:`, error.message)
        failed++
        errors.push({ assetId, error: error.message })
      }
    }
    
    console.log(`✅ Deletion completed: ${successful} successful, ${failed} failed`)
    return { successful, failed, errors }
  } catch (error) {
    console.error('❌ Deletion failed:', error.message)
    throw error
  }
}

async function getAllAssets() {
  try {
    console.log('🔍 getAllAssets called - reading from Turso')
    
    const client = await getTursoClient()
    if (!client) {
      console.log('🔍 Turso client not available')
      return {}
    }
    
    const result = await client.execute({
      sql: 'SELECT asset_id, predicted_asset_ids, matching_scores, file_ids FROM assets ORDER BY asset_id'
    })
    
    const assets = {}
    for (const row of result.rows) {
      assets[row.asset_id] = {
        asset_id: row.asset_id,
        predicted_asset_ids: row.predicted_asset_ids,
        matching_scores: row.matching_scores,
        file_ids: row.file_ids
      }
    }
    
    console.log(`🔍 Turso returned ${Object.keys(assets).length} assets`)
    return assets
  } catch (error) {
    console.error('❌ Failed to get all assets from Turso:', error.message)
    return {}
  }
}

async function deleteAllAssets() {
  try {
    console.log('🔍 deleteAllAssets called - clearing Turso')
    
    const client = await getTursoClient()
    if (!client) {
      throw new Error('Turso client not available')
    }
    
    const result = await client.execute('DELETE FROM assets')
    console.log(`✅ Cleared all assets from Turso (${result.rowsAffected} rows affected)`)
  } catch (error) {
    console.error('❌ Failed to clear Turso:', error.message)
    throw error
  }
}

async function getAssetCount() {
  try {
    const client = await getTursoClient()
    if (!client) {
      return 0
    }
    
    const result = await client.execute('SELECT COUNT(*) as count FROM assets')
    return result.rows[0].count
  } catch (error) {
    console.warn('Failed to get asset count from Turso:', error.message)
    return 0
  }
}

// Initialize database with sample data if empty (local development only)
async function initializeDatabase() {
  // Check if we're using in-memory database (local development)
  const isLocalDevelopment = !process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN
  
  if (process.env.NODE_ENV === 'production' && !isLocalDevelopment) {
    console.log('Production environment: Database will be populated by CSV imports')
    return
  }
  
  // Check if we already have assets in Turso
  const count = await getAssetCount()
  if (count > 0) {
    console.log(`Turso already has ${count} assets`)
    return
  }
  
  // Load CSV and import (local development)
  if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
    console.log('CSV not found; database remains empty.')
    return
  }
  
  console.log('Loading CSV from:', CSV_PATH)
  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const records = parse(content, { columns: true, skip_empty_lines: true })
  console.log('Parsed', records.length, 'records from CSV')
  
  console.log('🚀 Starting fast batch import (without Google Drive API calls)...')
  
  // Use batch operations for much faster import
  const client = await getTursoClient()
  if (!client) {
    console.error('❌ Turso client not available for batch import')
    return
  }
  
  // Prepare batch data
  const batchData = []
  for (const record of records) {
    const assetId = String(record.asset_id ?? '').trim()
    if (assetId) {
      batchData.push({
        asset_id: assetId,
        predicted_asset_ids: String(record.predicted_asset_ids ?? ''),
        matching_scores: String(record.matching_scores ?? ''),
        file_ids: String(record.file_ids ?? '')
      })
    }
  }
  
  console.log(`📦 Prepared ${batchData.length} records for batch import`)
  
  // Use batch insert for much better performance
  let imported = 0
  const batchSize = 1000 // Process in batches of 1000
  
  for (let i = 0; i < batchData.length; i += batchSize) {
    const batch = batchData.slice(i, i + batchSize)
    console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(batchData.length / batchSize)} (${batch.length} records)`)
    
    try {
      // Use a transaction for better performance
      await client.execute('BEGIN TRANSACTION')
      
      for (const asset of batch) {
        await client.execute({
          sql: `INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores, file_ids, updated_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          args: [asset.asset_id, asset.predicted_asset_ids, asset.matching_scores, asset.file_ids]
        })
      }
      
      await client.execute('COMMIT')
      imported += batch.length
      
      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed: ${batch.length} records imported`)
    } catch (error) {
      await client.execute('ROLLBACK')
      console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message)
    }
  }
  
  console.log(`🎉 Fast import completed: ${imported} records imported successfully`)
  console.log(`💡 Note: File IDs will be fetched on-demand when assets are accessed`)
}

// Initialize database on startup (non-blocking)
initializeDatabase().catch(error => {
  console.error('Database initialization error:', error)
})

function parseArrayField(value) {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  const str = String(value).trim()
  // Try JSON first (after normalizing single quotes)
  try {
    const normalized = str.replace(/'/g, '"')
    const arr = JSON.parse(normalized)
    return Array.isArray(arr) ? arr : []
  } catch (_) {}
  // Fallback: basic bracket stripping and comma split
  try {
    const trimmed = str.replace(/^\[|\]$/g, '')
    if (!trimmed) return []
    return trimmed.split(',').map(s => s.replace(/['\s]/g, '')).filter(Boolean)
  } catch (_) {
    return []
  }
}

// Database-stored file ID mapping for permanent storage
async function getBatchFileIds(assetIds) {
  console.log(`🔍 getBatchFileIds called for ${assetIds.length} assets`)
  
  const drive = getDrive()
  if (!drive || !ALL_DATASET_FOLDER_ID) {
    console.log(`❌ Google Drive not available for batch lookup`)
    return {}
  }
  
  try {
    // First, check if we have file IDs stored in the database
    const client = await getTursoClient()
    if (!client) {
      console.log(`❌ Turso client not available for file ID lookup`)
      return {}
    }
    
    // Check if we have any file IDs stored in the database
    const dbCheck = await client.execute({
      sql: 'SELECT COUNT(*) as count FROM assets WHERE file_ids IS NOT NULL AND file_ids != "" AND file_ids != "{}"',
      args: []
    })
    
    const hasStoredFileIds = dbCheck.rows[0].count > 0
    
         if (hasStoredFileIds) {
       console.log(`📦 Using database-stored file ID mappings`)
       
       // Look up file IDs for requested asset IDs from database
       const result = {}
       const missingAssetIds = []
       
       for (const assetId of assetIds) {
         const fileId = await getCachedFileId(assetId)
         if (fileId) {
           result[assetId] = fileId
         } else {
           missingAssetIds.push(assetId)
         }
       }
       
       console.log(`🔍 Database lookup completed: ${Object.values(result).filter(id => id !== null).length} file IDs found`)
       
            // If we have missing file IDs, fetch them from Google Drive
     if (missingAssetIds.length > 0) {
       console.log(`🔍 Fetching ${missingAssetIds.length} missing file IDs from Google Drive...`)
       
       let cachedCount = 0
       
       // Use bulk lookup for larger batches, individual lookups for smaller ones
       if (missingAssetIds.length > 10) {
         // Bulk lookup for efficiency
         const bulkFileIds = await getBulkFileIds(missingAssetIds)
         
         for (const assetId of missingAssetIds) {
           const fileId = bulkFileIds[assetId] || null
           if (fileId) {
             // Cache the file ID (don't await to avoid blocking)
             setCachedFileId(assetId, fileId).catch(error => {
               console.warn(`Failed to cache file ID for ${assetId}:`, error.message)
             })
             cachedCount++
           }
           result[assetId] = fileId
         }
       } else {
         // Individual lookups for smaller batches
         const missingFileIdPromises = missingAssetIds.map(async (assetId) => {
           try {
             const fileId = await getFileIdByAssetId(assetId)
             if (fileId) {
               // Cache the file ID (don't await to avoid blocking)
               setCachedFileId(assetId, fileId).catch(error => {
                 console.warn(`Failed to cache file ID for ${assetId}:`, error.message)
               })
             }
             return { assetId, fileId }
           } catch (error) {
             console.warn(`Failed to get file ID for ${assetId}:`, error.message)
             return { assetId, fileId: null }
           }
         })
         
         // Wait for all file ID lookups to complete
         const missingResults = await Promise.all(missingFileIdPromises)
         
         // Update result with found file IDs
         for (const { assetId, fileId } of missingResults) {
           result[assetId] = fileId
           if (fileId) cachedCount++
         }
       }
       
       console.log(`✅ Fetched and cached ${cachedCount} missing file IDs`)
     }
       
       return result
     }
    
    // No file IDs in database, fetch all from Google Drive and store permanently
    console.log(`🔄 No file IDs in database, fetching all files from Google Drive and storing permanently...`)
    const allFiles = []
    let pageToken = null
    
    do {
      const response = await drive.files.list({
        q: `'${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id, name), nextPageToken',
        pageSize: 1000,
        pageToken: pageToken
      })
      
      allFiles.push(...(response.data.files || []))
      pageToken = response.data.nextPageToken
    } while (pageToken)
    
    console.log(`🔍 Found ${allFiles.length} total files in Google Drive folder`)
    
    // Create a map of filename to file ID
    const fileIdMap = {}
    for (const file of allFiles) {
      const nameWithoutExt = file.name.replace(/\.(jpg|jpeg|png|gif|bmp|webp)$/i, '')
      fileIdMap[nameWithoutExt] = file.id
    }
    
    console.log(`💾 Storing ${Object.keys(fileIdMap).length} file mappings permanently in database...`)
    
    // Store all file IDs in the database permanently
    let storedCount = 0
    for (const [assetId, fileId] of Object.entries(fileIdMap)) {
      try {
        await setCachedFileId(assetId, fileId)
        storedCount++
      } catch (error) {
        console.warn(`Failed to store file ID for ${assetId}:`, error.message)
      }
    }
    
    console.log(`✅ Permanently stored ${storedCount} file mappings in database`)
    
    // Look up file IDs for requested asset IDs
    const result = {}
    for (const assetId of assetIds) {
      result[assetId] = fileIdMap[assetId] || null
    }
    
    console.log(`🔍 Batch lookup completed: ${Object.values(result).filter(id => id !== null).length} file IDs found`)
    return result
    
  } catch (error) {
    console.error(`❌ Error in batch file ID lookup:`, error.message)
    return {}
  }
}

// Function to clear all file IDs from database (useful for debugging or forcing refresh)
async function clearAllFileIds() {
  try {
    const client = await getTursoClient()
    if (!client) {
      console.log('❌ Turso client not available')
      return
    }
    
    await client.execute('UPDATE assets SET file_ids = NULL')
    console.log('🧹 All file IDs cleared from database')
  } catch (error) {
    console.error('Failed to clear file IDs:', error.message)
  }
}

// Bulk file ID lookup for multiple assets (more efficient)
async function getBulkFileIds(assetIds) {
  const drive = getDrive()
  if (!drive || !ALL_DATASET_FOLDER_ID) {
    return {}
  }
  
  try {
    // Create a single query for all asset IDs with all extensions
    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
    const nameConditions = []
    
    for (const assetId of assetIds) {
      for (const ext of extensions) {
        nameConditions.push(`name='${assetId}.${ext}'`)
      }
    }
    
    if (nameConditions.length === 0) return {}
    
    const q = `(${nameConditions.join(' or ')}) and '${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`
    
    const res = await drive.files.list({ 
      q, 
      fields: 'files(id, name)',
      pageSize: 1000
    })
    
    const items = res.data.files || []
    const result = {}
    
    // Map file names back to asset IDs
    for (const file of items) {
      const nameWithoutExt = file.name.replace(/\.(jpg|jpeg|png|gif|bmp|webp)$/i, '')
      if (assetIds.includes(nameWithoutExt)) {
        result[nameWithoutExt] = file.id
      }
    }
    
    return result
  } catch (error) {
    console.error('Error in bulk file ID lookup:', error.message)
    return {}
  }
}

// Function to get file ID storage status
async function getFileIdStorageStatus() {
  try {
    const client = await getTursoClient()
    if (!client) {
      return { stored: false, fileCount: 0 }
    }
    
    const result = await client.execute({
      sql: 'SELECT COUNT(*) as total, COUNT(CASE WHEN file_ids IS NOT NULL AND file_ids != "" AND file_ids != "{}" THEN 1 END) as withFileIds FROM assets',
      args: []
    })
    
    const total = result.rows[0].total
    const withFileIds = result.rows[0].withFileIds
    
    return {
      stored: withFileIds > 0,
      totalAssets: total,
      assetsWithFileIds: withFileIds,
      percentage: total > 0 ? Math.round((withFileIds / total) * 100) : 0
    }
  } catch (error) {
    console.error('Failed to get file ID storage status:', error.message)
    return { stored: false, fileCount: 0, error: error.message }
  }
}

async function getFileIdByAssetId(assetId) {
  // First, check if we have a cached file ID in the database
  const cachedFileId = await getCachedFileId(assetId)
  if (cachedFileId) {
    console.log(`✅ Found cached file ID for ${assetId}: ${cachedFileId}`)
    return cachedFileId
  }
  
  const drive = getDrive()
  if (!drive || !ALL_DATASET_FOLDER_ID) {
    return null
  }
  
  try {
    // Try all extensions in a single query using OR conditions
    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
    const nameConditions = extensions.map(ext => `name='${assetId}.${ext}'`).join(' or ')
    const q = `(${nameConditions}) and '${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`
    
    const res = await drive.files.list({ q, fields: 'files(id, name)' })
    const items = res.data.files || []
    
    if (items.length > 0) {
      const fileId = items[0].id
      
      // Cache the file ID for future use (don't await to avoid blocking)
      setCachedFileId(assetId, fileId).catch(error => {
        console.warn(`Failed to cache file ID for ${assetId}:`, error.message)
      })
      
      return fileId
    }
    
    return null
  } catch (error) {
    console.error(`Error getting file ID for asset ${assetId}:`, error.message)
    return null
  }
}

// File ID caching and background processing functions
function parseFileIds(fileIdsStr) {
  if (!fileIdsStr) return {}
  try {
    return JSON.parse(fileIdsStr)
  } catch (error) {
    console.warn(`Failed to parse file_ids JSON: ${fileIdsStr}`, error.message)
    return {}
  }
}

function serializeFileIds(fileIdsObj) {
  try {
    return JSON.stringify(fileIdsObj)
  } catch (error) {
    console.warn('Failed to serialize file_ids object:', error.message)
    return '{}'
  }
}

async function getCachedFileId(assetId) {
  try {
    const client = await getTursoClient()
    if (!client) return null
    
    const result = await client.execute({
      sql: 'SELECT file_ids FROM assets WHERE asset_id = ?',
      args: [assetId]
    })
    
    if (result.rows.length > 0 && result.rows[0].file_ids) {
      const fileIds = parseFileIds(result.rows[0].file_ids)
      return fileIds[assetId] || null
    }
    return null
  } catch (error) {
    console.warn(`Failed to get cached file ID for ${assetId}:`, error.message)
    return null
  }
}

async function setCachedFileId(assetId, fileId) {
  try {
    const client = await getTursoClient()
    if (!client) return false
    
    // Get existing file_ids
    const result = await client.execute({
      sql: 'SELECT file_ids FROM assets WHERE asset_id = ?',
      args: [assetId]
    })
    
    let fileIds = {}
    if (result.rows.length > 0 && result.rows[0].file_ids) {
      fileIds = parseFileIds(result.rows[0].file_ids)
    }
    
    // Update the file ID for this asset
    fileIds[assetId] = fileId
    
    // Save back to database
    await client.execute({
      sql: 'UPDATE assets SET file_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ?',
      args: [serializeFileIds(fileIds), assetId]
    })
    
    console.log(`✅ Cached file ID for asset ${assetId}: ${fileId}`)
    return true
  } catch (error) {
    console.error(`Failed to cache file ID for ${assetId}:`, error.message)
    return false
  }
}

async function getAssetsMissingFileIds(limit = 100) {
  try {
    const client = await getTursoClient()
    if (!client) return []
    
    const result = await client.execute({
      sql: `SELECT asset_id FROM assets 
            WHERE file_ids IS NULL OR file_ids = '' OR file_ids = '{}'
            ORDER BY updated_at ASC
            LIMIT ?`,
      args: [limit]
    })
    
    return result.rows.map(row => row.asset_id)
  } catch (error) {
    console.error('Failed to get assets missing file IDs:', error.message)
    return []
  }
}

// Background process to populate missing file IDs
let backgroundProcessRunning = false
let backgroundProcessInterval = null

async function startBackgroundFileIdPopulation() {
  if (backgroundProcessRunning) {
    console.log('🔄 Background file ID population already running')
    return
  }
  
  console.log('🚀 Starting background file ID population process')
  backgroundProcessRunning = true
  
  // Run immediately but don't block server startup
  populateMissingFileIds().catch(error => {
    console.warn('⚠️ Background file ID population failed:', error.message)
  })
  
  // Then run every 15 minutes (less frequent to reduce interference)
  backgroundProcessInterval = setInterval(async () => {
    if (!backgroundProcessRunning) return
    try {
      await populateMissingFileIds()
    } catch (error) {
      console.warn('⚠️ Background file ID population failed:', error.message)
    }
  }, 15 * 60 * 1000) // 15 minutes
}

async function stopBackgroundFileIdPopulation() {
  console.log('⏹️ Stopping background file ID population process')
  backgroundProcessRunning = false
  if (backgroundProcessInterval) {
    clearInterval(backgroundProcessInterval)
    backgroundProcessInterval = null
  }
}

async function populateMissingFileIds() {
  try {
    console.log('🔄 Starting file ID population batch...')
    
    const drive = getDrive()
    if (!drive || !ALL_DATASET_FOLDER_ID) {
      console.log('⚠️ Google Drive not available for file ID population')
      return
    }
    
    // Get assets missing file IDs (smaller batch to reduce interference)
    const assetIds = await getAssetsMissingFileIds(20) // Process 20 at a time
    if (assetIds.length === 0) {
      console.log('✅ No assets missing file IDs')
      return
    }
    
    console.log(`🔄 Processing ${assetIds.length} assets for file ID population`)
    
    // Use batch lookup for efficiency
    const fileIdMap = await getBatchFileIds(assetIds)
    
    // Cache the results
    let cachedCount = 0
    for (const assetId of assetIds) {
      const fileId = fileIdMap[assetId]
      if (fileId) {
        await setCachedFileId(assetId, fileId)
        cachedCount++
      }
    }
    
    console.log(`✅ File ID population completed: ${cachedCount}/${assetIds.length} file IDs cached`)
    
  } catch (error) {
    console.error('❌ Error in file ID population:', error.message)
  }
}

// API endpoint to manually trigger file ID population
app.post('/api/populate-file-ids', async (req, res) => {
  try {
    console.log('🔄 Manual file ID population requested')
    
    const { batchSize = 50 } = req.body || {}
    
    // Start the background process if not already running
    if (!backgroundProcessRunning) {
      startBackgroundFileIdPopulation()
    }
    
    res.json({ 
      ok: true, 
      message: 'File ID population started',
      batchSize: parseInt(batchSize)
    })
  } catch (error) {
    console.error('❌ Error starting file ID population:', error.message)
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    })
  }
})

// API endpoint to check background process status
app.get('/api/background-status', async (req, res) => {
  try {
    const missingCount = await getAssetsMissingFileIds(1000) // Get count of missing file IDs
    
    res.json({
      ok: true,
      backgroundProcessRunning,
      missingFileIds: missingCount.length,
      message: backgroundProcessRunning ? 'Background process is running' : 'Background process is stopped'
    })
  } catch (error) {
    console.error('❌ Error getting background status:', error.message)
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    })
  }
})

// API endpoint to stop background process
app.post('/api/stop-background-process', async (req, res) => {
  try {
    console.log('⏹️ Manual background process stop requested')
    
    await stopBackgroundFileIdPopulation()
    
    res.json({ 
      ok: true, 
      message: 'Background process stopped'
    })
  } catch (error) {
    console.error('❌ Error stopping background process:', error.message)
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    })
  }
})

app.get('/api/health', async (_req, res) => {
  try {
    console.log('Health check requested')
    
    // Debug credentials
    const apiCredentialsStr = process.env.api_credentials || process.env.API_CREDENTIALS || ''
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
    
    console.log('Credentials debug:')
    console.log('- api_credentials length:', apiCredentialsStr.length)
    console.log('- API_CREDENTIALS length:', (process.env.API_CREDENTIALS || '').length)
    console.log('- GOOGLE_APPLICATION_CREDENTIALS:', credentialsPath)
    
    // Test Google Drive API availability
    const drive = getDrive()
    const driveStatus = drive ? 'available' : 'not available'
    console.log('Google Drive API status:', driveStatus)
    
    // Test Google Drive API with a simple query
    let driveTestResult = 'not tested'
    if (drive && ALL_DATASET_FOLDER_ID) {
      try {
        console.log('Testing Google Drive API with simple query...')
        const testRes = await drive.files.list({ 
          q: `'${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`, 
          fields: 'files(id, name)',
          pageSize: 3
        })
        const testItems = testRes.data.files || []
        driveTestResult = `found ${testItems.length} files in folder`
        console.log('Drive test result:', driveTestResult)
        if (testItems.length > 0) {
          console.log('Sample files:', testItems.slice(0, 2).map(f => `${f.name} (${f.id})`))
        }
      } catch (testError) {
        driveTestResult = `error: ${testError.message}`
        console.log('Drive test error:', testError.message)
      }
    }
    
    res.json({ 
      ok: true, 
      timestamp: new Date().toISOString(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        app_usr_set: !!process.env.app_usr,
        app_auth_set: !!process.env.app_auth,
        ALL_DATASET_FOLDER_ID: process.env.ALL_DATASET_FOLDER_ID ? 'SET' : 'NOT SET',
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'SET' : 'NOT SET',
        api_credentials_length: apiCredentialsStr.length,
        API_CREDENTIALS_length: (process.env.API_CREDENTIALS || '').length
      },
      googleDrive: driveStatus,
      driveTest: driveTestResult,
      message: 'Server is running'
    })
  } catch (error) {
    console.error('Health check error:', error)
    res.status(500).json({
      ok: false,
      error: error.message
    })
  }
})

// Login verification - supports multiple credential sources
app.post('/api/login', (req, res) => {
  try {
    console.log('Login attempt received')
    
    // Validate request body
    if (!req.body) {
      console.log('No request body provided')
      return res.status(400).json({ ok: false, error: 'No request body provided' })
    }
    
    const { username, password } = req.body
    console.log('Login attempt for username:', username ? 'provided' : 'missing')
    
    // Handle missing credentials gracefully
    if (!username || !password) {
      console.log('Missing username or password')
      return res.json({ ok: false, error: 'Username and password required' })
    }
    
    // Try multiple environment variable sources for credentials
    const possibleUsers = [
      process.env.app_usr,
      process.env.APP_USR,
      process.env.USERNAME,
      process.env.USER
    ].filter(Boolean)
    
    const possiblePasswords = [
      process.env.app_auth,
      process.env.APP_AUTH,
      process.env.PASSWORD,
      process.env.PASS
    ].filter(Boolean)
    
    // Debug environment variables
    console.log('Environment variables check:')
    console.log('- Possible users found:', possibleUsers.length)
    console.log('- Possible passwords found:', possiblePasswords.length)
    console.log('- NODE_ENV:', process.env.NODE_ENV)
    
    // Check if any environment credentials match
    let isEnvMatch = false
    for (const expectedUser of possibleUsers) {
      for (const expectedPass of possiblePasswords) {
        if (String(username) === String(expectedUser) && String(password) === String(expectedPass)) {
          isEnvMatch = true
          console.log('Environment credentials matched')
          break
        }
      }
      if (isEnvMatch) break
    }
    
    // Always allow admin/admin as fallback
    const isAdminDefault = String(username) === 'admin' && String(password) === 'admin'
    
    console.log('Env match:', isEnvMatch, 'Admin default:', isAdminDefault)
    const ok = isEnvMatch || isAdminDefault
    console.log('Login result:', ok)
    
    res.json({ ok })
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json({ ok: false, error: 'Login failed', details: e.message })
  }
})

app.get('/api/assets/:assetId', async (req, res) => {
  try {
    const searchId = String(req.params.assetId).trim()
    const { includeFileIds = 'true', offline } = req.query // Allow skipping file ID lookup and check offline mode
    
    if (!searchId) return res.status(400).json({ error: 'assetId required' })

    // Get asset from Turso
    const assetData = await getAsset(searchId)
    
    if (!assetData) {
      console.log(`🔍 Asset ${searchId} not found in Turso`)
      return res.json({ 
        assetId: searchId, 
        reference: { fileId: null },
        predicted: []
      })
    }
    
    const predictedIds = parseArrayField(assetData.predicted_asset_ids).map(String)
    const predictedScores = parseArrayField(assetData.matching_scores).map(s => Number(s))

    // Only try to get Google Drive file IDs if requested and configured
    let referenceFileId = null
    let predicted = []
    
    console.log(`🔍 Processing asset ${searchId} - includeFileIds: ${includeFileIds}, offline: ${offline}, ALL_DATASET_FOLDER_ID: ${ALL_DATASET_FOLDER_ID ? 'SET' : 'NOT SET'}`)
    
    // In offline mode, skip Google API calls entirely
    if (offline === 'true') {
      console.log(`🔍 Offline mode - skipping Google API calls for asset ${searchId}`)
      for (let i = 0; i < predictedIds.length; i += 1) {
        const pid = String(predictedIds[i])
        const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
        predicted.push({ id: pid, score, fileId: null })
      }
    } else if (includeFileIds === 'true' && ALL_DATASET_FOLDER_ID) {
      try {
        console.log(`🔍 Attempting to get reference file ID for asset ${searchId}`)
        referenceFileId = await getFileIdByAssetId(searchId)
        console.log(`🔍 Reference file ID result for ${searchId}: ${referenceFileId}`)
        
        // Use batch lookup for predicted assets if there are many (only in online mode)
        if (predictedIds.length > 5) {
          console.log(`🔍 Using batch lookup for ${predictedIds.length} predicted assets`)
          const fileIdMap = await getBatchFileIds(predictedIds)
          
          for (let i = 0; i < predictedIds.length; i += 1) {
            const pid = String(predictedIds[i])
            const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
            const fileId = fileIdMap[pid] || null
            predicted.push({ id: pid, score, fileId })
          }
        } else {
          // For small numbers, use individual lookups
          for (let i = 0; i < predictedIds.length; i += 1) {
            const pid = String(predictedIds[i])
            const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
            const fileId = await getFileIdByAssetId(pid)
            predicted.push({ id: pid, score, fileId })
          }
        }
      } catch (driveError) {
        console.warn('Google Drive API error, continuing without file IDs:', driveError.message)
        // Continue without file IDs - frontend will handle offline mode
        referenceFileId = null
        for (let i = 0; i < predictedIds.length; i += 1) {
          const pid = String(predictedIds[i])
          const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
          predicted.push({ id: pid, score, fileId: null })
        }
      }
    } else {
      console.log(`🔍 Skipping file ID lookup - includeFileIds: ${includeFileIds}, ALL_DATASET_FOLDER_ID: ${ALL_DATASET_FOLDER_ID ? 'SET' : 'NOT SET'}`)
      // Skip file ID lookup for faster response
      for (let i = 0; i < predictedIds.length; i += 1) {
        const pid = String(predictedIds[i])
        const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
        predicted.push({ id: pid, score, fileId: null })
      }
    }

    const response = {
      assetId: searchId,
      reference: { fileId: referenceFileId },
      predicted,
    }
    console.log(`🔍 API response for asset ${searchId}:`, response)
    res.json(response)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/images/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params
    const { offline } = req.query // Check for offline mode parameter
    
    if (!fileId) return res.status(400).send('fileId required')
    
    console.log(`🖼️ Image request for fileId: ${fileId}${offline ? ' (offline mode)' : ''}`)
    
    // If offline mode is requested, avoid Google API calls
    if (offline === 'true') {
      console.log(`🔍 Offline mode requested for fileId: ${fileId} - avoiding Google API call`)
      const placeholderSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="#f0f0f0"/>
        <text x="100" y="100" text-anchor="middle" dy=".3em" font-family="Arial" font-size="14" fill="#666">
          Offline Mode
        </text>
        <text x="100" y="120" text-anchor="middle" dy=".3em" font-family="Arial" font-size="10" fill="#999">
          Use local images instead
        </text>
      </svg>`
      
      res.setHeader('Content-Type', 'image/svg+xml')
      return res.send(placeholderSvg)
    }
    
    const drive = getDrive()
    if (!drive) {
      console.log(`❌ Google Drive API not available for fileId: ${fileId}`)
      // Return a simple SVG placeholder image
      const placeholderSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="#f0f0f0"/>
        <text x="100" y="100" text-anchor="middle" dy=".3em" font-family="Arial" font-size="14" fill="#666">
          Image Not Available
        </text>
        <text x="100" y="120" text-anchor="middle" dy=".3em" font-family="Arial" font-size="10" fill="#999">
          Google Drive API not configured
        </text>
      </svg>`
      
      res.setHeader('Content-Type', 'image/svg+xml')
      return res.send(placeholderSvg)
    }
    
    console.log(`✅ Google Drive API available, fetching image for fileId: ${fileId}`)
    res.setHeader('Content-Type', 'image/jpeg')
    const dl = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    dl.data
      .on('end', () => {
        console.log(`✅ Image stream ended for fileId: ${fileId}`)
      })
      .on('error', (err) => { 
        console.error(`❌ Download error for fileId: ${fileId}`, err)
        res.end() 
      })
      .pipe(res)
  } catch (e) {
    console.error(`❌ Error serving image for fileId: ${fileId}:`, e)
    
    // Return a simple SVG placeholder image on error
    const placeholderSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#f0f0f0"/>
      <text x="100" y="100" text-anchor="middle" dy=".3em" font-family="Arial" font-size="14" fill="#666">
        Image Error
      </text>
      <text x="100" y="120" text-anchor="middle" dy=".3em" font-family="Arial" font-size="10" fill="#999">
        ${fileId}
      </text>
    </svg>`
    
    res.setHeader('Content-Type', 'image/svg+xml')
    res.send(placeholderSvg)
  }
})

app.get('/api/local-images/:filename', (req, res) => {
  try {
    const { filename } = req.params
    const { path: localPath } = req.query
    
    if (!filename || !localPath) {
      return res.status(400).send('filename and path required')
    }
    
    console.log(`🔍 Looking for local image: ${filename} in path: ${localPath}`)
    
    // Try to find the image file in the local path
    const possibleExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
    let imagePath = null
    
    for (const ext of possibleExtensions) {
      const testPath = path.join(localPath, `${filename}${ext}`)
      console.log(`🔍 Testing path: ${testPath}`)
      if (fs.existsSync(testPath)) {
        imagePath = testPath
        console.log(`✅ Found local image: ${imagePath}`)
        break
      }
    }
    
    if (!imagePath) {
      console.log(`❌ Local image not found for: ${filename}`)
      return res.status(404).send('Local image not found')
    }
    
    // Determine content type based on file extension
    const ext = path.extname(imagePath).toLowerCase()
    let contentType = 'image/jpeg' // default
    if (ext === '.png') contentType = 'image/png'
    else if (ext === '.gif') contentType = 'image/gif'
    else if (ext === '.bmp') contentType = 'image/bmp'
    else if (ext === '.webp') contentType = 'image/webp'
    
    res.setHeader('Content-Type', contentType)
    const fileStream = fs.createReadStream(imagePath)
    fileStream.pipe(res)
    
    fileStream.on('error', (err) => {
      console.error('Error reading local image:', err)
      res.status(500).send('Failed to read local image')
    })
    
  } catch (e) {
    console.error('Error serving local image:', e)
    res.status(500).send('Failed to serve local image')
  }
})

// Paginated asset id list
app.get('/api/assets-page', async (req, res) => {
  try {
    console.log('API call: /api/assets-page')
    
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20))
    const page = Math.max(1, Number(req.query.page) || 1)
    const offset = (page - 1) * pageSize
    
                             console.log('Querying Turso for page', page, 'size', pageSize)
      
      // Get all assets from Turso
      const allAssets = await getAllAssets()
      const assetIds = Object.keys(allAssets).sort((a, b) => {
        const aNum = parseInt(a) || 0
        const bNum = parseInt(b) || 0
        return aNum - bNum
      })
      
      const total = assetIds.length
      console.log('Total assets in Turso:', total)
    
    const pageIds = assetIds.slice(offset, offset + pageSize)
    console.log('Retrieved', pageIds.length, 'asset IDs for page')
    
    res.json({
      page,
      pageSize,
      total,
      pageCount: total ? Math.ceil(total / pageSize) : 0,
      ids: pageIds,
    })
  } catch (e) {
    console.error('Error in /api/assets-page:', e)
    res.status(500).json({ error: e.message })
  }
})

// Filtered paginated asset id list
app.post('/api/assets-page-filtered', async (req, res) => {
  try {
    console.log('API call: /api/assets-page-filtered')
    
    const pageSize = Math.max(1, Math.min(100, Number(req.body.pageSize) || 20))
    const page = Math.max(1, Number(req.body.page) || 1)
    const filter = req.body.filter || 'all'
    const reviewedAssets = req.body.reviewedAssets || {}
    
                             console.log('Querying Turso for page', page, 'size', pageSize, 'filter:', filter)
      
      // Get all asset IDs from Turso
      const allAssets = await getAllAssets()
      const allIds = Object.keys(allAssets).sort((a, b) => {
        const aNum = parseInt(a) || 0
        const bNum = parseInt(b) || 0
        return aNum - bNum
      })
      
      // Filter based on review status
      let filteredIds = allIds
      if (filter === 'accepted') {
        filteredIds = allIds.filter(id => reviewedAssets[id]?.status === 'accepted')
      } else if (filter === 'rejected') {
        filteredIds = allIds.filter(id => reviewedAssets[id]?.status === 'rejected')
      } else if (filter === 'not-reviewed') {
        filteredIds = allIds.filter(id => !reviewedAssets[id])
      }
      // 'all' filter returns all IDs
      
      const total = filteredIds.length
      const overallTotal = allIds.length
      const pageCount = total ? Math.ceil(total / pageSize) : 0
      const offset = (page - 1) * pageSize
      const pageIds = filteredIds.slice(offset, offset + pageSize)
      
      console.log('Total assets in Turso:', allIds.length, 'Filtered:', filteredIds.length, 'Page:', pageIds.length)
    
    res.json({
      page,
      pageSize,
      total,
      overallTotal,
      pageCount,
      ids: pageIds,
    })
  } catch (e) {
    console.error('Error in /api/assets-page-filtered:', e)
    res.status(500).json({ error: e.message })
  }
})

// Database status endpoint
app.get('/api/db-status', async (req, res) => {
  try {
    const totalRecords = await getAssetCount()
    const lastUpdated = new Date().toISOString()
    
                   res.json({
        totalRecords,
        lastUpdated,
        databaseType: 'turso'
      })
  } catch (e) {
    console.error('Error getting database status:', e)
    res.status(500).json({ error: e.message })
  }
})

// CSV import endpoint with chunked processing to avoid timeouts
app.post('/api/import-csv', async (req, res) => {
  try {
    console.log('CSV import request received')
    
    // Check if file was uploaded
    if (!req.files || !req.files.file) {
      return res.status(400).json({
        totalRecords: 0,
        imported: 0,
        skipped: 0,
        errors: 1,
        errorDetails: [{ line: 0, message: 'No file uploaded' }]
      })
    }
    
    const file = req.files.file
    const options = req.body.options ? JSON.parse(req.body.options) : {}
    
    console.log('Processing file:', file.name, 'Size:', file.size)
    
    // Parse CSV content
    const content = file.data.toString('utf-8')
    const records = parse(content, { columns: true, skip_empty_lines: true })
    
    console.log('Parsed', records.length, 'records from CSV')
    
    // For large files, use chunked processing
    const isLargeFile = records.length > 10000 // Process in chunks if more than 10k records
    const chunkSize = parseInt(options.chunkSize) || 5000 // Process 5k records per chunk
    
    if (isLargeFile) {
      console.log(`Large file detected (${records.length} records), using chunked processing`)
      
      // Store import job in Redis for background processing
      const importJobId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const importJob = {
        id: importJobId,
        status: 'pending',
        totalRecords: records.length,
        processed: 0,
        imported: 0,
        skipped: 0,
        errors: 0,
        errorDetails: [],
        createdAt: new Date().toISOString(),
        options: options
      }
      
      // Store the job and records in Turso
      const client = await getTursoClient()
      if (client) {
        // Store the import job
        await client.execute({
          sql: `INSERT INTO import_jobs (job_id, status, total_records, processed, imported, skipped, errors, error_details, progress, options, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          args: [importJobId, 'pending', records.length, 0, 0, 0, 0, '[]', 0, JSON.stringify(options)]
        })
        
        // Store records in chunks to avoid memory issues
        const totalChunks = Math.ceil(records.length / chunkSize)
        for (let i = 0; i < totalChunks; i++) {
          const chunk = records.slice(i * chunkSize, (i + 1) * chunkSize)
          await client.execute({
            sql: 'INSERT INTO import_chunks (job_id, chunk_index, chunk_data) VALUES (?, ?, ?)',
            args: [importJobId, i, JSON.stringify(chunk)]
          })
        }
        
        // Start background processing
        processImportChunks(importJobId, totalChunks, chunkSize, records.length, options)
        
        res.json({
          jobId: importJobId,
          totalRecords: records.length,
          chunkSize: chunkSize,
          totalChunks: totalChunks,
          message: 'Import started in background. Use /api/import-status/:jobId to check progress.',
          status: 'processing'
        })
      } else {
        throw new Error('Turso client not available for chunked processing')
      }
    } else {
      // For smaller files, process immediately
      console.log('Small file, processing immediately')
      
      // Clear existing data if requested
      if (options.clearExisting) {
        console.log('Clearing existing data...')
        await deleteAllAssets()
      }
      
      let imported = 0
      let skipped = 0
      let errors = 0
      const errorDetails = []
      
             // Use fast batch processing for better performance
       const batchSize = 1000
       const validRecords = []
       
       // First pass: validate and prepare records
       for (let i = 0; i < records.length; i++) {
         const record = records[i]
         const lineNumber = i + 2 // +2 for header row and 0-based index
         
         try {
           const assetId = String(record.asset_id ?? '').trim()
           const predictedAssetIds = String(record.predicted_asset_ids ?? '')
           const matchingScores = String(record.matching_scores ?? '')
           const fileIds = String(record.file_ids ?? '')
           
           if (!assetId) {
             skipped++
             continue
           }
           
           validRecords.push({
             assetId,
             predictedAssetIds,
             matchingScores,
             fileIds,
             lineNumber
           })
           
         } catch (error) {
           errors++
           errorDetails.push({
             line: lineNumber,
             message: error.message
           })
         }
       }
       
       console.log(`📦 Processing ${validRecords.length} valid records in batches...`)
       
       // Second pass: batch insert
       for (let i = 0; i < validRecords.length; i += batchSize) {
         const batch = validRecords.slice(i, i + batchSize)
         console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validRecords.length / batchSize)} (${batch.length} records)`)
         
         try {
           // Use transaction for better performance
           await client.execute('BEGIN TRANSACTION')
           
           for (const record of batch) {
             // Check for duplicates if skipDuplicates is enabled
             if (options.skipDuplicates) {
               const existing = await getAsset(record.assetId)
               if (existing) {
                 skipped++
                 continue
               }
             }
             
             // Save to Turso
             await client.execute({
               sql: `INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores, file_ids, updated_at) 
                     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
               args: [record.assetId, record.predictedAssetIds, record.matchingScores, record.fileIds]
             })
             imported++
           }
           
           await client.execute('COMMIT')
           console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed: ${batch.length} records processed`)
           
         } catch (error) {
           await client.execute('ROLLBACK')
           console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message)
           
           // Fall back to individual processing for this batch
           for (const record of batch) {
             try {
               if (options.skipDuplicates) {
                 const existing = await getAsset(record.assetId)
                 if (existing) {
                   skipped++
                   continue
                 }
               }
               
               await setAsset(record.assetId, {
                 asset_id: record.assetId,
                 predicted_asset_ids: record.predictedAssetIds,
                 matching_scores: record.matchingScores,
                 file_ids: record.fileIds
               })
               imported++
             } catch (fallbackError) {
               errors++
               errorDetails.push({
                 line: record.lineNumber,
                 message: fallbackError.message
               })
             }
           }
         }
       }
      
      const result = {
        totalRecords: records.length,
        imported,
        skipped,
        errors,
        errorDetails,
        status: 'completed'
      }
      
      console.log('Import completed:', result)
      res.json(result)
    }
    
  } catch (error) {
    console.error('CSV import error:', error)
    res.status(500).json({
      totalRecords: 0,
      imported: 0,
      skipped: 0,
      errors: 1,
      errorDetails: [{ line: 0, message: error.message }]
    })
  }
})

// Background processing function for chunked imports
async function processImportChunks(jobId, totalChunks, chunkSize, totalRecords, options) {
  try {
    console.log(`🔄 Starting background processing for job ${jobId}`)
    
    const client = await getTursoClient()
    if (!client) {
      throw new Error('Turso client not available')
    }

    // Immediately update job status to 'processing'
    await client.execute({
      sql: `UPDATE import_jobs SET 
            status = ?, 
            updated_at = CURRENT_TIMESTAMP 
            WHERE job_id = ?`,
      args: ['processing', jobId]
    })
    console.log(`📊 Job ${jobId} status updated to 'processing'`)
    
    // Clear existing data if requested
    if (options.clearExisting) {
      console.log('Clearing existing data...')
      await deleteAllAssets()
    }
    
    let totalImported = 0
    let totalSkipped = 0
    let totalErrors = 0
    const allErrorDetails = []
    
    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      try {
        // Get chunk data from Turso
        const result = await client.execute({
          sql: 'SELECT chunk_data FROM import_chunks WHERE job_id = ? AND chunk_index = ?',
          args: [jobId, chunkIndex]
        })
        
        if (result.rows.length === 0) {
          console.error(`Chunk ${chunkIndex} not found for job ${jobId}`)
          continue
        }
        
        const records = JSON.parse(result.rows[0].chunk_data)
        console.log(`Processing chunk ${chunkIndex + 1}/${totalChunks} with ${records.length} records`)
        
        // Process records directly - no batching needed for SQLite
        let chunkImported = 0
        let chunkSkipped = 0
        let chunkErrors = 0
        
        console.log(`🔍 Processing ${records.length} records in chunk ${chunkIndex + 1}`)
        
        for (let i = 0; i < records.length; i++) {
          const record = records[i]
          const lineNumber = (chunkIndex * chunkSize) + i + 2 // +2 for header row and 0-based index
          
          try {
            const assetId = String(record.asset_id ?? '').trim()
            const predictedAssetIds = String(record.predicted_asset_ids ?? '')
            const matchingScores = String(record.matching_scores ?? '')
            const fileIds = String(record.file_ids ?? '')
            
            if (!assetId) {
              chunkSkipped++
              continue
            }
            
            // Check for duplicates if skipDuplicates is enabled
            if (options.skipDuplicates) {
              const existing = await getAsset(assetId)
              if (existing) {
                chunkSkipped++
                continue
              }
            }
            
            // Save directly to Turso
            await setAsset(assetId, {
              asset_id: assetId,
              predicted_asset_ids: predictedAssetIds,
              matching_scores: matchingScores,
              file_ids: fileIds
            })
            chunkImported++
            
            // Update progress more frequently (every 5 records for better granularity)
            if (chunkImported % 5 === 0) {
              // Update job progress more frequently
              const currentTotalImported = totalImported + chunkImported
              const currentTotalSkipped = totalSkipped + chunkSkipped
              const currentTotalErrors = totalErrors + chunkErrors
              const currentProcessed = Math.min((chunkIndex * chunkSize) + chunkImported + chunkSkipped + chunkErrors, totalRecords)
              const currentProgress = Math.round((currentProcessed / totalRecords) * 100)
              
              await client.execute({
                sql: `UPDATE import_jobs SET 
                      processed = ?, 
                      imported = ?, 
                      skipped = ?, 
                      errors = ?, 
                      progress = ?, 
                      updated_at = CURRENT_TIMESTAMP 
                      WHERE job_id = ?`,
                args: [
                  currentProcessed,
                  currentTotalImported,
                  currentTotalSkipped,
                  currentTotalErrors,
                  currentProgress,
                  jobId
                ]
              })
              
              // Add a smaller delay to make progress visible but not too slow
              await new Promise(resolve => setTimeout(resolve, 50))
            }
            
          } catch (error) {
            chunkErrors++
            allErrorDetails.push({
              line: lineNumber,
              message: error.message
            })
            console.error(`❌ Error processing record ${i} in chunk ${chunkIndex}:`, error.message)
          }
        }
        
        totalImported += chunkImported
        totalSkipped += chunkSkipped
        totalErrors += chunkErrors
        
        // Force a final progress update for this chunk
        const finalProcessed = Math.min((chunkIndex + 1) * chunkSize, totalRecords)
        const finalProgress = Math.round((finalProcessed / totalRecords) * 100)
        
        await client.execute({
          sql: `UPDATE import_jobs SET 
                status = ?, 
                processed = ?, 
                imported = ?, 
                skipped = ?, 
                errors = ?, 
                error_details = ?, 
                progress = ?, 
                updated_at = CURRENT_TIMESTAMP 
                WHERE job_id = ?`,
          args: [
            chunkIndex === totalChunks - 1 ? 'completed' : 'processing',
            finalProcessed,
            totalImported,
            totalSkipped,
            totalErrors,
            JSON.stringify(allErrorDetails),
            finalProgress,
            jobId
          ]
        })
        
        // Add a small delay to ensure the update is captured
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Clean up chunk data
        await client.execute({
          sql: 'DELETE FROM import_chunks WHERE job_id = ? AND chunk_index = ?',
          args: [jobId, chunkIndex]
        })
        

        
      } catch (chunkError) {
        console.error(`❌ Error processing chunk ${chunkIndex}:`, chunkError.message)
        totalErrors += chunkSize // Assume all records in chunk failed
      }
    }
    

    
  } catch (error) {
    console.error(`❌ Background processing failed for job ${jobId}:`, error.message)
    
    // Update job status to failed
    try {
      const client = await getTursoClient()
      if (client) {
        await client.execute({
          sql: 'UPDATE import_jobs SET status = ?, error_details = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?',
          args: ['failed', JSON.stringify([{ line: 0, message: error.message }]), jobId]
        })
      }
    } catch (updateError) {
      console.error('Failed to update job status:', updateError.message)
    }
  }
}

// Import status endpoint
app.get('/api/import-status/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId
    console.log(`Checking import status for job: ${jobId}`)
    
    const client = await getTursoClient()
    if (!client) {
      return res.status(500).json({ error: 'Turso client not available' })
    }
    
    const result = await client.execute({
      sql: 'SELECT * FROM import_jobs WHERE job_id = ?',
      args: [jobId]
    })
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Import job not found' })
    }
    
    const row = result.rows[0]
    const job = {
      id: row.job_id,
      status: row.status,
      totalRecords: row.total_records,
      processed: row.processed,
      imported: row.imported,
      skipped: row.skipped,
      errors: row.errors,
      errorDetails: JSON.parse(row.error_details || '[]'),
      progress: row.progress,
      options: JSON.parse(row.options || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
    

    res.json(job)
    
  } catch (error) {
    console.error('Error checking import status:', error)
    res.status(500).json({ error: error.message })
  }
})

// List all import jobs endpoint
app.get('/api/import-jobs', async (req, res) => {
  try {
    console.log('Listing all import jobs')
    
    const client = await getTursoClient()
    if (!client) {
      return res.status(500).json({ error: 'Turso client not available' })
    }
    
    const result = await client.execute({
      sql: 'SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 10'
    })
    
    const jobs = result.rows.map(row => ({
      id: row.job_id,
      status: row.status,
      totalRecords: row.total_records,
      processed: row.processed,
      imported: row.imported,
      skipped: row.skipped,
      errors: row.errors,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
    
    console.log(`📊 Found ${jobs.length} import jobs`)
    res.json(jobs)
    
  } catch (error) {
    console.error('Error listing import jobs:', error)
    res.status(500).json({ error: error.message })
  }
})

// Simple test endpoint
app.get('/api/test', async (_req, res) => {
  try {
    const client = await getTursoClient()
    if (!client) {
      return res.status(500).json({ error: 'Turso client not available' })
    }
    
    // Test basic operations
    await client.execute('SELECT 1 as test')
    
    // Check if tables exist
    const tablesResult = await client.execute("SELECT name FROM sqlite_master WHERE type='table'")
    const tables = tablesResult.rows.map(row => row.name)
    
    // Count assets
    const countResult = await client.execute('SELECT COUNT(*) as count FROM assets')
    const assetCount = countResult.rows[0]?.count || 0
    
    // Get recent import jobs
    const jobsResult = await client.execute('SELECT job_id, status, progress, total_records, processed FROM import_jobs ORDER BY created_at DESC LIMIT 5')
    const importJobs = jobsResult.rows.map(row => ({
      id: row.job_id,
      status: row.status,
      progress: row.progress,
      totalRecords: row.total_records,
      processed: row.processed
    }))
    
    res.json({
      status: 'ok',
      message: 'Turso client is working',
      tables: tables,
      assetCount: assetCount,
      importJobs: importJobs,
             environment: process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN ? 'production' : 'local',
       databaseType: process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN ? 'turso' : 'in-memory'
    })
  } catch (error) {
    console.error('Test endpoint error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Test asset storage
app.get('/api/test-asset-storage', async (_req, res) => {
  try {
    const testAssetId = 'test_asset_123'
    const testAssetData = {
      asset_id: testAssetId,
      predicted_asset_ids: '[123, 456, 789]',
      matching_scores: '[0.95, 0.87, 0.76]',
      file_ids: '[123, 456, 789]'
    }
    
    console.log('🧪 Testing asset storage...')
    
    // Save test asset
    await setAsset(testAssetId, testAssetData)
    console.log('🧪 Test asset saved')
    
    // Retrieve test asset
    const retrieved = await getAsset(testAssetId)
    console.log('🧪 Test asset retrieved:', retrieved ? 'SUCCESS' : 'FAILED')
    
    // Get total count
    const count = await getAssetCount()
    console.log('🧪 Total asset count:', count)
    
    // Clean up
    try {
      const client = await getTursoClient()
      if (client) {
        await client.execute({
          sql: 'DELETE FROM assets WHERE asset_id = ?',
          args: [testAssetId]
        })
      }
    } catch (error) {
      console.warn('Failed to clean up test asset:', error.message)
    }
    
    res.json({
      ok: true,
      saveSuccess: !!retrieved,
      assetCount: count,
      message: 'Asset storage test completed'
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      message: 'Asset storage test failed'
    })
  }
})

// Batch delete specific assets
app.post('/api/delete-assets-batch', async (req, res) => {
  try {
    console.log('Batch delete request received')
    
    const { assetIds } = req.body
    
    if (!assetIds || !Array.isArray(assetIds)) {
      return res.status(400).json({
        error: 'assetIds array is required'
      })
    }
    
    if (assetIds.length === 0) {
      return res.json({
        message: 'No assets to delete',
        deleted: 0,
        failed: 0
      })
    }
    
    console.log(`🔍 Batch deleting ${assetIds.length} assets`)
    
    const batchResult = await deleteAssetsBatch(assetIds)
    
    res.json({
      message: 'Batch deletion completed',
      total: assetIds.length,
      deleted: batchResult.successful,
      failed: batchResult.failed,
      results: batchResult.results
    })
  } catch (error) {
    console.error('Batch delete error:', error)
    res.status(500).json({
      error: error.message
    })
  }
})

// Debug endpoint to list available assets in database
app.get('/api/debug/assets', async (req, res) => {
  try {
    let totalCount = 0
    let assetIds = []
    
    // Get total count first
    totalCount = await getAssetCount()
    
    // Get sample assets
    const allAssets = await getAllAssets()
    assetIds = Object.keys(allAssets)
      .sort((a, b) => {
        const aNum = parseInt(a) || 0
        const bNum = parseInt(b) || 0
        return aNum - bNum
      })
      .slice(0, 20)
    
                   res.json({
        totalAssets: totalCount,
        sampleAssets: assetIds,
        message: `Turso has ${totalCount} total assets, showing first 20`
      })
  } catch (error) {
    console.error('Debug assets error:', error)
    res.status(500).json({
      error: error.message
    })
  }
})

// Debug endpoint to get specific asset data from database
app.get('/api/debug/asset/:assetId', async (req, res) => {
  try {
    const assetId = req.params.assetId
    console.log(`🔍 Debug request for asset: ${assetId}`)
    
    // Get asset data from database
    const assetData = await getAsset(assetId)
    
                   if (assetData) {
        console.log(`🔍 Found asset ${assetId} in Turso:`, assetData)
        res.json({
          assetId,
          found: true,
          databaseData: assetData,
          message: 'Asset found in Turso'
        })
      } else {
        console.log(`🔍 Asset ${assetId} not found in Turso`)
        res.json({
          assetId,
          found: false,
          message: 'Asset not found in Turso'
        })
      }
  } catch (error) {
    console.error(`🔍 Debug asset error for ${req.params.assetId}:`, error)
    res.status(500).json({ assetId: req.params.assetId, error: error.message })
  }
})

// Test endpoint for debugging specific assets
app.get('/api/test-asset/:assetId', async (req, res) => {
  try {
    const assetId = req.params.assetId
    console.log(`🧪 Testing asset: ${assetId}`)
    
    const result = await getFileIdByAssetId(assetId)
    console.log(`🧪 Test result for ${assetId}:`, result)
    
    res.json({
      assetId,
      fileId: result,
      success: !!result
    })
  } catch (error) {
    console.error(`🧪 Test error for ${req.params.assetId}:`, error)
    res.status(500).json({
      assetId: req.params.assetId,
      error: error.message
    })
  }
})

// Debug endpoint to show database status
app.get('/api/debug/cache', async (req, res) => {
  try {
    const totalCount = await getAssetCount()
    
                   res.json({
        databaseType: 'turso',
        totalAssets: totalCount,
        message: `Turso has ${totalCount} assets`
      })
  } catch (error) {
    console.error('Debug database error:', error)
    res.status(500).json({
      error: error.message
    })
  }
})

// Export database data for backup
app.get('/api/export-database', async (req, res) => {
  try {
    console.log('Database export requested')
    
    const allAssets = await getAllAssets()
    const rows = Object.values(allAssets)
    
    const exportData = {
      timestamp: new Date().toISOString(),
      totalRecords: rows.length,
      data: rows
    }
    
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="database-backup-${new Date().toISOString().split('T')[0]}.json"`)
    res.json(exportData)
    
                   console.log(`✅ Exported ${rows.length} records from Turso`)
  } catch (error) {
    console.error('Database export error:', error)
    res.status(500).json({
      error: error.message
    })
  }
})

// Import database data from backup
app.post('/api/import-database', async (req, res) => {
  try {
    console.log('Database import request received')
    
    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Transfer-Encoding', 'chunked')
    
    const sendProgress = (progress, message) => {
      const data = JSON.stringify({ type: 'progress', progress, message }) + '\n'
      res.write(data)
    }
    
    const sendResult = (result) => {
      const data = JSON.stringify({ type: 'result', result }) + '\n'
      res.write(data)
      res.end()
    }
    
    // Check if file was uploaded
    if (!req.files || !req.files.file) {
      sendResult({
        totalRecords: 0,
        imported: 0,
        errors: 1,
        errorDetails: [{ line: 0, message: 'No backup file uploaded' }]
      })
      return
    }
    
    const file = req.files.file
    const options = req.body.options ? JSON.parse(req.body.options) : {}
    
    console.log('Processing backup file:', file.name, 'Size:', file.size)
    sendProgress(10, 'Reading backup file...')
    
    // Parse backup file
    const content = file.data.toString('utf-8')
    const backupData = JSON.parse(content)
    
    if (!backupData.data || !Array.isArray(backupData.data)) {
      sendResult({
        totalRecords: 0,
        imported: 0,
        errors: 1,
        errorDetails: [{ line: 0, message: 'Invalid backup file format' }]
      })
      return
    }
    
    const records = backupData.data
    console.log('Parsed', records.length, 'records from backup')
    sendProgress(30, `Parsed ${records.length} records, preparing database...`)
    
    // Clear existing data if requested
    if (options.clearExisting) {
      console.log('Clearing existing data...')
      await deleteAllAssets()
      sendProgress(40, 'Cleared existing data...')
    }
    
    let imported = 0
    let errors = 0
    const errorDetails = []
    
    // Process records directly - no batching needed for SQLite
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const lineNumber = i + 1
      const progress = 40 + Math.floor((i / records.length) * 50)
      
      sendProgress(progress, `Processing record ${i + 1}/${records.length}...`)
      
      try {
        const assetId = String(record.asset_id ?? '').trim()
        const predictedAssetIds = String(record.predicted_asset_ids ?? '')
        const matchingScores = String(record.matching_scores ?? '')
        const fileIds = String(record.file_ids ?? '')
        
        if (!assetId) {
          errors++
          errorDetails.push({
            line: lineNumber,
            message: 'Missing asset_id'
          })
          continue
        }
        
        // Save directly to Turso
        await setAsset(assetId, {
          asset_id: assetId,
          predicted_asset_ids: predictedAssetIds,
          matching_scores: matchingScores,
          file_ids: fileIds
        })
        imported++
        
      } catch (error) {
        errors++
        errorDetails.push({
          line: lineNumber,
          message: error.message
        })
      }
    }
    
    sendProgress(90, 'Finalizing import...')
    
    const result = {
      totalRecords: records.length,
      imported,
      errors,
      errorDetails
    }
    
    console.log('Database import completed:', result)
    sendProgress(100, 'Database import completed successfully!')
    sendResult(result)
    
  } catch (error) {
    console.error('Database import error:', error)
    const errorResult = {
      totalRecords: 0,
      imported: 0,
      errors: 1,
      errorDetails: [{ line: 0, message: error.message }]
    }
    
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json')
      res.status(500).json(errorResult)
    } else {
      const data = JSON.stringify({ type: 'result', result: errorResult }) + '\n'
      res.write(data)
      res.end()
    }
  }
})

// Fast asset endpoint without file ID lookup
app.get('/api/assets-fast/:assetId', async (req, res) => {
  try {
    const searchId = String(req.params.assetId).trim()
    
    if (!searchId) return res.status(400).json({ error: 'assetId required' })

    // Get asset from Turso only
    const assetData = await getAsset(searchId)
    
    if (!assetData) {
      console.log(`🔍 Asset ${searchId} not found in Turso`)
      return res.json({ 
        assetId: searchId, 
        reference: { fileId: null },
        predicted: []
      })
    }
    
    const predictedIds = parseArrayField(assetData.predicted_asset_ids).map(String)
    const predictedScores = parseArrayField(assetData.matching_scores).map(s => Number(s))

    // Skip file ID lookup for maximum speed
    const predicted = predictedIds.map((pid, i) => ({
      id: pid,
      score: typeof predictedScores[i] === 'number' ? predictedScores[i] : null,
      fileId: null
    }))

    const response = {
      assetId: searchId,
      reference: { fileId: null },
      predicted,
    }
    
    console.log(`⚡ Fast API response for asset ${searchId} (no file IDs)`)
    res.json(response)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Endpoint to retrieve fileId for a specific asset (for fallback scenarios)
app.get('/api/file-id/:assetId', async (req, res) => {
  try {
    const assetId = String(req.params.assetId).trim()

    if (!assetId) return res.status(400).json({ error: 'assetId required' })

    if (!ALL_DATASET_FOLDER_ID) {
      return res.status(400).json({ error: 'Google Drive API not configured' })
    }

    console.log(`🔍 Retrieving fileId for asset ${assetId}`)
    const fileId = await getFileIdByAssetId(assetId)

    res.json({
      assetId,
      fileId,
      success: !!fileId
    })
  } catch (e) {
    console.error(`Error retrieving fileId for asset ${req.params.assetId}:`, e)
    res.status(500).json({
      error: e.message,
      assetId: req.params.assetId,
      fileId: null,
      success: false
    })
  }
})

// File ID storage management endpoints
app.get('/api/cache/status', async (req, res) => {
  try {
    const status = await getFileIdStorageStatus()
    res.json({
      fileIdStorage: status,
      message: status.stored 
        ? `Database has ${status.assetsWithFileIds}/${status.totalAssets} assets with file IDs (${status.percentage}%)`
        : 'No file IDs stored in database'
    })
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Failed to get file ID storage status'
    })
  }
})

app.post('/api/cache/clear', async (req, res) => {
  try {
    await clearAllFileIds()
    res.json({ 
      message: 'All file IDs cleared from database successfully',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Failed to clear file IDs from database'
    })
  }
})

// New endpoint to populate all file IDs from Google Drive
app.post('/api/populate-all-file-ids', async (req, res) => {
  try {
    console.log('🔄 Manual population of all file IDs requested')
    
    const drive = getDrive()
    if (!drive || !ALL_DATASET_FOLDER_ID) {
      return res.status(400).json({
        error: 'Google Drive API not configured',
        message: 'Cannot populate file IDs without Google Drive access'
      })
    }
    
    // Start the population process in the background
    populateAllFileIds().catch(error => {
      console.error('❌ Error in background file ID population:', error.message)
    })
    
    res.json({ 
      message: 'File ID population started in background',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Error starting file ID population:', error.message)
    res.status(500).json({ 
      error: error.message,
      message: 'Failed to start file ID population'
    })
  }
})

// Function to populate all file IDs from Google Drive
async function populateAllFileIds() {
  try {
    console.log('🔄 Starting population of all file IDs from Google Drive...')
    
    const drive = getDrive()
    if (!drive || !ALL_DATASET_FOLDER_ID) {
      console.log('⚠️ Google Drive not available for file ID population')
      return
    }
    
    // Fetch all files from Google Drive
    const allFiles = []
    let pageToken = null
    
    do {
      const response = await drive.files.list({
        q: `'${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id, name), nextPageToken',
        pageSize: 1000,
        pageToken: pageToken
      })
      
      allFiles.push(...(response.data.files || []))
      pageToken = response.data.nextPageToken
    } while (pageToken)
    
    console.log(`🔍 Found ${allFiles.length} total files in Google Drive folder`)
    
    // Create a map of filename to file ID
    const fileIdMap = {}
    for (const file of allFiles) {
      const nameWithoutExt = file.name.replace(/\.(jpg|jpeg|png|gif|bmp|webp)$/i, '')
      fileIdMap[nameWithoutExt] = file.id
    }
    
    console.log(`💾 Storing ${Object.keys(fileIdMap).length} file mappings permanently in database...`)
    
    // Store all file IDs in the database permanently
    let storedCount = 0
    for (const [assetId, fileId] of Object.entries(fileIdMap)) {
      try {
        await setCachedFileId(assetId, fileId)
        storedCount++
        
        // Log progress every 100 files
        if (storedCount % 100 === 0) {
          console.log(`📊 Progress: ${storedCount}/${Object.keys(fileIdMap).length} file IDs stored`)
        }
      } catch (error) {
        console.warn(`Failed to store file ID for ${assetId}:`, error.message)
      }
    }
    
    console.log(`✅ Successfully stored ${storedCount} file mappings permanently in database`)
    
  } catch (error) {
    console.error('❌ Error in file ID population:', error.message)
  }
}

// For Vercel serverless deployment
if (process.env.NODE_ENV === 'production') {
  // Export for Vercel serverless functions
  module.exports = app
} else {
  // Local development server
  app.listen(PORT, async () => {
    console.log(`API server listening on http://localhost:${PORT}`)
    
    // Don't start background process automatically to avoid performance issues
    // Users can manually start it via the UI if needed
    console.log('ℹ️ Background file ID population is disabled by default for better performance')
    console.log('ℹ️ Use the UI to manually start the background process if needed')
  })
}


