const express = require('express')
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const dotenv = require('dotenv')
const { parse } = require('csv-parse/sync')
const Database = require('better-sqlite3')
const fileUpload = require('express-fileupload')

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
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
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

const PORT = process.env.PORT || 5174

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

// SQLite database setup
let dbInstance = null
function getDb() {
  if (!dbInstance) {
    // In serverless environment, use in-memory database
    if (process.env.NODE_ENV === 'production') {
      console.log('Using in-memory database for serverless environment')
      dbInstance = new Database(':memory:')
    } else {
      const DB_PATH = path.resolve(__dirname, 'data.db')
      console.log('Using file-based database for local development')
      dbInstance = new Database(DB_PATH)
    }
  }
  return dbInstance
}

function ensureTables() {
  const db = getDb()
  db.exec(
    `CREATE TABLE IF NOT EXISTS assets (
      asset_id TEXT PRIMARY KEY,
      predicted_asset_ids TEXT,
      matching_scores TEXT
    );`
  )
}

function loadCsvIntoDbIfEmpty() {
  console.log('Loading CSV into DB if empty...')
  ensureTables()
  const db = getDb()
  const row = db.prepare('SELECT COUNT(1) as cnt FROM assets').get()
  console.log('Current asset count:', row?.cnt || 0)
  if (row && row.cnt > 0) {
    console.log('DB already has data, skipping import')
    return
  }
  
  // In production (serverless), use sample data since CSV won't be available
  if (process.env.NODE_ENV === 'production') {
    console.log('Loading sample data for production environment')
    const sampleData = [
      { asset_id: '1', predicted_asset_ids: '["2", "3", "4"]', matching_scores: '[0.95, 0.87, 0.82]' },
      { asset_id: '2', predicted_asset_ids: '["1", "3", "5"]', matching_scores: '[0.92, 0.89, 0.78]' },
      { asset_id: '3', predicted_asset_ids: '["1", "2", "6"]', matching_scores: '[0.88, 0.85, 0.76]' },
      { asset_id: '4', predicted_asset_ids: '["1", "5", "7"]', matching_scores: '[0.84, 0.81, 0.73]' },
      { asset_id: '5', predicted_asset_ids: '["2", "4", "8"]', matching_scores: '[0.79, 0.77, 0.71]' }
    ]
    const insert = db.prepare('INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores) VALUES (?, ?, ?)')
    const insertMany = db.transaction((rows) => {
      for (const r of rows) {
        insert.run(String(r.asset_id), String(r.predicted_asset_ids), String(r.matching_scores))
      }
    })
    insertMany(sampleData)
    console.log('Sample data import completed')
    return
  }
  
  // Load CSV and import (local development)
  if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
    // No CSV; table remains empty
    console.warn('CSV not found; assets table remains empty.')
    return
  }
  console.log('Loading CSV from:', CSV_PATH)
  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const records = parse(content, { columns: true, skip_empty_lines: true })
  console.log('Parsed', records.length, 'records from CSV')
  const insert = db.prepare('INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores) VALUES (?, ?, ?)')
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(String(r.asset_id ?? '').trim(), String(r.predicted_asset_ids ?? ''), String(r.matching_scores ?? ''))
    }
  })
  insertMany(records)
  console.log('CSV import completed')
}

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

async function getFileIdByAssetId(assetId) {
  const drive = getDrive()
  if (!drive) {
    console.log(`Google Drive not available for asset ${assetId}`)
    return null
  }
  
  try {
    const fileName = `${assetId}.jpg`
    const q = `name='${fileName}' and '${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`
    const res = await drive.files.list({ q, fields: 'files(id, name)' })
    const items = res.data.files || []
    return items.length ? items[0].id : null
  } catch (error) {
    console.error(`Error getting file ID for asset ${assetId}:`, error.message)
    return null
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      app_usr_set: !!process.env.app_usr,
      app_auth_set: !!process.env.app_auth
    }
  })
})

