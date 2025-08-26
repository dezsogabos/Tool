const express = require('express')
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const dotenv = require('dotenv')
const { parse } = require('csv-parse/sync')
const fileUpload = require('express-fileupload')
const { createClient } = require('@vercel/edge-config')

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

// Edge Config persistence system for serverless environments
// Provides reliable, persistent key-value storage

// Edge Config client setup
let edgeConfigClient = null
function getEdgeConfig() {
  if (!edgeConfigClient) {
    try {
      edgeConfigClient = createClient(process.env.EDGE_CONFIG)
      console.log('✅ Edge Config client initialized')
    } catch (error) {
      console.warn('⚠️ Edge Config not available, using fallback storage:', error.message)
      edgeConfigClient = null
    }
  }
  return edgeConfigClient
}

// Fallback in-memory storage for local development
// Use a global variable that persists across function invocations
if (!global.fallbackStorage) {
  global.fallbackStorage = new Map()
}
let fallbackStorage = global.fallbackStorage

// Asset storage functions
async function getAsset(assetId) {
  const client = getEdgeConfig()
  if (client) {
    try {
      const key = `asset_${assetId}`
      const data = await client.get(key)
      return data || null
    } catch (error) {
      console.warn(`Failed to get asset ${assetId} from Edge Config:`, error.message)
      return fallbackStorage.get(assetId) || null
    }
  } else {
    return fallbackStorage.get(assetId) || null
  }
}

async function setAsset(assetId, data) {
  const client = getEdgeConfig()
  console.log(`🔍 setAsset called for ${assetId} - Edge Config available:`, !!client)
  
  if (client) {
    try {
      const key = `asset_${assetId}`
      await client.set(key, data)
      console.log(`✅ Asset ${assetId} saved to Edge Config`)
    } catch (error) {
      console.warn(`Failed to save asset ${assetId} to Edge Config:`, error.message)
      fallbackStorage.set(assetId, data)
      console.log(`✅ Asset ${assetId} saved to fallback storage`)
    }
  } else {
    fallbackStorage.set(assetId, data)
    console.log(`✅ Asset ${assetId} saved to fallback storage (Edge Config not available)`)
  }
}

async function getAllAssets() {
  const client = getEdgeConfig()
  console.log('🔍 getAllAssets called - Edge Config available:', !!client)
  
  if (client) {
    try {
      // Get all keys that start with 'asset_'
      const allKeys = await client.getAll()
      const assetKeys = Object.keys(allKeys).filter(key => key.startsWith('asset_'))
      const assets = {}
      
      for (const key of assetKeys) {
        const assetId = key.replace('asset_', '')
        assets[assetId] = allKeys[key]
      }
      
      console.log(`🔍 Edge Config returned ${Object.keys(assets).length} assets`)
      return assets
    } catch (error) {
      console.warn('Failed to get all assets from Edge Config:', error.message)
      const fallbackAssets = Object.fromEntries(fallbackStorage)
      console.log(`🔍 Using fallback storage with ${Object.keys(fallbackAssets).length} assets`)
      return fallbackAssets
    }
  } else {
    const fallbackAssets = Object.fromEntries(fallbackStorage)
    console.log(`🔍 Edge Config not available, using fallback storage with ${Object.keys(fallbackAssets).length} assets`)
    return fallbackAssets
  }
}

async function deleteAllAssets() {
  const client = getEdgeConfig()
  if (client) {
    try {
      const allKeys = await client.getAll()
      const assetKeys = Object.keys(allKeys).filter(key => key.startsWith('asset_'))
      
      for (const key of assetKeys) {
        await client.delete(key)
      }
      
      console.log(`✅ Deleted ${assetKeys.length} assets from Edge Config`)
    } catch (error) {
      console.warn('Failed to delete assets from Edge Config:', error.message)
      fallbackStorage.clear()
    }
  } else {
    fallbackStorage.clear()
  }
}

async function getAssetCount() {
  const client = getEdgeConfig()
  if (client) {
    try {
      const allKeys = await client.getAll()
      const assetKeys = Object.keys(allKeys).filter(key => key.startsWith('asset_'))
      return assetKeys.length
    } catch (error) {
      console.warn('Failed to get asset count from Edge Config:', error.message)
      return fallbackStorage.size
    }
  } else {
    return fallbackStorage.size
  }
}

