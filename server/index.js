const express = require('express')
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const dotenv = require('dotenv')
const { parse } = require('csv-parse/sync')

// Load env (if present)
dotenv.config()

const app = express()
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

const CSV_PATH = process.env.CSV_PATH || fileConfig.CSV_PATH || path.resolve(__dirname, '../../Streamlit source/directional_all_assets_predictions.csv')
const ALL_DATASET_FOLDER_ID = process.env.ALL_DATASET_FOLDER_ID || fileConfig.ALL_DATASET_FOLDER_ID || ''
let apiCredentialsStr = process.env.api_credentials || process.env.API_CREDENTIALS || fileConfig.api_credentials || fileConfig.API_CREDENTIALS || ''
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || fileConfig.GOOGLE_APPLICATION_CREDENTIALS || ''

if (!ALL_DATASET_FOLDER_ID) {
  console.warn('Warning: ALL_DATASET_FOLDER_ID is not set. Asset image lookup will fail until it is provided via env or server/config.json')
}

let driveClient = null
function getDrive() {
  if (driveClient) return driveClient
  let serviceAccountInfo = null
  if (apiCredentialsStr) {
    serviceAccountInfo = JSON.parse(apiCredentialsStr)
  } else if (credentialsPath && fs.existsSync(path.resolve(__dirname, credentialsPath))) {
    const raw = fs.readFileSync(path.resolve(__dirname, credentialsPath), 'utf-8')
    serviceAccountInfo = JSON.parse(raw)
  } else if (credentialsPath && fs.existsSync(credentialsPath)) {
    const raw = fs.readFileSync(credentialsPath, 'utf-8')
    serviceAccountInfo = JSON.parse(raw)
  } else {
    throw new Error('Missing Google API credentials. Provide api_credentials (JSON string) or GOOGLE_APPLICATION_CREDENTIALS path via env/server/config.json')
  }
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountInfo,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  driveClient = google.drive({ version: 'v3', auth })
  return driveClient
}

let dataset = null
function loadDataset() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at ${CSV_PATH}`)
  }
  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const records = parse(content, { columns: true, skip_empty_lines: true })
  dataset = records
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
  const fileName = `${assetId}.jpg`
  const q = `name='${fileName}' and '${ALL_DATASET_FOLDER_ID}' in parents and trashed=false`
  const res = await drive.files.list({ q, fields: 'files(id, name)' })
  const items = res.data.files || []
  return items.length ? items[0].id : null
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/assets/:assetId', async (req, res) => {
  try {
    if (!dataset) loadDataset()
    const searchId = String(req.params.assetId).trim()
    if (!searchId) return res.status(400).json({ error: 'assetId required' })
    if (!ALL_DATASET_FOLDER_ID) return res.status(500).json({ error: 'Missing ALL_DATASET_FOLDER_ID' })

    const rows = dataset.filter(r => String(r.asset_id).trim() === searchId)
    if (!rows.length) return res.json({ assetId: searchId, matches: [] })

    const row = rows[0]
    const predictedIds = parseArrayField(row.predicted_asset_ids).map(String)
    const predictedScores = parseArrayField(row.matching_scores).map(s => Number(s))

    const referenceFileId = await getFileIdByAssetId(searchId)

    const predicted = []
    for (let i = 0; i < predictedIds.length; i += 1) {
      const pid = String(predictedIds[i])
      const score = typeof predictedScores[i] === 'number' ? predictedScores[i] : null
      const fileId = await getFileIdByAssetId(pid)
      predicted.push({ id: pid, score, fileId })
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
    res.setHeader('Content-Type', 'image/jpeg')
    const dl = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    dl.data
      .on('end', () => {})
      .on('error', (err) => { console.error('Download error', err); res.end() })
      .pipe(res)
  } catch (e) {
    console.error(e)
    res.status(500).send('Failed to fetch image')
  }
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})