// Login verification against Streamlit env variables
app.post('/api/login', (req, res) => {
  try {
    console.log('Login attempt:', req.body)
    const { username, password } = req.body || {}
    
    // Debug environment variables
    console.log('Environment variables check:')
    console.log('- app_usr:', process.env.app_usr ? 'SET' : 'NOT SET')
    console.log('- app_auth:', process.env.app_auth ? 'SET' : 'NOT SET')
    console.log('- NODE_ENV:', process.env.NODE_ENV)
    console.log('- PORT:', process.env.PORT)
    
    const expectedUser = process.env.app_usr || ''
    const expectedPass = process.env.app_auth || ''
    
    console.log('Expected user from env:', expectedUser ? 'set' : 'not set')
    console.log('Expected pass from env:', expectedPass ? 'set' : 'not set')
    
    const isEnvMatch = expectedUser && expectedPass && String(username || '') === String(expectedUser) && String(password || '') === String(expectedPass)
    const isAdminDefault = String(username || '') === 'admin' && String(password || '') === 'admin'
    
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
    if (!searchId) return res.status(400).json({ error: 'assetId required' })

    initializeDatabaseIfNeeded()
    const db = getDb()
    const row = db.prepare('SELECT asset_id, predicted_asset_ids, matching_scores FROM assets WHERE asset_id = ? LIMIT 1').get(searchId)
    if (!row) return res.json({ assetId: searchId, matches: [] })
    const predictedIds = parseArrayField(row.predicted_asset_ids).map(String)
    const predictedScores = parseArrayField(row.matching_scores).map(s => Number(s))

    // Only try to get Google Drive file IDs if ALL_DATASET_FOLDER_ID is properly configured
    let referenceFileId = null
    let predicted = []
    
    if (ALL_DATASET_FOLDER_ID) {
      try {
        referenceFileId = await getFileIdByAssetId(searchId)
        
        for (let i = 0; i < predictedIds.length; i += 1) {
          const pid = String(predictedIds[i])
          const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
          const fileId = await getFileIdByAssetId(pid)
          predicted.push({ id: pid, score, fileId })
        }
      } catch (driveError) {
        console.warn('Google Drive API error, continuing without file IDs:', driveError.message)
        // Continue without file IDs - frontend will handle offline mode
      }
    } else {
      // Offline mode - just return the asset data without file IDs
      for (let i = 0; i < predictedIds.length; i += 1) {
        const pid = String(predictedIds[i])
        const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
        predicted.push({ id: pid, score, fileId: null })
      }
    }

    res.json({
      assetId: searchId,
      reference: { fileId: referenceFileId },
      predicted,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/images/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params
    if (!fileId) return res.status(400).send('fileId required')
    
    const drive = getDrive()
    if (!drive) {
      return res.status(503).send('Google Drive API not available')
    }
    
    res.setHeader('Content-Type', 'image/jpeg')
    const dl = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    dl.data
      .on('end', () => {})
      .on('error', (err) => { console.error('Download error', err); res.end() })
      .pipe(res)
  } catch (e) {
    console.error('Error serving image:', e)
    res.status(500).send('Failed to fetch image')
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
app.get('/api/assets-page', (req, res) => {
  try {
    console.log('API call: /api/assets-page')
    initializeDatabaseIfNeeded()
    const db = getDb()
    console.log('Database initialized')
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20))
    const page = Math.max(1, Number(req.query.page) || 1)
    const offset = (page - 1) * pageSize
    console.log('Querying database for page', page, 'size', pageSize)
    const totalRow = db.prepare('SELECT COUNT(1) as cnt FROM assets').get()
    const total = totalRow?.cnt || 0
    console.log('Total assets in DB:', total)
    const rows = db.prepare('SELECT asset_id FROM assets ORDER BY CAST(asset_id AS INTEGER), asset_id LIMIT ? OFFSET ?').all(pageSize, offset)
    console.log('Retrieved', rows.length, 'rows')
    res.json({
      page,
      pageSize,
      total,
      pageCount: total ? Math.ceil(total / pageSize) : 0,
      ids: rows.map(r => r.asset_id),
    })
  } catch (e) {
    console.error('Error in /api/assets-page:', e)
    res.status(500).json({ error: e.message })
  }
})

// Filtered paginated asset id list
app.post('/api/assets-page-filtered', (req, res) => {
  try {
    console.log('API call: /api/assets-page-filtered')
    initializeDatabaseIfNeeded()
    const db = getDb()
    console.log('Database initialized')
    
    const pageSize = Math.max(1, Math.min(100, Number(req.body.pageSize) || 20))
    const page = Math.max(1, Number(req.body.page) || 1)
    const filter = req.body.filter || 'all'
    const reviewedAssets = req.body.reviewedAssets || {}
    
    console.log('Querying database for page', page, 'size', pageSize, 'filter:', filter)
    
    // Get all asset IDs first
    const allRows = db.prepare('SELECT asset_id FROM assets ORDER BY CAST(asset_id AS INTEGER), asset_id').all()
    const allIds = allRows.map(r => r.asset_id)
    
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
    
    console.log('Total assets in DB:', allIds.length, 'Filtered:', filteredIds.length, 'Page:', pageIds.length)
    
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
app.get('/api/db-status', (req, res) => {
  try {
    initializeDatabaseIfNeeded()
    const db = getDb()
    
    const row = db.prepare('SELECT COUNT(1) as cnt FROM assets').get()
    const totalRecords = row?.cnt || 0
    
    // Get last updated timestamp (we'll use current time for now)
    const lastUpdated = new Date().toISOString()
    
    res.json({
      totalRecords,
      lastUpdated,
      databaseType: process.env.NODE_ENV === 'production' ? 'in-memory' : 'file-based'
    })
  } catch (e) {
    console.error('Error getting database status:', e)
    res.status(500).json({ error: e.message })
  }
})

// CSV import endpoint
app.post('/api/import-csv', async (req, res) => {
  try {
    console.log('CSV import request received')
    
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
        skipped: 0,
        errors: 1,
        errorDetails: [{ line: 0, message: 'No file uploaded' }]
      })
      return
    }
    
    const file = req.files.file
    const options = req.body.options ? JSON.parse(req.body.options) : {}
    
    console.log('Processing file:', file.name, 'Size:', file.size)
    sendProgress(10, 'Reading CSV file...')
    
    // Parse CSV content
    const content = file.data.toString('utf-8')
    const records = parse(content, { columns: true, skip_empty_lines: true })
    
    console.log('Parsed', records.length, 'records from CSV')
    sendProgress(30, `Parsed ${records.length} records, preparing database...`)
    
    // Initialize database
    initializeDatabaseIfNeeded()
    const db = getDb()
    
    // Clear existing data if requested
    if (options.clearExisting) {
      console.log('Clearing existing data...')
      db.prepare('DELETE FROM assets').run()
      sendProgress(40, 'Cleared existing data...')
    }
    
    // Prepare insert statement
    const insert = db.prepare('INSERT OR REPLACE INTO assets (asset_id, predicted_asset_ids, matching_scores) VALUES (?, ?, ?)')
    
    let imported = 0
    let skipped = 0
    let errors = 0
    const errorDetails = []
    const batchSize = parseInt(options.batchSize) || 1000
    
    // Process records in batches
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const progress = 40 + Math.floor((i / records.length) * 50)
      
      sendProgress(progress, `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}...`)
      
      // Process batch
      for (let j = 0; j < batch.length; j++) {
        const record = batch[j]
        const lineNumber = i + j + 2 // +2 for header row and 0-based index
        
        try {
          const assetId = String(record.asset_id ?? '').trim()
          const predictedAssetIds = String(record.predicted_asset_ids ?? '')
          const matchingScores = String(record.matching_scores ?? '')
          
          if (!assetId) {
            skipped++
            continue
          }
          
          // Check for duplicates if skipDuplicates is enabled
          if (options.skipDuplicates) {
            const existing = db.prepare('SELECT 1 FROM assets WHERE asset_id = ?').get(assetId)
            if (existing) {
              skipped++
              continue
            }
          }
          
          insert.run(assetId, predictedAssetIds, matchingScores)
          imported++
          
        } catch (error) {
          errors++
          errorDetails.push({
            line: lineNumber,
            message: error.message
          })
        }
      }
    }
    
    sendProgress(90, 'Finalizing import...')
    
    const result = {
      totalRecords: records.length,
      imported,
      skipped,
      errors,
      errorDetails
    }
    
    console.log('Import completed:', result)
    sendProgress(100, 'Import completed successfully!')
    sendResult(result)
    
  } catch (error) {
    console.error('CSV import error:', error)
    const errorResult = {
      totalRecords: 0,
      imported: 0,
      skipped: 0,
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

// Initialize database lazily (only when needed)
let dbInitialized = false
function initializeDatabaseIfNeeded() {
  if (!dbInitialized) {
    console.log('Initializing database...')
    loadCsvIntoDbIfEmpty()
    dbInitialized = true
  }
}

// For Vercel serverless deployment
if (process.env.NODE_ENV === 'production') {
  // Export for Vercel serverless functions
  module.exports = app
} else {
  // Local development server
  app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`)
  })
}