// Initialize with sample data if empty (local development only)
async function initializeWithSampleData() {
  if (process.env.NODE_ENV === 'production') {
    console.log('Production environment: No sample data loaded. Users should import CSV data.')
    return
  }
  
  const count = await getAssetCount()
  if (count > 0) {
    console.log(`Database already has ${count} assets, skipping sample data`)
    return
  }
  
  // Load CSV and import (local development)
  if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
    console.log('CSV not found; assets table remains empty.')
    return
  }
  
  console.log('Loading CSV from:', CSV_PATH)
  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const records = parse(content, { columns: true, skip_empty_lines: true })
  console.log('Parsed', records.length, 'records from CSV')
  
  let imported = 0
  for (const record of records) {
    const assetId = String(record.asset_id ?? '').trim()
    if (assetId) {
      await setAsset(assetId, {
        asset_id: assetId,
        predicted_asset_ids: String(record.predicted_asset_ids ?? ''),
        matching_scores: String(record.matching_scores ?? '')
      })
      imported++
    }
  }
  
  console.log(`✅ Imported ${imported} records from CSV`)
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
  console.log(`🔍 getFileIdByAssetId called for assetId: ${assetId}`)
  console.log(`🔍 ALL_DATASET_FOLDER_ID: ${ALL_DATASET_FOLDER_ID ? 'SET' : 'NOT SET'}`)
  if (ALL_DATASET_FOLDER_ID) {
    console.log(`🔍 Folder ID value: ${ALL_DATASET_FOLDER_ID}`)
  }
  const drive = getDrive()
  if (!drive) {
    console.log(`❌ Google Drive not available for asset ${assetId}`)
    return null
  }
  
    try {
      const fileName = `${assetId}.jpg`
      const q = `name='${fileName}' and '${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`
      console.log(`🔍 Google Drive query: ${q}`)
      console.log(`🔍 Attempting to list files in Google Drive...`)
      const res = await drive.files.list({ q, fields: 'files(id, name)' })
      console.log(`🔍 Google Drive API response received`)
      const items = res.data.files || []
      console.log(`🔍 Found ${items.length} files for asset ${assetId}`)
    if (items.length > 0) {
      console.log(`🔍 File ID: ${items[0].id}, Name: ${items[0].name}`)
      return items[0].id
    } else {
      console.log(`❌ No file found for asset ${assetId} with name ${fileName}`)
      
      // Debug: Let's see what files are actually in the folder
      console.log(`🔍 Debug: Checking what files exist in folder ${ALL_DATASET_FOLDER_ID}`)
      try {
        const debugRes = await drive.files.list({ 
          q: `'${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`, 
          fields: 'files(id, name)',
          pageSize: 5
        })
        const debugItems = debugRes.data.files || []
        console.log(`🔍 Debug: Found ${debugItems.length} total files in folder`)
        if (debugItems.length > 0) {
          console.log(`🔍 Debug: First few files:`, debugItems.slice(0, 3).map(f => `${f.name} (${f.id})`))
        }
      } catch (debugError) {
        console.log(`🔍 Debug: Error listing folder contents:`, debugError.message)
      }
      
      // Try alternative file extensions
      const extensions = ['.jpeg', '.png', '.gif', '.bmp', '.webp']
      for (const ext of extensions) {
        const altFileName = `${assetId}${ext}`
        const altQ = `name='${altFileName}' and '${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`
        console.log(`🔍 Trying alternative extension: ${altQ}`)
        const altRes = await drive.files.list({ q: altQ, fields: 'files(id, name)' })
        const altItems = altRes.data.files || []
        if (altItems.length > 0) {
          console.log(`✅ Found file with alternative extension: ${altFileName} -> ${altItems[0].id}`)
          return altItems[0].id
        }
      }
      console.log(`❌ No file found for asset ${assetId} with any common extension`)
    }
    return null
  } catch (error) {
    console.error(`❌ Error getting file ID for asset ${assetId}:`, error.message)
    return null
  }
}

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
    if (!searchId) return res.status(400).json({ error: 'assetId required' })

    // Get asset from Edge Config
    const assetData = await getAsset(searchId)
    
    if (!assetData) {
      console.log(`🔍 Asset ${searchId} not found in Edge Config`)
      return res.json({ 
        assetId: searchId, 
        reference: { fileId: null },
        predicted: []
      })
    }
    
    const predictedIds = parseArrayField(assetData.predicted_asset_ids).map(String)
    const predictedScores = parseArrayField(assetData.matching_scores).map(s => Number(s))

    // Only try to get Google Drive file IDs if ALL_DATASET_FOLDER_ID is properly configured
    let referenceFileId = null
    let predicted = []
    
    console.log(`🔍 Processing asset ${searchId} - ALL_DATASET_FOLDER_ID: ${ALL_DATASET_FOLDER_ID ? 'SET' : 'NOT SET'}`)
    
    if (ALL_DATASET_FOLDER_ID) {
      try {
        console.log(`🔍 Attempting to get reference file ID for asset ${searchId}`)
        console.log(`🔍 Using folder ID: ${ALL_DATASET_FOLDER_ID}`)
        referenceFileId = await getFileIdByAssetId(searchId)
        console.log(`🔍 Reference file ID result for ${searchId}: ${referenceFileId}`)
        
        for (let i = 0; i < predictedIds.length; i += 1) {
          const pid = String(predictedIds[i])
          const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
          const fileId = await getFileIdByAssetId(pid)
          predicted.push({ id: pid, score, fileId })
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
      console.log(`🔍 ALL_DATASET_FOLDER_ID not set, running in offline mode`)
      // Offline mode - just return the asset data without file IDs
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
    if (!fileId) return res.status(400).send('fileId required')
    
    console.log(`🖼️ Image request for fileId: ${fileId}`)
    
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
    
    console.log('Querying Edge Config for page', page, 'size', pageSize)
    
    // Get all assets from Edge Config
    const allAssets = await getAllAssets()
    const assetIds = Object.keys(allAssets).sort((a, b) => {
      const aNum = parseInt(a) || 0
      const bNum = parseInt(b) || 0
      return aNum - bNum
    })
    
    const total = assetIds.length
    console.log('Total assets in Edge Config:', total)
    
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
    
    console.log('Querying Edge Config for page', page, 'size', pageSize, 'filter:', filter)
    
    // Get all asset IDs from Edge Config
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
    
    console.log('Total assets in Edge Config:', allIds.length, 'Filtered:', filteredIds.length, 'Page:', pageIds.length)
    
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
      databaseType: 'edge-config'
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
    
        // Clear existing data if requested
    if (options.clearExisting) {
      console.log('Clearing existing data...')
      await deleteAllAssets()
      sendProgress(40, 'Cleared existing data...')
    }
    
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
            const existing = await getAsset(assetId)
            if (existing) {
              skipped++
              continue
            }
          }
          
          await setAsset(assetId, {
            asset_id: assetId,
            predicted_asset_ids: predictedAssetIds,
            matching_scores: matchingScores
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

// Initialize Edge Config with sample data if needed
async function initializeDatabaseIfNeeded() {
  console.log('Ensuring Edge Config is initialized...')
  await initializeWithSampleData()
}

// Simple test endpoint
app.get('/api/test', (_req, res) => {
  res.json({ 
    ok: true, 
    message: 'Server is working',
    timestamp: new Date().toISOString(),
    edgeConfigEnv: process.env.EDGE_CONFIG ? 'SET' : 'NOT SET'
  })
})

// Test Edge Config functionality
app.get('/api/test-edge-config', async (_req, res) => {
  try {
    const client = getEdgeConfig()
    const testKey = 'test_key'
    const testData = { message: 'Hello from Edge Config', timestamp: new Date().toISOString() }
    
    if (client) {
      // Test Edge Config
      await client.set(testKey, testData)
      const retrieved = await client.get(testKey)
      await client.delete(testKey)
      
      res.json({
        ok: true,
        edgeConfigAvailable: true,
        testPassed: JSON.stringify(retrieved) === JSON.stringify(testData),
        message: 'Edge Config test completed'
      })
    } else {
      // Test fallback storage
      fallbackStorage.set(testKey, testData)
      const retrieved = fallbackStorage.get(testKey)
      fallbackStorage.delete(testKey)
      
      res.json({
        ok: true,
        edgeConfigAvailable: false,
        fallbackTestPassed: JSON.stringify(retrieved) === JSON.stringify(testData),
        fallbackStorageSize: fallbackStorage.size,
        message: 'Fallback storage test completed'
      })
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      message: 'Edge Config test failed'
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
      message: `Edge Config has ${totalCount} total assets, showing first 20`
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
    
    // Get asset data from Edge Config
    const assetData = await getAsset(assetId)
    
    if (assetData) {
      console.log(`🔍 Found asset ${assetId} in Edge Config:`, assetData)
      res.json({
        assetId,
        found: true,
        databaseData: assetData,
        message: 'Asset found in Edge Config'
      })
    } else {
      console.log(`🔍 Asset ${assetId} not found in Edge Config`)
      res.json({
        assetId,
        found: false,
        message: 'Asset not found in Edge Config'
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
    const client = getEdgeConfig()
    const fallbackSize = fallbackStorage.size
    
    res.json({
      databaseType: 'edge-config',
      totalAssets: totalCount,
      edgeConfigAvailable: !!client,
      fallbackStorageSize: fallbackSize,
      message: `Edge Config has ${totalCount} assets (fallback: ${fallbackSize})`
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
    
    console.log(`✅ Exported ${rows.length} records from Edge Config`)
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
    const batchSize = parseInt(options.batchSize) || 1000
    
    // Process records in batches
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const progress = 40 + Math.floor((i / records.length) * 50)
      
      sendProgress(progress, `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}...`)
      
      // Process batch
      for (let j = 0; j < batch.length; j++) {
        const record = batch[j]
        const lineNumber = i + j + 1
        
        try {
          const assetId = String(record.asset_id ?? '').trim()
          const predictedAssetIds = String(record.predicted_asset_ids ?? '')
          const matchingScores = String(record.matching_scores ?? '')
          
          if (!assetId) {
            errors++
            errorDetails.push({
              line: lineNumber,
              message: 'Missing asset_id'
            })
            continue
          }
          
          await setAsset(assetId, {
            asset_id: assetId,
            predicted_asset_ids: predictedAssetIds,
            matching_scores: matchingScores
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


