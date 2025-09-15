<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore()

const assetId = ref('')
const referenceImageRef = ref(null)
const submitted = ref(false)
const loading = ref(false)
const error = ref('')
const referenceFileId = ref('')
const predicted = ref([])
const referenceDecision = ref('') // 'accepted' | 'rejected' | ''
const selectedPredictedIds = ref([])
const rejectedPredictedIds = ref([])
const page = ref(1)
const pageCount = ref(0)
const ids = ref([])
const reviewedAssets = ref({}) // Store reviewed assets: { assetId: { status: 'accepted'|'rejected', predictedIds: [] } }
const activeTab = ref('review') // 'review' | 'export' | 'import' | 'settings' | 'analytics' | 'about'
const totalAssets = ref(0) // Total number of assets in the database
const overallTotalAssets = ref(0) // Total number of assets in the database (unfiltered)
const pageSize = ref(20) // Number of assets per page
const exportPreviewPage = ref(1) // Current page for export preview
const exportPreviewPageSize = ref(10) // Number of items per page in export preview
const exportFilter = ref('all') // Filter for export preview: 'all', 'accepted', 'rejected'
const assetFilter = ref('all') // Filter for asset review: 'all', 'accepted', 'rejected', 'not-reviewed'
const darkMode = ref(false) // Dark mode toggle
const previewImage = ref(null) // Currently previewed image
const offlineMode = ref(false) // Offline mode toggle
const localImagePath = ref('') // Local drive path for images
const imageActualSources = ref({}) // Track actual source of each image: { fileId: 'local' | 'api' }
const referenceImageSourceRef = ref('api') // Direct ref for reference image source
const assetDataReceived = ref(false) // Track if asset data was successfully received from API/cache

// Cache system for improved performance
const assetCache = ref(new Map()) // Cache for asset data: { assetId: { reference, predicted, timestamp } }
const imageUrlCache = ref(new Map()) // Cache for image URLs: { fileId: { url, timestamp } }

// Backup and restore functionality
const selectedBackupFile = ref(null)
const selectedReviewBackupFile = ref(null)
const isImporting = ref(false)
const backupProgress = ref({
  show: false,
  percent: 0,
  message: ''
})
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes cache duration
const MAX_CACHE_SIZE = 100 // Maximum number of cached items

// Pre-fetching system for instant navigation
const prefetchQueue = ref([]) // Queue of asset IDs to pre-fetch
const isPrefetching = ref(false) // Flag to prevent multiple concurrent pre-fetch operations
const PREFETCH_COUNT = 1 // Reduced from 3 to 1 to prevent overwhelming the system
const prefetchedAssets = ref(new Set()) // Track which assets have been pre-fetched
const prefetchProgress = ref(0) // Track prefetch progress (0-100)
const prefetchEnabled = ref(true) // Allow disabling prefetching if it causes issues

// Cache statistics tracking
const cacheHits = ref(0)
const cacheMisses = ref(0)

// Debounce utility to prevent rapid successive calls
let getImageUrlTimeout = null

// Import functionality
const selectedFile = ref(null)
const isDragOver = ref(false)
const importing = ref(false)
const refreshing = ref(false)
const importProgress = ref(0)
const progressMessage = ref('')
const importOptions = ref({
  clearExisting: false,
  skipDuplicates: true,
  batchSize: 1000,
  chunkSize: 5000
})
const importResult = ref(null)
const dbStatus = ref({
  totalRecords: null,
  lastUpdated: null
})

// API Health Check
const apiHealthStatus = ref(null)
const checkingApiHealth = ref(false)
const apiHealthError = ref('')

// Cache management functions
function isCacheValid(timestamp) {
  return Date.now() - timestamp < CACHE_DURATION
}

function cleanupCache(cache) {
  const now = Date.now()
  for (const [key, value] of cache.entries()) {
    if (!isCacheValid(value.timestamp)) {
      cache.delete(key)
    }
  }
  
  // If cache is still too large, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = entries.slice(0, cache.size - MAX_CACHE_SIZE)
    toRemove.forEach(([key]) => cache.delete(key))
  }
}

function getCachedAsset(assetId) {
  cleanupCache(assetCache.value)
  const cached = assetCache.value.get(assetId)
  if (cached && isCacheValid(cached.timestamp)) {
    console.log(`📦 Cache HIT for asset: ${assetId}`)
    cacheHits.value++
    return cached.data
  }
  console.log(`📦 Cache MISS for asset: ${assetId}`)
  cacheMisses.value++
  return null
}

function setCachedAsset(assetId, data) {
  cleanupCache(assetCache.value)
  
  // Ensure we have valid data structure before caching
  const cacheData = {
    reference: data?.reference || null,
    predicted: Array.isArray(data?.predicted) ? data.predicted : [],
    timestamp: Date.now()
  }
  
  assetCache.value.set(assetId, {
    data: cacheData,
    timestamp: Date.now()
  })
  console.log(`📦 Cached asset: ${assetId}`, cacheData)
}

function getCachedImageUrl(fileId) {
  cleanupCache(imageUrlCache.value)
  // Create a cache key that includes offline mode state
  const cacheKey = `${fileId}_${offlineMode.value ? 'offline' : 'online'}_${localImagePath.value || 'none'}`
  const cached = imageUrlCache.value.get(cacheKey)
  if (cached && isCacheValid(cached.timestamp)) {
    console.log(`🖼️ Cache HIT for image: ${fileId} (key: ${cacheKey})`)
    cacheHits.value++
    return cached.url
  }
  console.log(`🖼️ Cache MISS for image: ${fileId} (key: ${cacheKey})`)
  cacheMisses.value++
  return null
}

function setCachedImageUrl(fileId, url) {
  cleanupCache(imageUrlCache.value)
  // Create a cache key that includes offline mode state
  const cacheKey = `${fileId}_${offlineMode.value ? 'offline' : 'online'}_${localImagePath.value || 'none'}`
  imageUrlCache.value.set(cacheKey, {
    url: url,
    timestamp: Date.now()
  })
  console.log(`🖼️ Cached image URL: ${fileId} (key: ${cacheKey})`)
}

// Helper function to update image source
function updateImageSource(fileId, source) {
  console.log(`🔄 updateImageSource called - fileId: ${fileId}, source: ${source}`)
  imageActualSources.value[fileId] = source
  console.log(`🔄 imageActualSources.value after update:`, imageActualSources.value)
  
  // Also update the direct ref if this is the reference image
  if (fileId === referenceFileId.value) {
    referenceImageSourceRef.value = source
    console.log(`🔄 Updated referenceImageSourceRef to: ${source}`)
  }
}

function handleSearch() {
  try {
    submitted.value = true
    error.value = ''
    referenceFileId.value = ''
    predicted.value = []
    selectedPredictedIds.value = []
    rejectedPredictedIds.value = []
    assetDataReceived.value = false // Reset at the start of search
    // Don't clear imageActualSources here - preserve pre-fetched source information
    referenceImageSourceRef.value = 'api' // Reset reference image source
    if (assetId.value.trim() === '') return
  
    const currentAssetId = assetId.value.trim()
  
  // Check cache first
  const cachedData = getCachedAsset(currentAssetId)
  console.log(`🔍 Cache check for asset: ${currentAssetId}`)
  console.log(`🔍 Cached data exists:`, !!cachedData)
  if (cachedData) {
    console.log(`🔍 Cached data:`, cachedData)
    console.log(`🔍 Cached data.reference:`, cachedData.reference)
    console.log(`🔍 Cached data.reference?.fileId:`, cachedData.reference?.fileId)
    console.log(`🔍 Cached data.reference !== undefined:`, cachedData.reference !== undefined)
  }
  
  // Check for stale cache data (null fileId indicates stale data from before CSV import)
  if (cachedData && cachedData.reference !== undefined && cachedData.reference.fileId === null) {
    console.log(`🧹 Detected stale cache for asset ${currentAssetId} (fileId is null)`)
    console.log(`🧹 Clearing cache and forcing fresh API call`)
    assetCache.value.delete(currentAssetId)
    prefetchedAssets.value.delete(currentAssetId)
    // Continue to API fetch below
  } else if (cachedData && cachedData.reference !== undefined) {
    console.log(`🚀 Using cached data for asset: ${currentAssetId}`)
    
    // Handle null fileId properly - ensure it stays null, not converted to string
    const fileId = cachedData.reference.fileId
    referenceFileId.value = fileId === null ? null : fileId
    console.log(`🔍 Set referenceFileId.value to:`, referenceFileId.value)
    predicted.value = Array.isArray(cachedData.predicted) ? cachedData.predicted : []
    
    // Load existing review status if asset was previously reviewed
    const existingReview = reviewedAssets.value[currentAssetId]
    
    if (existingReview) {
      referenceDecision.value = existingReview.status
      // Restore selected predicted IDs from saved review
      selectedPredictedIds.value = existingReview.predictedIds || []
      // Set rejected IDs to all predicted IDs except the selected ones
      const allPredictedIds = (predicted.value || []).map(p => String(p.id))
      rejectedPredictedIds.value = allPredictedIds.filter(id => !selectedPredictedIds.value.includes(id))
    } else {
      referenceDecision.value = ''
      selectedPredictedIds.value = []
      // Default all predicted as rejected (red frame)
      rejectedPredictedIds.value = (predicted.value || []).map(p => String(p.id))
    }
    
    // Ensure all predicted images have frames
    ensureAllPredictedHaveFrames()
    
    // Auto-scroll to reference image after DOM update
    nextTick(() => {
      setTimeout(() => {
        scrollToReferenceImage()
      }, 200) // Increased delay to ensure DOM is fully updated
    })
    
    // Schedule pre-fetching of next assets
    schedulePrefetch()
    assetDataReceived.value = true // Asset found in cache
    return
  } else if (cachedData) {
    // Cached data exists but has no reference object at all
    console.log(`🔍 Cached data exists but has no reference object for asset: ${currentAssetId}`)
    console.log(`🔍 Cached data:`, cachedData)
    
    // Clear the cache for this asset so it can be re-fetched from API
    console.log(`🧹 Clearing cache for asset ${currentAssetId} due to missing reference object`)
    assetCache.value.delete(currentAssetId)
    prefetchedAssets.value.delete(currentAssetId)
    
    // Continue to API fetch instead of using cached data
    console.log(`🔄 Falling back to API fetch for asset ${currentAssetId}`)
  }
  
  // If not in cache, fetch from API
  console.log(`🌐 Starting API fetch for asset: ${currentAssetId}`)
  loading.value = true
  
  // Add offline parameter if in offline mode
  const offlineParam = offlineMode.value ? '?offline=true' : ''
  const apiEndpoint = `/api/assets/${encodeURIComponent(currentAssetId)}${offlineParam}`
  console.log(`🌐 Using API endpoint: ${apiEndpoint}`)
  
  fetch(apiEndpoint)
    .then(async (r) => {
      if (!r.ok) {
        let message = 'Failed to search'
        try {
          const data = await r.json()
          if (data && data.error) message = data.error
        } catch (_) {
          try {
            const text = await r.text()
            if (text) message = text
          } catch (_) {}
        }
        throw new Error(message)
      }
      return r.json()
    })
    .then((data) => {
      console.log(`🔍 API response data:`, data)
      console.log(`🔍 data.reference:`, data?.reference)
      console.log(`🔍 data.reference.fileId:`, data?.reference?.fileId)
      
      // Cache the fetched data
      setCachedAsset(currentAssetId, data)
      
      console.log(`🔍 Raw data.reference.fileId:`, data?.reference?.fileId)
      console.log(`🔍 Raw data.reference.fileId type:`, typeof data?.reference?.fileId)
      console.log(`🔍 Raw data.reference.fileId === null:`, data?.reference?.fileId === null)
      console.log(`🔍 About to assign: data?.reference?.fileId =`, data?.reference?.fileId)
      
      // Handle null value properly - ensure it stays null, not converted to string
      const fileId = data?.reference?.fileId
      referenceFileId.value = fileId === null ? null : fileId
      
      console.log(`🔍 Immediately after assignment:`, referenceFileId.value)
      console.log(`🔍 Set referenceFileId.value to:`, referenceFileId.value)
      console.log(`🔍 referenceFileId.value type: ${typeof referenceFileId.value}`)
      console.log(`🔍 referenceFileId.value === null: ${referenceFileId.value === null}`)
      console.log(`🔍 referenceFileId.value === 'null': ${referenceFileId.value === 'null'}`)
      console.log(`🔍 referenceFileId.value === 'undefined': ${referenceFileId.value === 'undefined'}`)
      predicted.value = Array.isArray(data?.predicted) ? data.predicted : []
      
      // Load existing review status if asset was previously reviewed
      const existingReview = reviewedAssets.value[currentAssetId]
      
      if (existingReview) {
        referenceDecision.value = existingReview.status
        // Restore selected predicted IDs from saved review
        selectedPredictedIds.value = existingReview.predictedIds || []
        // Set rejected IDs to all predicted IDs except the selected ones
        const allPredictedIds = (predicted.value || []).map(p => String(p.id))
        rejectedPredictedIds.value = allPredictedIds.filter(id => !selectedPredictedIds.value.includes(id))
      } else {
        referenceDecision.value = ''
        selectedPredictedIds.value = []
        // Default all predicted as rejected (red frame)
        rejectedPredictedIds.value = (predicted.value || []).map(p => String(p.id))
      }
      
      // Ensure all predicted images have frames
      ensureAllPredictedHaveFrames()
      
      // Set asset data received immediately after processing
      assetDataReceived.value = true // Asset found via API
      
      // Auto-scroll to reference image after DOM update
      nextTick(() => {
        setTimeout(() => {
          scrollToReferenceImage()
        }, 200) // Increased delay to ensure DOM is fully updated
      })
      
      // Schedule pre-fetching of next assets
      schedulePrefetch()
    })
    .catch((e) => { 
      error.value = e.message || 'Search failed'
      assetDataReceived.value = false // Asset not found or error
    })
    .finally(() => { 
      loading.value = false
    })
  } catch (error) {
    console.error('Error in handleSearch:', error)
    error.value = error.message || 'Search failed'
    assetDataReceived.value = false // Unexpected error
    loading.value = false
  }
}

const showEmptyInfo = computed(() => submitted.value && assetId.value.trim() === '')
const hasAssetBeenFound = computed(() => {
  // An asset is considered "found" if assetDataReceived is true, meaning the API/cache returned data for it.
  return assetDataReceived.value
})
const showNoMatches = computed(() => submitted.value && !loading.value && !error.value && assetId.value.trim() !== '' && !hasAssetBeenFound.value)

function isPredSelected(id) {
  return selectedPredictedIds.value.includes(String(id))
}

function togglePredSelected(id) {
  const key = String(id)
  const curr = selectedPredictedIds.value.slice()
  const idx = curr.indexOf(key)
  if (idx >= 0) {
    curr.splice(idx, 1)
    // When removing from selected, add to rejected to ensure it has a frame
    if (!rejectedPredictedIds.value.includes(key)) {
      rejectedPredictedIds.value.push(key)
    }
  } else {
    curr.push(key)
    // ensure mutually exclusive with rejected
    const rej = rejectedPredictedIds.value.slice()
    const rIdx = rej.indexOf(key)
    if (rIdx >= 0) { rej.splice(rIdx, 1) }
    rejectedPredictedIds.value = rej
  }
  selectedPredictedIds.value = curr
}

function isPredRejected(id) {
  return rejectedPredictedIds.value.includes(String(id))
}

function togglePredRejected(id) {
  const key = String(id)
  const curr = rejectedPredictedIds.value.slice()
  const idx = curr.indexOf(key)
  if (idx >= 0) {
    curr.splice(idx, 1)
    // When removing from rejected, add to selected to ensure it has a frame
    if (!selectedPredictedIds.value.includes(key)) {
      selectedPredictedIds.value.push(key)
    }
  } else {
    curr.push(key)
    // ensure mutually exclusive with selected
    const sel = selectedPredictedIds.value.slice()
    const sIdx = sel.indexOf(key)
    if (sIdx >= 0) { sel.splice(sIdx, 1) }
    selectedPredictedIds.value = sel
  }
  rejectedPredictedIds.value = curr
}

async function loadPage(p = 1) {
  try {
    // Use the filtered endpoint if we have a filter other than 'all'
    if (assetFilter.value !== 'all') {
      const res = await fetch('/api/assets-page-filtered', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page: p,
          pageSize: pageSize.value,
          filter: assetFilter.value,
          reviewedAssets: reviewedAssets.value
        })
      })
      const data = await res.json()
      console.log('Loaded filtered page data:', data)
      ids.value = Array.isArray(data?.ids) ? data.ids : []
      page.value = Number(data?.page) || 1
      totalAssets.value = Number(data?.total) || 0
      overallTotalAssets.value = Number(data?.overallTotal) || 0
      
      // Calculate pageCount if not provided or if it's 0 but we have assets
      const calculatedPageCount = Math.ceil(totalAssets.value / pageSize.value)
      pageCount.value = Number(data?.pageCount) || calculatedPageCount
      
      // Ensure pageCount is at least 1 if we have any assets
      if (totalAssets.value > 0 && pageCount.value === 0) {
        pageCount.value = 1
      }
    } else {
      // Use the regular endpoint for 'all' filter
      const res = await fetch(`/api/assets-page?page=${p}&pageSize=${pageSize.value}`)
      const data = await res.json()
      console.log('Loaded page data:', data)
      ids.value = Array.isArray(data?.ids) ? data.ids : []
      page.value = Number(data?.page) || 1
      totalAssets.value = Number(data?.total) || 0
      overallTotalAssets.value = Number(data?.total) || 0 // For 'all' filter, total is the same as overallTotal
      
      // Calculate pageCount if not provided or if it's 0 but we have assets
      const calculatedPageCount = Math.ceil(totalAssets.value / pageSize.value)
      pageCount.value = Number(data?.pageCount) || calculatedPageCount
      
      // Ensure pageCount is at least 1 if we have any assets
      if (totalAssets.value > 0 && pageCount.value === 0) {
        pageCount.value = 1
      }
    }
    
    console.log('Asset IDs loaded:', ids.value.length, 'ids:', ids.value.slice(0, 5))
    
    // Schedule initial pre-fetching if we have assets and no current asset is loaded
    if (ids.value.length > 0 && !assetId.value.trim()) {
      setTimeout(() => {
        prefetchNextAssets()
      }, 500)
    }
  } catch (error) {
    console.error('Error loading page:', error)
  }
}

function goPage(p) {
  if (p < 1) p = 1
  if (pageCount.value && p > pageCount.value) p = pageCount.value
  loadPage(p)
}

function handlePageSizeChange() {
  // Reset to first page when changing page size
  page.value = 1
  prefetchedAssets.value.clear() // Clear pre-fetched assets when page size changes
  loadPage(1)
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
}

function handleAssetFilterChange() {
  // Reset to first page when changing filter
  page.value = 1
  prefetchedAssets.value.clear() // Clear pre-fetched assets when filter changes
  loadPage(1)
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
}

function getFilterDisplayName(filter) {
  switch (filter) {
    case 'accepted': return 'Accepted'
    case 'rejected': return 'Rejected'
    case 'not-reviewed': return 'Not Reviewed'
    case 'all': return 'Assets'
    default: return 'Assets'
  }
}

function handleAccept() {
  if (!assetId.value.trim()) return
  
  const selectedIds = selectedPredictedIds.value
  
  // Store predicted data with scores for export
  const predictedData = predicted.value.map(p => ({
    id: String(p.id),
    score: p.score
  }))
  
  reviewedAssets.value[assetId.value.trim()] = {
    status: 'accepted',
    predictedIds: selectedIds,
    predictedData: predictedData
  }
  referenceDecision.value = 'accepted'
  
  // Save to localStorage for persistence
  localStorage.setItem('reviewedAssets', JSON.stringify(reviewedAssets.value))
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
  
  // Clear asset cache for this specific asset since review status changed
  const currentAssetId = assetId.value.trim()
  assetCache.value.delete(currentAssetId)
  prefetchedAssets.value.delete(currentAssetId)
  console.log(`🧹 Asset cache cleared for: ${currentAssetId}`)
  
  console.log('Asset accepted:', currentAssetId, 'with predicted IDs:', selectedIds)
  
  // Automatically load next unreviewed asset
  loadNextUnreviewedAsset()
}

function handleReject() {
  if (!assetId.value.trim()) return
  
  const selectedIds = selectedPredictedIds.value
  
  // Store predicted data with scores for export
  const predictedData = predicted.value.map(p => ({
    id: String(p.id),
    score: p.score
  }))
  
  reviewedAssets.value[assetId.value.trim()] = {
    status: 'rejected',
    predictedIds: selectedIds,
    predictedData: predictedData
  }
  referenceDecision.value = 'rejected'
  
  // Save to localStorage for persistence
  localStorage.setItem('reviewedAssets', JSON.stringify(reviewedAssets.value))
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
  
  // Clear asset cache for this specific asset since review status changed
  const currentAssetId = assetId.value.trim()
  assetCache.value.delete(currentAssetId)
  prefetchedAssets.value.delete(currentAssetId)
  console.log(`🧹 Asset cache cleared for: ${currentAssetId}`)
  
  console.log('Asset rejected:', currentAssetId, 'with predicted IDs:', selectedIds)
  
  // Automatically load next unreviewed asset
  loadNextUnreviewedAsset()
}

function handleCompleteReview() {
  if (!assetId.value.trim()) return
  
  const selectedIds = selectedPredictedIds.value
  const allPredictedIds = predicted.value.map(p => String(p.id))
  
  // Check if all predicted images are rejected (red frame)
  const allRejected = allPredictedIds.every(id => rejectedPredictedIds.value.includes(id))
  
  // If all images are rejected, mark as rejected, otherwise as accepted
  const status = allRejected ? 'rejected' : 'accepted'
  
  // Store predicted data with scores for export
  const predictedData = predicted.value.map(p => ({
    id: String(p.id),
    score: p.score
  }))
  
  reviewedAssets.value[assetId.value.trim()] = {
    status: status,
    predictedIds: selectedIds,
    predictedData: predictedData // Store all predicted data with scores
  }
  referenceDecision.value = status
  
  // Save to localStorage for persistence
  localStorage.setItem('reviewedAssets', JSON.stringify(reviewedAssets.value))
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
  
  // Clear asset cache for this specific asset since review status changed
  const currentAssetId = assetId.value.trim()
  assetCache.value.delete(currentAssetId)
  prefetchedAssets.value.delete(currentAssetId)
  console.log(`🧹 Asset cache cleared for: ${currentAssetId}`)
  
  console.log('Asset review completed:', currentAssetId, 'with status:', status, 'and predicted IDs:', selectedIds)
  
  // Automatically load next unreviewed asset
  loadNextUnreviewedAsset()
}

function handleClearReview() {
  if (!assetId.value.trim()) return
  
  // Remove the asset from reviewed assets
  delete reviewedAssets.value[assetId.value.trim()]
  referenceDecision.value = ''
  
  // Reset predicted image selections to default (all rejected)
  selectedPredictedIds.value = []
  rejectedPredictedIds.value = (predicted.value || []).map(p => String(p.id))
  
  // Save to localStorage for persistence
  localStorage.setItem('reviewedAssets', JSON.stringify(reviewedAssets.value))
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
  
  // Clear asset cache for this specific asset since review status changed
  const currentAssetId = assetId.value.trim()
  assetCache.value.delete(currentAssetId)
  prefetchedAssets.value.delete(currentAssetId)
  console.log(`🧹 Asset cache cleared for: ${currentAssetId}`)
  
  console.log('Asset review cleared:', currentAssetId)
}

function loadNextUnreviewedAsset() {
  // Find the next unreviewed asset in the current page
  const currentIndex = ids.value.findIndex(id => id === assetId.value.trim())
  let nextIndex = currentIndex + 1
  
  // Look for next unreviewed asset on current page
  while (nextIndex < ids.value.length) {
    const nextId = ids.value[nextIndex]
    if (!isAssetReviewed(nextId)) {
      assetId.value = nextId
      handleSearch()
      return
    }
    nextIndex++
  }
  
  // If no unreviewed assets on current page, try next page
  if (page.value < pageCount.value) {
    goPage(page.value + 1)
    // Wait for page to load, then find first unreviewed asset
    setTimeout(() => {
      const firstUnreviewed = ids.value.find(id => !isAssetReviewed(id))
      if (firstUnreviewed) {
        assetId.value = firstUnreviewed
        handleSearch()
      }
    }, 100)
  } else {
    // If we're on the last page and no more unreviewed assets, show completion message
    console.log('All assets have been reviewed!')
  }
}

function isAssetReviewed(assetId) {
  return reviewedAssets.value[assetId] !== undefined
}

function getAssetReviewStatus(assetId) {
  return reviewedAssets.value[assetId]?.status || null
}

// Function to ensure assets are loaded
async function ensureAssetsLoaded() {
  if (!ids.value || ids.value.length === 0) {
    console.log('🔍 No assets loaded, attempting to load assets...')
    try {
      await loadPage(page.value || 1)
      console.log('🔍 Assets loaded successfully:', ids.value.length, 'assets')
    } catch (error) {
      console.error('❌ Failed to load assets:', error)
      return false
    }
  }
  return true
}

// Navigation functions
async function goToPreviousAsset() {
  console.log('🔍 goToPreviousAsset called')
  console.log('🔍 Current assetId:', assetId.value)
  console.log('🔍 Available ids:', ids.value)
  
  // Ensure assets are loaded
  if (!(await ensureAssetsLoaded())) {
    console.log('❌ Failed to load assets, cannot navigate')
    return
  }
  
  const currentIndex = ids.value.findIndex(id => id === assetId.value.trim())
  console.log('🔍 Current index:', currentIndex)
  
  if (currentIndex > 0) {
    const newAssetId = ids.value[currentIndex - 1]
    console.log('🔍 Navigating to previous asset:', newAssetId)
    assetId.value = newAssetId
    handleSearch() // Use handleSearch instead of loadAssetImages to trigger prefetching
  } else {
    console.log('❌ Already at first asset, cannot go previous')
  }
}

async function goToNextAsset() {
  console.log('🔍 goToNextAsset called')
  console.log('🔍 Current assetId:', assetId.value)
  console.log('🔍 Available ids:', ids.value)
  
  // Ensure assets are loaded
  if (!(await ensureAssetsLoaded())) {
    console.log('❌ Failed to load assets, cannot navigate')
    return
  }
  
  const currentIndex = ids.value.findIndex(id => id === assetId.value.trim())
  console.log('🔍 Current index:', currentIndex)
  
  if (currentIndex < ids.value.length - 1) {
    const newAssetId = ids.value[currentIndex + 1]
    console.log('🔍 Navigating to next asset:', newAssetId)
    assetId.value = newAssetId
    handleSearch() // Use handleSearch instead of loadAssetImages to trigger prefetching
  } else {
    console.log('❌ Already at last asset, cannot go next')
  }
}

// Function to scroll to reference image
function scrollToReferenceImage() {
  console.log('scrollToReferenceImage called, referenceImageRef:', referenceImageRef.value)
  console.log('🔍 referenceFileId.value:', referenceFileId.value)
  console.log('🔍 referenceFileId.value type:', typeof referenceFileId.value)
  console.log('🔍 referenceFileId.value === null:', referenceFileId.value === null)
  console.log('🔍 referenceFileId.value === "null":', referenceFileId.value === 'null')
  console.log('🔍 referenceFileId.value === "undefined":', referenceFileId.value === 'undefined')
  console.log('🔍 !referenceFileId.value:', !referenceFileId.value)
  console.log('🔍 offlineMode.value:', offlineMode.value)
  console.log('🔍 localImagePath.value:', localImagePath.value)
  
  // Check if we should have a reference image (same logic as template)
  const hasReferenceImage = (referenceFileId.value && referenceFileId.value !== null && referenceFileId.value !== 'null' && referenceFileId.value !== 'undefined') || (offlineMode.value && localImagePath.value)
  
  if (!hasReferenceImage) {
    console.log('No reference image should be displayed, skipping scroll')
    return
  }
  
  // Helper function to attempt scrolling with retries
  const attemptScroll = (attempt = 1, maxAttempts = 3) => {
    if (referenceImageRef.value) {
      referenceImageRef.value.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start',
        inline: 'nearest'
      })
      console.log('Scrolled to reference image')
      return true
    } else {
      console.log(`referenceImageRef is null on attempt ${attempt}`)
      if (attempt < maxAttempts) {
        setTimeout(() => {
          attemptScroll(attempt + 1, maxAttempts)
        }, 200 * attempt) // Exponential backoff: 200ms, 400ms, 600ms
      } else {
        console.log('Max attempts reached, DOM element may not exist yet')
      }
      return false
    }
  }
  
  // Use nextTick to ensure DOM is updated before trying to scroll
  nextTick(() => {
    attemptScroll()
  })
}

// Function to show image preview on hover
function showImagePreview(image) {
  previewImage.value = image
}

  // Function to show reference image preview
  function showReferenceImagePreview() {
    previewImage.value = {
      id: assetId.value,
      fileId: referenceFileId.value,
      score: null
    }
  }

// Function to hide image preview
function hideImagePreview() {
  previewImage.value = null
}

// Function to load only the images without full page refresh
function loadAssetImages(assetId) {
  if (!assetId || assetId.trim() === '') return
  
  loading.value = true
  error.value = ''
  assetDataReceived.value = false // Reset at the start of loading
  // Don't clear imageActualSources here - preserve pre-fetched source information
  referenceImageSourceRef.value = 'api' // Reset reference image source
  
  fetch(`/api/assets/${encodeURIComponent(assetId.trim())}`)
    .then(async (r) => {
      if (!r.ok) {
        let message = 'Failed to load images'
        try {
          const data = await r.json()
          if (data && data.error) message = data.error
        } catch (_) {
          try {
            const text = await r.text()
            if (text) message = text
          } catch (_) {}
        }
        throw new Error(message)
      }
      return r.json()
    })
    .then((data) => {
      referenceFileId.value = data?.reference?.fileId
      predicted.value = Array.isArray(data?.predicted) ? data.predicted : []
      
      // Load existing review status if asset was previously reviewed
      const existingReview = reviewedAssets.value[assetId.trim()]
      
      if (existingReview) {
        referenceDecision.value = existingReview.status
        // Restore selected predicted IDs from saved review
        selectedPredictedIds.value = existingReview.predictedIds || []
        // Set rejected IDs to all predicted IDs except the selected ones
        const allPredictedIds = (predicted.value || []).map(p => String(p.id))
        rejectedPredictedIds.value = allPredictedIds.filter(id => !selectedPredictedIds.value.includes(id))
      } else {
        referenceDecision.value = ''
        selectedPredictedIds.value = []
               // Default all predicted as rejected (red frame)
       rejectedPredictedIds.value = (predicted.value || []).map(p => String(p.id))
     }
     
     // Ensure all predicted images have frames
     ensureAllPredictedHaveFrames()
     
     // Set asset data received immediately after processing
     assetDataReceived.value = true // Asset found via API
     
     // Auto-scroll to reference image with longer delay to ensure DOM is updated
     nextTick(() => {
       setTimeout(() => {
         scrollToReferenceImage()
       }, 300)
     })
     
     // Schedule pre-fetching of next assets
     schedulePrefetch()
   })
    .catch((e) => { 
      error.value = e.message || 'Failed to load images'
      assetDataReceived.value = false // Asset not found or error
    })
    .finally(() => { loading.value = false })
}

// Computed properties for navigation
const canGoToPrevious = computed(() => {
  if (!assetId.value || !assetId.value.trim()) {
    console.log('🔍 canGoToPrevious: no asset ID')
    return false
  }
  if (!ids.value || ids.value.length === 0) {
    console.log('🔍 canGoToPrevious: no assets loaded')
    return false
  }
  const currentIndex = ids.value.findIndex(id => id === assetId.value.trim())
  console.log('🔍 canGoToPrevious: current index', currentIndex, 'of', ids.value.length)
  return currentIndex > 0
})

const canGoToNext = computed(() => {
  if (!assetId.value || !assetId.value.trim()) {
    console.log('🔍 canGoToNext: no asset ID')
    return false
  }
  if (!ids.value || ids.value.length === 0) {
    console.log('🔍 canGoToNext: no assets loaded')
    return false
  }
  const currentIndex = ids.value.findIndex(id => id === assetId.value.trim())
  console.log('🔍 canGoToNext: current index', currentIndex, 'of', ids.value.length)
  return currentIndex < ids.value.length - 1
})

// Comprehensive data persistence system
function saveApplicationState() {
  try {
    const state = {
      // Current asset and navigation state
      assetId: assetId.value,
      page: page.value,
      pageSize: pageSize.value,
      assetFilter: assetFilter.value,
      activeTab: activeTab.value,
      
      // Export settings
      exportPreviewPage: exportPreviewPage.value,
      exportPreviewPageSize: exportPreviewPageSize.value,
      exportFilter: exportFilter.value,
      
      // Current asset review state
      referenceDecision: referenceDecision.value,
      selectedPredictedIds: selectedPredictedIds.value,
      rejectedPredictedIds: rejectedPredictedIds.value,
      
      // Settings
      darkMode: darkMode.value,
      offlineMode: offlineMode.value,
      localImagePath: localImagePath.value,
      
      // Cache statistics
      cacheHits: cacheHits.value,
      cacheMisses: cacheMisses.value,
      
      // Timestamp for validation
      timestamp: Date.now()
    }
    
    const stateString = JSON.stringify(state)
    
    // Check if the state is too large for localStorage (typically 5-10MB limit)
    if (stateString.length > 4 * 1024 * 1024) { // 4MB threshold
      console.warn('⚠️ Application state too large for localStorage, saving minimal state only')
      
      // Save only essential navigation state
      const minimalState = {
        page: page.value,
        pageSize: pageSize.value,
        assetFilter: assetFilter.value,
        activeTab: activeTab.value,
        darkMode: darkMode.value,
        offlineMode: offlineMode.value,
        localImagePath: localImagePath.value,
        timestamp: Date.now()
      }
      
      localStorage.setItem('applicationState', JSON.stringify(minimalState))
      console.log('💾 Minimal application state saved successfully')
    } else {
      localStorage.setItem('applicationState', stateString)
      console.log('💾 Application state saved successfully')
    }
  } catch (error) {
    console.error('Error saving application state:', error)
    
    // If localStorage fails completely, try to save minimal state
    try {
      const minimalState = {
        page: page.value,
        pageSize: pageSize.value,
        assetFilter: assetFilter.value,
        activeTab: activeTab.value,
        timestamp: Date.now()
      }
      localStorage.setItem('applicationState', JSON.stringify(minimalState))
      console.log('💾 Fallback minimal state saved')
    } catch (fallbackError) {
      console.error('Failed to save even minimal state:', fallbackError)
    }
  }
}

function loadApplicationState() {
  try {
    const saved = localStorage.getItem('applicationState')
    if (saved) {
      const state = JSON.parse(saved)
      
      // Validate timestamp (don't restore if older than 30 days)
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
      if (state.timestamp && state.timestamp < thirtyDaysAgo) {
        console.log('🕒 Application state is too old, starting fresh')
        return
      }
      
      // Restore state
      if (state.assetId) assetId.value = state.assetId
      if (state.page) page.value = state.page
      if (state.pageSize) pageSize.value = state.pageSize
      if (state.assetFilter) assetFilter.value = state.assetFilter
      if (state.activeTab) activeTab.value = state.activeTab
      
      if (state.exportPreviewPage) exportPreviewPage.value = state.exportPreviewPage
      if (state.exportPreviewPageSize) exportPreviewPageSize.value = state.exportPreviewPageSize
      if (state.exportFilter) exportFilter.value = state.exportFilter
      
      if (state.referenceDecision) referenceDecision.value = state.referenceDecision
      if (state.selectedPredictedIds) selectedPredictedIds.value = state.selectedPredictedIds
      if (state.rejectedPredictedIds) rejectedPredictedIds.value = state.rejectedPredictedIds
      
      if (state.darkMode !== undefined) darkMode.value = state.darkMode
      if (state.offlineMode !== undefined) offlineMode.value = state.offlineMode
      if (state.localImagePath) localImagePath.value = state.localImagePath
      
      if (state.cacheHits !== undefined) cacheHits.value = state.cacheHits
      if (state.cacheMisses !== undefined) cacheMisses.value = state.cacheMisses
      
      console.log('📂 Application state restored successfully')
    }
  } catch (error) {
    console.error('Error loading application state:', error)
  }
}

// Load reviewed assets from localStorage on component mount
function loadReviewedAssets() {
  try {
    const saved = localStorage.getItem('reviewedAssets')
    if (saved) {
      reviewedAssets.value = JSON.parse(saved)
      console.log('Loaded reviewed assets:', reviewedAssets.value)
    }
  } catch (error) {
    console.error('Error loading reviewed assets:', error)
  }
}

// Load dark mode preference from localStorage
function loadDarkModePreference() {
  try {
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) {
      darkMode.value = JSON.parse(saved)
      console.log('Loaded dark mode preference:', darkMode.value)
    }
  } catch (error) {
    console.error('Error loading dark mode preference:', error)
  }
}

// Toggle dark mode
function toggleDarkMode() {
  darkMode.value = !darkMode.value
  localStorage.setItem('darkMode', JSON.stringify(darkMode.value))
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
  console.log('Dark mode toggled to:', darkMode.value)
}

// Keyboard navigation handler
function handleKeyboardNavigation(event) {
  // Only handle keyboard events when we're on the review tab and have an asset loaded
  if (activeTab.value !== 'review' || !assetId.value.trim()) {
    console.log('🔍 Keyboard navigation blocked: not on review tab or no asset loaded')
    return
  }
  
  // Don't handle keyboard events if user is typing in an input field
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
    console.log('🔍 Keyboard navigation blocked: user typing in input field')
    return
  }
  
  // Don't handle keyboard events if loading
  if (loading.value) {
    console.log('🔍 Keyboard navigation blocked: currently loading')
    return
  }
  
  console.log(`🔍 Keyboard navigation: ${event.key} pressed`)
  
  switch (event.key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      if (canGoToPrevious.value) {
        console.log('⬅️ Keyboard navigation: Previous asset')
        event.preventDefault()
        goToPreviousAsset()
      } else {
        console.log('🔍 Cannot go to previous: at first asset or no assets loaded')
      }
      break
    case '+':
      // Select all predicted images
      if (predicted.value && predicted.value.length > 0) {
        event.preventDefault()
        const allIds = predicted.value.map(p => String(p.id))
        selectedPredictedIds.value = allIds
        // ensure rejected is cleared for selected ones
        rejectedPredictedIds.value = []
        console.log('✅ Keyboard: Selected all predicted IDs')
      }
      break
    case '-':
      // Unselect all predicted images
      if (predicted.value && predicted.value.length > 0) {
        event.preventDefault()
        selectedPredictedIds.value = []
        // mark all as rejected to keep visible frames
        rejectedPredictedIds.value = predicted.value.map(p => String(p.id))
        console.log('✅ Keyboard: Unselected all predicted IDs')
      }
      break
    case 'ArrowRight':
    case 'd':
    case 'D':
      if (canGoToNext.value) {
        console.log('➡️ Keyboard navigation: Next asset')
        event.preventDefault()
        goToNextAsset()
      } else {
        console.log('🔍 Cannot go to next: at last asset or no assets loaded')
      }
      break
    case 'Enter':
    case ' ':
      if (assetId.value.trim()) {
        console.log('✅ Keyboard navigation: Complete review')
        event.preventDefault()
        handleCompleteReview()
      }
      break
    case 'Delete':
    case 'Backspace':
    case 'r':
    case 'R':
      if (assetId.value.trim()) {
        console.log('🗑️ Keyboard navigation: Clear review')
        event.preventDefault()
        handleClearReview()
      }
      break
    case 'Escape':
      console.log('🚪 Keyboard navigation: Hide preview')
      event.preventDefault()
      hideImagePreview()
      break
    case 'f':
    case 'F':
      console.log('🔍 Keyboard navigation: Focus search')
      event.preventDefault()
      // Focus the asset ID input field
      const searchInput = document.querySelector('input[placeholder*="asset"]')
      if (searchInput) {
        searchInput.focus()
        searchInput.select()
      }
      break
  }
}

// Lifecycle hooks
onMounted(() => {
  // Add keyboard event listener
  document.addEventListener('keydown', handleKeyboardNavigation)
  
  // Auto-save application state when important values change
  // Use debounced watchers to prevent excessive saves
  let saveTimeout = null
  const debouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      saveApplicationState()
    }, 1000) // Save after 1 second of inactivity
  }

  // Watch important state changes with debouncing
  watch([assetId, page, pageSize, assetFilter, activeTab], debouncedSave, { deep: true })
  watch([exportPreviewPage, exportPreviewPageSize, exportFilter], debouncedSave)
  watch([referenceDecision, selectedPredictedIds, rejectedPredictedIds], debouncedSave, { deep: true })

  // Watch cache statistics (less frequent)
  watch([cacheHits, cacheMisses], () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      saveApplicationState()
    }, 2000) // Save cache stats after 2 seconds
  })

  // Watch for changes in referenceFileId to debug rendering issues
  watch(referenceFileId, (newValue, oldValue) => {
    console.log(`🔍 referenceFileId watcher - changed from "${oldValue}" to "${newValue}"`)
    console.log(`🔍 referenceFileId type: ${typeof newValue}`)
    console.log(`🔍 referenceFileId === null: ${newValue === null}`)
    console.log(`🔍 referenceFileId === 'null': ${newValue === 'null'}`)
    console.log(`🔍 referenceFileId === 'undefined': ${newValue === 'undefined'}`)
    console.log(`🔍 referenceFileId truthy check: ${!!newValue}`)
    
    if (newValue && newValue !== oldValue && newValue !== 'null' && newValue !== 'undefined') {
      nextTick(() => {
        setTimeout(() => {
          scrollToReferenceImage()
        }, 300) // Add delay to ensure DOM is fully updated
      })
    }
  })
})

onUnmounted(() => {
  // Remove keyboard event listener
  document.removeEventListener('keydown', handleKeyboardNavigation)
})

// Initialize application state
loadApplicationState()
loadReviewedAssets()
loadDarkModePreference()
loadOfflineSettings()

// Load initial page after state is restored
loadPage(1)

function exportToCSV() {
  const csvData = []
  
  // Add header row
  csvData.push(['Asset ID', 'Predicted ID', 'Score', 'Status'])
  
  // Add data rows - one row per asset ID - predicted ID combination
  Object.entries(reviewedAssets.value).forEach(([assetId, reviewData]) => {
    // Apply filter based on selected filter
    if (exportFilter.value === 'accepted' && reviewData.status !== 'accepted') return
    if (exportFilter.value === 'rejected' && reviewData.status !== 'rejected') return
    
    console.log('Processing asset:', assetId, 'reviewData:', reviewData)
    
    if (reviewData.predictedIds && reviewData.predictedIds.length > 0) {
      // For each selected predicted ID, create a separate row
      reviewData.predictedIds.forEach(predictedId => {
        // Find the score for this predicted ID from stored data
        let score = 'N/A'
        if (reviewData.predictedData) {
          console.log('Looking for predictedId:', predictedId, 'in predictedData:', reviewData.predictedData)
          const predItem = reviewData.predictedData.find(p => String(p.id) === String(predictedId))
          console.log('Found predItem:', predItem)
          if (predItem && predItem.score != null) {
            score = Number(predItem.score).toFixed(2)
          }
        } else {
          console.log('No predictedData found for asset:', assetId)
        }
        csvData.push([assetId, predictedId, score, reviewData.status])
      })
    } else {
      // If no predicted IDs selected, still create a row with the asset
      csvData.push([assetId, 'None', 'N/A', reviewData.status])
    }
  })
  
  // Convert to CSV string
  const csvContent = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
  
  // Create and download file
  const filterSuffix = exportFilter.value !== 'all' ? `_${exportFilter.value}` : ''
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `asset_reviews${filterSuffix}_${new Date().toISOString().split('T')[0]}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  console.log('CSV exported with', csvData.length - 1, 'rows (excluding header) for filter:', exportFilter.value)
}

// Export reviewed assets data as JSON for backup/transfer
function exportReviewedAssets() {
  try {
    const exportData = {
      reviewedAssets: reviewedAssets.value,
      exportDate: new Date().toISOString(),
      version: '1.0',
      totalAssets: Object.keys(reviewedAssets.value).length,
      acceptedCount: Object.values(reviewedAssets.value).filter(r => r.status === 'accepted').length,
      rejectedCount: Object.values(reviewedAssets.value).filter(r => r.status === 'rejected').length
    }
    
    const jsonContent = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `reviewed_assets_backup_${new Date().toISOString().split('T')[0]}.json`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    console.log('✅ Reviewed assets exported successfully:', exportData.totalAssets, 'assets')
    alert(`✅ Successfully exported ${exportData.totalAssets} reviewed assets!`)
  } catch (error) {
    console.error('❌ Error exporting reviewed assets:', error)
    alert('❌ Error exporting reviewed assets. Please try again.')
  }
}

// Import reviewed assets data from JSON file
function importReviewedAssets() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.style.display = 'none'
  
  input.onchange = (event) => {
    const file = event.target.files[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result)
        
        // Validate the imported data
        if (!importData.reviewedAssets || typeof importData.reviewedAssets !== 'object') {
          throw new Error('Invalid file format: missing reviewedAssets data')
        }
        
        // Check if this is a valid backup file
        if (!importData.exportDate || !importData.version) {
          throw new Error('Invalid backup file: missing metadata')
        }
        
        const totalAssets = Object.keys(importData.reviewedAssets).length
        const acceptedCount = Object.values(importData.reviewedAssets).filter(r => r.status === 'accepted').length
        const rejectedCount = Object.values(importData.reviewedAssets).filter(r => r.status === 'rejected').length
        
        // Show confirmation dialog with import details
        const confirmMessage = `📥 Import Review Data
        
File Details:
• Export Date: ${new Date(importData.exportDate).toLocaleString()}
• Total Assets: ${totalAssets}
• Accepted: ${acceptedCount}
• Rejected: ${rejectedCount}

Current Data:
• Total Assets: ${Object.keys(reviewedAssets.value).length}
• Accepted: ${Object.values(reviewedAssets.value).filter(r => r.status === 'accepted').length}
• Rejected: ${Object.values(reviewedAssets.value).filter(r => r.status === 'rejected').length}

⚠️ This will replace your current review data!
Type "IMPORT" to confirm:`
        
        const userInput = prompt(confirmMessage)
        
        if (userInput === 'IMPORT') {
          // Import the data
          reviewedAssets.value = importData.reviewedAssets
          
          // Save to localStorage
          localStorage.setItem('reviewedAssets', JSON.stringify(reviewedAssets.value))
          saveApplicationState()
          
          // Clear caches since review data changed
          assetCache.value.clear()
          prefetchedAssets.value.clear()
          
          console.log('✅ Successfully imported', totalAssets, 'reviewed assets')
          alert(`✅ Successfully imported ${totalAssets} reviewed assets!`)
          
          // Reload current page to update asset ID pills
          loadPage(page.value)
        } else {
          console.log('Import cancelled by user')
          alert('Import cancelled.')
        }
        
      } catch (error) {
        console.error('❌ Error importing reviewed assets:', error)
        alert(`❌ Error importing file: ${error.message}`)
      }
    }
    
    reader.readAsText(file)
  }
  
  document.body.appendChild(input)
  input.click()
  document.body.removeChild(input)
}

// Computed properties for export preview pagination
const exportPreviewData = computed(() => {
  let flattenedData = []
  
  // Flatten the data to one row per asset ID - predicted ID combination
  Object.entries(reviewedAssets.value).forEach(([assetId, reviewData]) => {
    // Filter based on selected filter
    if (exportFilter.value === 'accepted' && reviewData.status !== 'accepted') return
    if (exportFilter.value === 'rejected' && reviewData.status !== 'rejected') return
    
    if (reviewData.predictedIds && reviewData.predictedIds.length > 0) {
      // For each selected predicted ID, create a separate row
      reviewData.predictedIds.forEach(predictedId => {
        // Find the score for this predicted ID from stored data
        let score = 'N/A'
        if (reviewData.predictedData) {
          const predItem = reviewData.predictedData.find(p => String(p.id) === String(predictedId))
          if (predItem && predItem.score != null) {
            score = Number(predItem.score).toFixed(2)
          }
        }
        flattenedData.push({
          assetId,
          predictedId,
          score,
          status: reviewData.status
        })
      })
    } else {
      // If no predicted IDs selected, still create a row with the asset
      flattenedData.push({
        assetId,
        predictedId: 'None',
        score: 'N/A',
        status: reviewData.status
      })
    }
  })
  
  const startIndex = (exportPreviewPage.value - 1) * exportPreviewPageSize.value
  const endIndex = startIndex + exportPreviewPageSize.value
  return flattenedData.slice(startIndex, endIndex)
})

const exportPreviewPageCount = computed(() => {
  let totalRows = 0
  
  // Count total rows for pagination
  Object.entries(reviewedAssets.value).forEach(([assetId, reviewData]) => {
    // Filter based on selected filter
    if (exportFilter.value === 'accepted' && reviewData.status !== 'accepted') return
    if (exportFilter.value === 'rejected' && reviewData.status !== 'rejected') return
    
    if (reviewData.predictedIds && reviewData.predictedIds.length > 0) {
      totalRows += reviewData.predictedIds.length
    } else {
      totalRows += 1 // One row for assets with no selected predicted IDs
    }
  })
  
  return Math.ceil(totalRows / exportPreviewPageSize.value)
})

function goExportPreviewPage(page) {
  if (page < 1) page = 1
  if (exportPreviewPageCount.value && page > exportPreviewPageCount.value) page = exportPreviewPageCount.value
  exportPreviewPage.value = page
}

function handleExportFilterChange() {
  // Reset to first page when changing filter
  exportPreviewPage.value = 1
}

// Function to ensure all predicted images have frames (either red or green)
function ensureAllPredictedHaveFrames() {
  const allPredictedIds = (predicted.value || []).map(p => String(p.id))
  const selectedIds = selectedPredictedIds.value
  const rejectedIds = rejectedPredictedIds.value
  
  // For any predicted image that doesn't have a frame, assign it to rejected (red)
  allPredictedIds.forEach(id => {
    if (!selectedIds.includes(id) && !rejectedIds.includes(id)) {
      rejectedPredictedIds.value.push(id)
    }
  })
}

// Settings functions
function clearAllReviews() {
  const warningMessage = `🚨 NUCLEAR OPTION ACTIVATED! 🚨

Are you absolutely, positively, 100% certain you want to delete ALL your precious review work?

⚠️  WARNING: This will erase:
• All your accepted assets (${Object.values(reviewedAssets.value).filter(r => r.status === 'accepted').length} items)
• All your rejected assets (${Object.values(reviewedAssets.value).filter(r => r.status === 'rejected').length} items)
• All your carefully selected target IDs
• Hours of your valuable time

💡 RECOMMENDATION: 
Instead of this nuclear option, use the "Clear Review" button under each asset for individual resets.

🔥 ONLY proceed if:
• The world is ending
• You're starting a completely new dataset
• You've been possessed by a data-destroying demon
• You're absolutely sure you want to lose everything

Type "I AM SURE" to confirm this irreversible action:`
  
  const userInput = prompt(warningMessage)
  
  if (userInput === 'I AM SURE') {
    reviewedAssets.value = {}
    localStorage.removeItem('reviewedAssets')
    console.log('All review data cleared - user confirmed nuclear option')
    
    // Clear asset cache since review data affects asset display
    assetCache.value.clear()
    imageActualSources.value = {} // Clear source tracking since review data affects asset display
    try {
      saveApplicationState()
    } catch (error) {
      console.warn('Failed to save application state:', error)
    }
    console.log('🧹 Asset cache and source tracking cleared due to review data reset')
    
    // Reset current asset if it was reviewed
    if (assetId.value.trim() && reviewedAssets.value[assetId.value.trim()]) {
      referenceDecision.value = ''
      selectedPredictedIds.value = []
      rejectedPredictedIds.value = (predicted.value || []).map(p => String(p.id))
    }
    
    // Reload current page to update asset ID pills
    loadPage(page.value)
    
    alert('💥 BOOM! All review data has been obliterated. You monster! 😱')
  } else {
    console.log('Nuclear option cancelled - user chickened out')
    alert('😌 Wise choice! Your precious data lives to see another day. Use the individual "Clear Review" buttons instead!')
  }
}

function clearAllApplicationData() {
  const warningMessage = `🚨 ULTIMATE NUCLEAR OPTION ACTIVATED! 🚨

Are you absolutely, positively, 100% certain you want to delete ALL application data?

⚠️  WARNING: This will erase:
• All your review work (${Object.keys(reviewedAssets.value).length} items)
• All your settings (dark mode, offline mode, etc.)
• All your navigation state (current page, filters, etc.)
• All your cache data
• Everything else

💡 RECOMMENDATION: 
Use "Clear All Reviews" instead if you only want to reset review data.

🔥 ONLY proceed if:
• You want to completely start fresh
• You're experiencing severe issues
• You're absolutely sure you want to lose everything

Type "RESET EVERYTHING" to confirm this irreversible action:`
  
  const userInput = prompt(warningMessage)
  
  if (userInput === 'RESET EVERYTHING') {
    // Clear all localStorage data
    localStorage.clear()
    
    // Reset all reactive variables to defaults
    assetId.value = ''
    page.value = 1
    pageSize.value = 20
    assetFilter.value = 'all'
    activeTab.value = 'review'
    exportPreviewPage.value = 1
    exportPreviewPageSize.value = 10
    exportFilter.value = 'all'
    referenceDecision.value = ''
    selectedPredictedIds.value = []
    rejectedPredictedIds.value = []
    darkMode.value = false
    offlineMode.value = false
    localImagePath.value = ''
    reviewedAssets.value = {}
    
    // Clear caches
    clearAllCaches()
    assetCache.value.clear()
    imageActualSources.value = {}
    prefetchedAssets.value.clear()
    
    console.log('All application data cleared and reset to defaults')
    alert('💥 BOOM! All application data has been obliterated. Fresh start! 🚀')
  } else {
    console.log('Ultimate nuclear option cancelled - user chickened out')
    alert('😌 Wise choice! Your data lives to see another day!')
  }
}

function getReviewStats() {
  const total = Object.keys(reviewedAssets.value).length
  const accepted = Object.values(reviewedAssets.value).filter(r => r.status === 'accepted').length
  const rejected = Object.values(reviewedAssets.value).filter(r => r.status === 'rejected').length
  const totalTargetIds = Object.values(reviewedAssets.value).reduce((total, review) => total + review.predictedIds.length, 0)
  
  return { total, accepted, rejected, totalTargetIds }
}

function getCacheStats() {
  const totalRequests = cacheHits.value + cacheMisses.value
  const hitRate = totalRequests > 0 ? Math.round((cacheHits.value / totalRequests) * 100) : 0
  
  // Estimate cache size (rough calculation)
  const assetCacheSize = assetCache.value.size * 0.1 // ~100KB per asset
  const imageCacheSize = imageUrlCache.value.size * 0.01 // ~10KB per image URL
  const totalSize = Math.round((assetCacheSize + imageCacheSize) * 100) / 100
  
  return { hitRate, totalSize }
}

// Function to handle asset ID clicks with error handling
function handleAssetIdClick(id) {
  try {
    console.log('Asset ID clicked:', id)
    if (!id) {
      console.warn('Invalid asset ID:', id)
      return
    }
    
    // Set the asset ID
    assetId.value = id
    
    // Call handleSearch with error handling
    handleSearch()
    
    // Auto-scroll to reference image after a delay to ensure DOM is updated
    setTimeout(() => {
      scrollToReferenceImage()
    }, 500)
  } catch (error) {
    console.error('Error handling asset ID click:', error)
    error.value = 'Failed to load asset. Please try again.'
  }
}

function clearAllCaches() {
  assetCache.value.clear()
  imageUrlCache.value.clear()
  prefetchedAssets.value.clear()
  imageActualSources.value = {} // Clear source tracking
  cacheHits.value = 0
  cacheMisses.value = 0
  console.log('🧹 All caches and source tracking cleared')
}

// Function to clear cache for a specific asset and force refresh
function clearAssetCache(assetId) {
  assetCache.value.delete(assetId)
  prefetchedAssets.value.delete(assetId)
  console.log(`🧹 Cleared cache for asset: ${assetId}`)
}

// Function to clear all caches and force refresh
function clearAllCachesAndRefresh() {
  clearAllCaches()
  console.log('🧹 All caches cleared, forcing refresh...')
  // Force a refresh of the current asset if one is loaded
  if (assetId.value.trim()) {
    console.log(`🔄 Refreshing current asset: ${assetId.value}`)
    handleSearch()
  }
}

// Function to clear cache for specific assets that are known to have stale data
function clearStaleCache() {
  const staleAssets = ['3882', '9487', '9488', '9490']
  staleAssets.forEach(assetId => {
    clearAssetCache(assetId)
  })
  console.log('🧹 Cleared cache for potentially stale assets:', staleAssets)
  
  // Force refresh if we're currently on one of these assets
  if (assetId.value.trim() && staleAssets.includes(assetId.value.trim())) {
    console.log(`🔄 Refreshing current stale asset: ${assetId.value}`)
    handleSearch()
  }
}

// Function to force clear cache for any asset and refresh
function forceRefreshAsset(assetId) {
  console.log(`🔄 Force refreshing asset: ${assetId}`)
  clearAssetCache(assetId)
  
  // If this is the current asset, refresh it
  if (assetId.value.trim() === assetId) {
    console.log(`🔄 Refreshing current asset: ${assetId}`)
    handleSearch()
  }
}

// Function to clear all cache and force fresh API calls for all assets
function clearAllCacheAndRefresh() {
  console.log('🧹 Clearing ALL cache data')
  clearAllCaches()
  
  // Force refresh current asset if one is loaded
  if (assetId.value.trim()) {
    console.log(`🔄 Refreshing current asset: ${assetId.value}`)
    handleSearch()
  }
  
  console.log('✅ All cache cleared - next navigation will use fresh API calls')
}

// Function to refresh the asset list (useful after import)
async function refreshAssetList() {
  console.log('🔄 Refreshing asset list...')
  
  // Clear all caches
  clearAllCaches()
  
  // Reset current asset
  assetId.value = ''
  referenceFileId.value = ''
  predicted.value = []
  referenceDecision.value = ''
  selectedPredictedIds.value = []
  rejectedPredictedIds.value = []
  
  // Reset page data
  page.value = 1
  ids.value = []
  totalAssets.value = 0
  pageCount.value = 0
  
  // Reload page 1
  await loadPage(1)
  
  console.log('✅ Asset list refreshed successfully')
}

// Debug function to check what's in the database for an asset
async function debugAsset(assetId) {
  try {
    console.log(`🔍 Debugging asset: ${assetId}`)
    const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`)
    const data = await response.json()
    console.log(`🔍 Database data for ${assetId}:`, data)
    return data
  } catch (error) {
    console.error(`❌ Error debugging asset ${assetId}:`, error)
    return null
  }
}

// Function to clear only image URL cache
function clearImageUrlCache() {
  imageUrlCache.value.clear()
  console.log('🧹 Image URL cache cleared')
}

// Pre-fetching functions
async function prefetchAsset(assetId) {
  if (!assetId || prefetchedAssets.value.has(assetId)) {
    return // Already pre-fetched or invalid
  }
  
  try {
    console.log(`🚀 Pre-fetching asset: ${assetId}`)
    
    // In offline mode, use fast endpoint to avoid Google API calls
    // In online mode, use regular endpoint for full data including file IDs
    const baseEndpoint = offlineMode.value ? 
      `/api/assets-fast/${encodeURIComponent(assetId)}` : 
      `/api/assets/${encodeURIComponent(assetId)}`
    
    // Add offline parameter if in offline mode
    const offlineParam = offlineMode.value ? '?offline=true' : ''
    const endpoint = baseEndpoint + offlineParam
    
    const response = await fetch(endpoint)
    if (response.ok) {
      const data = await response.json()
      setCachedAsset(assetId, data)
      prefetchedAssets.value.add(assetId)
      console.log(`✅ Pre-fetched asset: ${assetId} (${offlineMode.value ? 'offline' : 'online'} mode)`)
      
      // Only pre-load reference image in online mode, skip in offline mode
      if (!offlineMode.value && data.reference?.fileId) {
        try {
          const referenceAssetId = data.reference.assetId || assetId
          const referenceUrl = getImageUrl(data.reference.fileId, referenceAssetId)
          const img = new Image()
          img.onload = () => {
            console.log(`🖼️ Pre-fetched reference image for asset: ${assetId}`)
          }
          img.onerror = () => {
            console.log(`❌ Failed to pre-fetch reference image for asset: ${assetId}`)
          }
          img.src = referenceUrl
        } catch (error) {
          console.warn(`⚠️ Failed to pre-fetch reference image for asset ${assetId}:`, error)
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ Failed to pre-fetch asset ${assetId}:`, error)
  }
}

async function prefetchAssetImages(assetData) {
  if (!assetData) return
  
  const imagesToPreload = []
  
  // Add reference image
  if (assetData.reference?.fileId) {
    console.log(`DEBUG: Prefetching reference image. assetData.reference.fileId: ${assetData.reference.fileId}, assetData.reference.assetId: ${assetData.reference.assetId}`);
    // Ensure we have a valid assetId for reference image
    const referenceAssetId = assetData.reference.assetId
    if (!referenceAssetId) {
      console.warn(`⚠️ No assetId found for reference image with fileId: ${assetData.reference.fileId}, skipping pre-fetch`)
      return
    }
    const referenceUrl = getImageUrl(assetData.reference.fileId, referenceAssetId)
    imagesToPreload.push({
      url: referenceUrl,
      fileId: assetData.reference.fileId,
      type: 'reference'
    })
  }
  
  // Add predicted images
  if (Array.isArray(assetData.predicted)) {
    assetData.predicted.forEach(pred => {
      if (pred.fileId) {
        console.log(`DEBUG: Prefetching predicted image. pred.fileId: ${pred.fileId}, pred.id: ${pred.id}`);
        // Ensure we have a valid assetId for predicted images
        // pred.id should be the assetId for the predicted image
        const predictedAssetId = pred.id || pred.assetId
        if (!predictedAssetId) {
          console.warn(`⚠️ No assetId found for predicted image with fileId: ${pred.fileId}, skipping pre-fetch`)
          return
        }
        const predictedUrl = getImageUrl(pred.fileId, predictedAssetId)
        imagesToPreload.push({
          url: predictedUrl,
          fileId: pred.fileId,
          type: 'predicted'
        })
      }
    })
  }
  
  // Pre-load all images and track their sources
  const preloadPromises = imagesToPreload.map(({ url, fileId, type }) => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        // Determine the source based on the URL that successfully loaded
        let actualSource = 'api' // default
        if (url.includes('/api/local-images/')) {
          actualSource = 'local'
        } else if (url.includes('/api/images/')) {
          actualSource = 'api'
        }
        
        // Update the image source tracking
        updateImageSource(fileId, actualSource)
        console.log(`🖼️ Pre-fetch: Set source to ${actualSource} for ${type} fileId: ${fileId}`)
        
        resolve()
      }
      img.onerror = () => {
        console.log(`❌ Pre-fetch: Image failed to load for ${type} fileId: ${fileId}, URL: ${url}`)
        // If this was a local image that failed, try the API fallback during pre-fetch
        if (url.includes('/api/local-images/')) {
          console.log(`🔄 Pre-fetch: Trying API fallback for ${type} fileId: ${fileId}`)
          const apiUrl = `/api/images/${fileId}`
          const fallbackImg = new Image()
          fallbackImg.onload = () => {
            updateImageSource(fileId, 'api')
            console.log(`🖼️ Pre-fetch: Fallback successful, set source to api for ${type} fileId: ${fileId}`)
            resolve()
          }
          fallbackImg.onerror = () => {
            console.log(`❌ Pre-fetch: Fallback also failed for ${type} fileId: ${fileId}`)
            resolve()
          }
          fallbackImg.src = apiUrl
        } else {
          resolve()
        }
      }
      img.src = url
    })
  })
  
  await Promise.allSettled(preloadPromises)
  console.log(`DEBUG: Finished pre-loading ${imagesToPreload.length} images for asset data.`)
  console.log(`🖼️ Pre-loaded ${imagesToPreload.length} images`)
}

async function prefetchNextAssets() {
  if (!prefetchEnabled.value || isPrefetching.value || !assetId.value.trim() || ids.value.length === 0) {
    return
  }
  
  isPrefetching.value = true
  prefetchProgress.value = 0
  
  try {
    const currentIndex = ids.value.findIndex(id => id === assetId.value.trim())
    if (currentIndex === -1) return
    
    const assetsToPrefetch = []
    
    // Only prefetch next asset (reduced from multiple to prevent overwhelming)
    const nextIndex = currentIndex + 1
    if (nextIndex < ids.value.length) {
      const nextAssetId = ids.value[nextIndex]
      if (!prefetchedAssets.value.has(nextAssetId)) {
        assetsToPrefetch.push(nextAssetId)
      }
    }
    
    // Only prefetch previous asset if it exists
    const prevIndex = currentIndex - 1
    if (prevIndex >= 0) {
      const prevAssetId = ids.value[prevIndex]
      if (!prefetchedAssets.value.has(prevAssetId)) {
        assetsToPrefetch.push(prevAssetId)
      }
    }
    
    if (assetsToPrefetch.length === 0) {
      console.log('🚀 No new assets to prefetch')
      return
    }
    
    console.log(`🚀 Starting pre-fetch for ${assetsToPrefetch.length} assets`)
    
    // Pre-fetch assets with progress tracking and timeout
    for (let i = 0; i < assetsToPrefetch.length; i++) {
      try {
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Prefetch timeout')), 10000)
        )
        
        await Promise.race([
          prefetchAsset(assetsToPrefetch[i]),
          timeoutPromise
        ])
        
        prefetchProgress.value = ((i + 1) / assetsToPrefetch.length) * 100
      } catch (error) {
        console.warn(`⚠️ Failed to prefetch asset ${assetsToPrefetch[i]}:`, error)
        // If prefetching fails too much, disable it
        if (error.message === 'Prefetch timeout') {
          console.warn('⚠️ Prefetching timed out, disabling prefetching to prevent issues')
          prefetchEnabled.value = false
          break
        }
      }
    }
    
    console.log(`🚀 Pre-fetching completed for ${assetsToPrefetch.length} assets`)
  } catch (error) {
    console.error('❌ Error during pre-fetching:', error)
  } finally {
    isPrefetching.value = false
    prefetchProgress.value = 0
  }
}

function schedulePrefetch() {
  // Schedule pre-fetching after a short delay to avoid blocking the UI
  setTimeout(() => {
    prefetchNextAssets()
  }, 100)
}

function toggleOfflineMode() {
  // Detect if running on Vercel (production)
  const isVercel = window.location.hostname.includes('vercel.app') || 
                   window.location.hostname.includes('vercel.com') ||
                   window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  
  // Prevent enabling offline mode on Vercel
  if (isVercel && !offlineMode.value) {
    console.log('🌐 Vercel detected - cannot enable offline mode (local files not available)')
    alert('Offline mode is not available on Vercel deployment. Local image files are not accessible.')
    return
  }
  
  console.log(`🔍 Toggling offline mode from ${offlineMode.value} to ${!offlineMode.value}`)
  offlineMode.value = !offlineMode.value
  saveOfflineSettings()
  
  // Clear image cache when offline mode changes since URLs will be different
  imageUrlCache.value.clear()
  prefetchedAssets.value.clear()
  imageActualSources.value = {} // Clear source tracking since URLs will change
  console.log('🧹 Image cache and source tracking cleared due to offline mode change')
  
  console.log(`🔍 After toggle - offlineMode: ${offlineMode.value}, localImagePath: ${localImagePath.value}`)
}

function saveOfflineSettings() {
  // Detect if running on Vercel (production)
  const isVercel = window.location.hostname.includes('vercel.app') || 
                   window.location.hostname.includes('vercel.com') ||
                   window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  
  // Don't save offline mode on Vercel - force online mode
  if (isVercel) {
    console.log('🌐 Vercel detected - preventing offline mode save')
    localStorage.setItem('offlineMode', 'false')
    localStorage.setItem('localImagePath', '')
  } else {
    localStorage.setItem('offlineMode', JSON.stringify(offlineMode.value))
    localStorage.setItem('localImagePath', localImagePath.value)
  }
  
  try {
    saveApplicationState()
  } catch (error) {
    console.warn('Failed to save application state:', error)
  }
  
  // Clear image cache when local path changes since URLs will be different
  imageUrlCache.value.clear()
  prefetchedAssets.value.clear()
  imageActualSources.value = {} // Clear source tracking since URLs will change
  console.log('🧹 Image cache and source tracking cleared due to local path change')
}

function loadOfflineSettings() {
  // Detect if running on Vercel (production)
  const isVercel = window.location.hostname.includes('vercel.app') || 
                   window.location.hostname.includes('vercel.com') ||
                   window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  
  console.log(`🔍 Environment detection - hostname: ${window.location.hostname}, isVercel: ${isVercel}`)
  
  const savedOfflineMode = localStorage.getItem('offlineMode')
  const savedLocalPath = localStorage.getItem('localImagePath')
  
  console.log(`🔍 Loading offline settings from localStorage:`)
  console.log(`🔍 savedOfflineMode: ${savedOfflineMode}`)
  console.log(`🔍 savedLocalPath: ${savedLocalPath}`)
  
  if (savedLocalPath !== null) {
    localImagePath.value = savedLocalPath
    console.log(`🔍 Set localImagePath.value to: ${localImagePath.value}`)
  } else {
    // Try to auto-detect common local image paths
    const commonPaths = [
      'D:\\LocalMediabankImages\\ALL_IMAGES',
      'C:\\LocalMediabankImages\\ALL_IMAGES',
      '/mnt/c/LocalMediabankImages/ALL_IMAGES',
      './images',
      './assets/images'
    ]
    
    // For now, set a default path if none is saved
    if (!localImagePath.value) {
      localImagePath.value = 'D:\\LocalMediabankImages\\ALL_IMAGES'
      console.log(`🔍 Set default localImagePath.value to: ${localImagePath.value}`)
      localStorage.setItem('localImagePath', localImagePath.value)
    }
  }
  
  // Load offline mode setting from localStorage
  if (savedOfflineMode !== null) {
    offlineMode.value = JSON.parse(savedOfflineMode)
    console.log(`🔍 Set offlineMode.value to: ${offlineMode.value} (from localStorage)`)
  }
  
  // Force online mode on Vercel (production) since local files don't exist there
  if (isVercel) {
    console.log('🌐 Vercel detected - forcing online mode for Google Drive API')
    offlineMode.value = false
    localStorage.setItem('offlineMode', 'false')
    // Clear local image path on Vercel since it's not available
    localImagePath.value = ''
    localStorage.setItem('localImagePath', '')
  }
  
  console.log(`🔍 Final state - offlineMode: ${offlineMode.value}, localImagePath: ${localImagePath.value}`)
}

function getImageUrl(fileId, assetId = null) {
  if (!fileId) {
    console.warn('getImageUrl called with null/undefined fileId')
    return ''
  }
  
  // Check cache first - this should prevent most repeated calls
  const cachedUrl = getCachedImageUrl(fileId)
  if (cachedUrl) {
    return cachedUrl
  }
  
  let url
  if (offlineMode.value && localImagePath.value) {
    // For offline mode, always prioritize local file system
    const filename = assetId || fileId
    
    // Validate that we have a proper assetId for local file lookup
    if (!assetId) {
      console.warn(`⚠️ No assetId provided for local file lookup, using placeholder for fileId: ${fileId}`)
      // Return a placeholder URL that will trigger error handling
      url = `/api/images/${fileId}?offline=true`
    } else {
      url = `/api/local-images/${encodeURIComponent(filename)}?path=${encodeURIComponent(localImagePath.value)}`
    }
  } else {
    // Online mode - use Google Drive API
    url = `/api/images/${fileId}`
  }
  
  // Cache the URL
  setCachedImageUrl(fileId, url)
  return url
}



// Environment detection
const isVercel = computed(() => {
  return window.location.hostname.includes('vercel.app') || 
         window.location.hostname.includes('vercel.com') ||
         window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
})

// Computed properties for reactive image sources
const referenceImageSource = computed(() => {
  const fileId = referenceFileId.value
  if (!fileId) {
    // In offline mode with local path, use assetId as key
    if (offlineMode.value && localImagePath.value) {
      return imageActualSources.value[assetId.value] || 'api'
    }
    return 'api'
  }
  
  return imageActualSources.value[fileId] || 'api'
})

const predictedImageSources = computed(() => {
  return predicted.value.map(p => ({
    fileId: p.fileId,
    source: imageActualSources.value[p.fileId || p.id] || 'api'
  }))
})

const previewImageSource = computed(() => {
  if (!previewImage.value) return 'api'
  const fileId = previewImage.value.fileId
  if (!fileId) {
    // In offline mode with local path, use assetId as key
    if (offlineMode.value && localImagePath.value) {
      return imageActualSources.value[previewImage.value.id] || 'api'
    }
    return 'api'
  }
  return imageActualSources.value[fileId] || 'api'
})

// Computed properties for image URLs to prevent infinite loops
const referenceImageUrl = computed(() => {
  console.log(`🔍 referenceImageUrl computed - referenceFileId: "${referenceFileId.value}", offlineMode: ${offlineMode.value}, localImagePath: "${localImagePath.value}"`)
  
  // In offline mode, we can still show local images even if fileId is null
  if (offlineMode.value && localImagePath.value) {
    // For local images, use the current assetId (not the fileId)
    const filename = assetId.value
    const url = `/api/local-images/${encodeURIComponent(filename)}?path=${encodeURIComponent(localImagePath.value)}`
    console.log(`🔍 Generated LOCAL URL for offline mode: ${url}`)
    return url
  }
  
  // Check if referenceFileId is empty, null, or undefined (only for online mode)
  if (!referenceFileId.value || referenceFileId.value === null || referenceFileId.value === 'null' || referenceFileId.value === 'undefined') {
    console.log(`🔍 No valid referenceFileId for online mode, returning empty string`)
    return ''
  }
  
  const cacheKey = `${referenceFileId.value}_${offlineMode.value ? 'offline' : 'online'}_${localImagePath.value || 'none'}`
  console.log(`🔍 Cache key: "${cacheKey}"`)
  
  const cached = imageUrlCache.value.get(cacheKey)
  if (cached) {
    console.log(`🖼️ Cache HIT for image: ${referenceFileId.value} (key: ${cacheKey})`)
    return cached.url
  }
  
  // Generate URL without calling getImageUrl to prevent infinite loop
  const url = `/api/images/${referenceFileId.value}`
  console.log(`🔍 Generated API URL: ${url}`)
  
  // Cache the URL
  imageUrlCache.value.set(cacheKey, {
    url: url,
    timestamp: Date.now()
  })
  console.log(`🖼️ Cache MISS for image: ${referenceFileId.value} (key: ${cacheKey}) - Generated: ${url}`)
  return url
})

// Filter out reference image from predicted images
const filteredPredicted = computed(() => {
  return predicted.value.filter(p => p.id !== assetId.value)
})

const predictedImageUrls = computed(() => {
  return filteredPredicted.value.map(p => {
    // In offline mode, if fileId is null but we have localImagePath, generate local URL using assetId
    if (!p.fileId && offlineMode.value && localImagePath.value) {
      const cacheKey = `${p.id}_local_${localImagePath.value}`
      const cached = imageUrlCache.value.get(cacheKey)
      if (cached) {
        console.log(`🖼️ Cache HIT for local image: ${p.id} (key: ${cacheKey})`)
        return { id: p.id, fileId: p.fileId, url: cached.url }
      }
      
      const url = `/api/local-images/${encodeURIComponent(p.id)}?path=${encodeURIComponent(localImagePath.value)}`
      
      // Cache the URL
      imageUrlCache.value.set(cacheKey, {
        url: url,
        timestamp: Date.now()
      })
      console.log(`🖼️ Cache MISS for local image: ${p.id} (key: ${cacheKey}) - Generated: ${url}`)
      return { id: p.id, fileId: p.fileId, url }
    }
    
    // If no fileId and not in offline mode with local path, handle Vercel case
    if (!p.fileId) {
      // On Vercel, we need to try to get the fileId dynamically via error handling
      if (isVercel.value) {
        // Return a placeholder URL that will trigger error handling to fetch the real fileId
        return { id: p.id, fileId: p.fileId, url: `/api/images/placeholder-${p.id}` }
      }
      return { id: p.id, fileId: p.fileId, url: '' }
    }
    
    const cacheKey = `${p.fileId}_${offlineMode.value ? 'offline' : 'online'}_${localImagePath.value || 'none'}`
    const cached = imageUrlCache.value.get(cacheKey)
    if (cached) {
      console.log(`🖼️ Cache HIT for image: ${p.fileId} (key: ${cacheKey})`)
      return { id: p.id, fileId: p.fileId, url: cached.url }
    }
    
    // Generate URL without calling getImageUrl to prevent infinite loop
    let url = ''
    if (offlineMode.value && localImagePath.value) {
      // For local images, use the assetId (p.id) instead of fileId
      url = `/api/local-images/${encodeURIComponent(p.id)}?path=${encodeURIComponent(localImagePath.value)}`
    } else {
      // Add offline mode parameter to avoid unnecessary Google API calls
      const offlineParam = offlineMode.value ? '?offline=true' : ''
      url = `/api/images/${p.fileId}${offlineParam}`
    }
    
    // Cache the URL
    imageUrlCache.value.set(cacheKey, {
      url: url,
      timestamp: Date.now()
    })
    console.log(`🖼️ Cache MISS for image: ${p.fileId} (key: ${cacheKey}) - Generated: ${url}`)
    return { id: p.id, fileId: p.fileId, url }
  })
})

const previewImageUrl = computed(() => {
  if (!previewImage.value?.fileId) return ''
  const cacheKey = `${previewImage.value.fileId}_${offlineMode.value ? 'offline' : 'online'}_${localImagePath.value || 'none'}`
  const cached = imageUrlCache.value.get(cacheKey)
  if (cached) {
    console.log(`🖼️ Cache HIT for image: ${previewImage.value.fileId} (key: ${cacheKey})`)
    return cached.url
  }
  
  // Generate URL without calling getImageUrl to prevent infinite loop
  let url = ''
  if (offlineMode.value && localImagePath.value) {
    // For local images, use the assetId (previewImage.value.id) instead of fileId
    url = `/api/local-images/${encodeURIComponent(previewImage.value.id)}?path=${encodeURIComponent(localImagePath.value)}`
  } else {
    // Add offline mode parameter to avoid unnecessary Google API calls
    const offlineParam = offlineMode.value ? '?offline=true' : ''
    url = `/api/images/${previewImage.value.fileId}${offlineParam}`
  }
  
  // Cache the URL
  imageUrlCache.value.set(cacheKey, {
    url: url,
    timestamp: Date.now()
  })
  console.log(`🖼️ Cache MISS for image: ${previewImage.value.fileId} (key: ${cacheKey}) - Generated: ${url}`)
  return url
})

function handleImageLoad(event, fileId, assetId = null) {
  // Image loaded successfully from the current source
  console.log(`✅ Image loaded successfully for file ${fileId}`)
  console.log(`✅ Image src: ${event.target.src}`)
  console.log(`✅ assetId: ${assetId}`)
  console.log(`✅ offlineMode: ${offlineMode.value}`)
  console.log(`✅ localImagePath: ${localImagePath.value}`)
  
  // Determine the actual source based on the URL that successfully loaded
  let actualSource = 'api' // default
  if (event.target.src.includes('/api/local-images/')) {
    actualSource = 'local'
    console.log(`✅ Detected LOCAL source from URL`)
  } else if (event.target.src.includes('/api/images/')) {
    actualSource = 'api'
    console.log(`✅ Detected API source from URL`)
  } else {
    console.log(`⚠️ Unknown URL pattern: ${event.target.src}`)
  }
  
  // Update the actual source - use assetId as key if fileId is null (for offline mode)
  const sourceKey = fileId || assetId
  if (sourceKey) {
    updateImageSource(sourceKey, actualSource)
    console.log(`✅ Set actual source to: ${actualSource} for key: ${sourceKey}`)
    console.log(`✅ Current imageActualSources[${sourceKey}]: ${imageActualSources.value[sourceKey]}`)
  } else {
    console.log(`⚠️ No key available for updating image source`)
  }
}

async function handleImageError(event, fileId, assetId = null) {
  console.log(`❌ Image error for file ${fileId}`)
  console.log(`❌ Current src that failed: ${event.target.src}`)
  console.log(`❌ assetId: ${assetId}`)
  console.log(`❌ offlineMode: ${offlineMode.value}, localImagePath: ${localImagePath.value}`)
  console.log(`❌ isVercel: ${isVercel.value}`)
  
  // Special handling for Vercel deployment
  if (isVercel.value && !fileId && assetId) {
    console.log(`🌐 Vercel detected - attempting to retrieve fileId for asset ${assetId}`)
    try {
      const response = await fetch(`/api/file-id/${assetId}`)
      const data = await response.json()
      if (data.success && data.fileId) {
        console.log(`✅ Retrieved fileId ${data.fileId} for asset ${assetId} on Vercel`)
        // Update source tracking
        updateImageSource(data.fileId, 'api')
        event.target.src = `/api/images/${data.fileId}`
        return
      } else {
        console.log(`❌ Failed to retrieve fileId for asset ${assetId} on Vercel`)
      }
    } catch (error) {
      console.error(`❌ Error retrieving fileId for asset ${assetId} on Vercel:`, error)
    }
  }
  
  // In offline mode, check local file system first, then fall back to Google Drive if not found
  if (offlineMode.value && localImagePath.value) {
    if (event.target.src.includes('/api/local-images/')) {
      // Local image failed in offline mode - now fall back to Google Drive
      console.log(`🔄 Local image failed for file ${fileId} in offline mode, falling back to Google Drive`)
      
      // If fileId is null, try to retrieve it from Google Drive
      let actualFileId = fileId
      if (!actualFileId && assetId) {
        try {
          console.log(`🔍 Retrieving fileId for asset ${assetId} from Google Drive`)
          const response = await fetch(`/api/file-id/${assetId}`)
          const data = await response.json()
          if (data.success && data.fileId) {
            actualFileId = data.fileId
            console.log(`✅ Retrieved fileId ${actualFileId} for asset ${assetId}`)
          } else {
            console.log(`❌ Failed to retrieve fileId for asset ${assetId}`)
          }
        } catch (error) {
          console.error(`❌ Error retrieving fileId for asset ${assetId}:`, error)
        }
      }
      
      if (actualFileId) {
        // Update source tracking to indicate we're trying Google Drive
        const sourceKey = actualFileId || assetId
        if (sourceKey) {
          updateImageSource(sourceKey, 'api')
        }
        event.target.src = `/api/images/${actualFileId}`
        console.log(`🔄 Set new src to Google Drive: /api/images/${actualFileId}`)
      } else {
        console.log(`❌ No fileId available for Google Drive fallback`)
      }
    } else if (event.target.src.includes('/api/images/')) {
      // Google API failed in offline mode - try local file system as fallback
      console.log(`🔄 Google API failed for file ${fileId} in offline mode, trying local file system`)
      if (assetId) {
        // Update source tracking to indicate we're trying local
        const sourceKey = fileId || assetId
        if (sourceKey) {
          updateImageSource(sourceKey, 'local')
        }
        event.target.src = `/api/local-images/${encodeURIComponent(assetId)}?path=${encodeURIComponent(localImagePath.value)}`
        console.log(`🔄 Set new src to local: /api/local-images/${assetId}`)
      } else {
        console.log(`❌ No assetId available for local fallback`)
      }
    }
  } else {
    // Not in offline mode - check local files first, then fall back to Google API
    if (event.target.src.includes('/api/local-images/')) {
      // Local image failed, try Google Drive as fallback
      console.log(`🔄 Local image failed for file ${fileId}, falling back to Google Drive`)
      
      // If fileId is null, try to retrieve it from Google Drive
      let actualFileId = fileId
      if (!actualFileId && assetId) {
        try {
          console.log(`🔍 Retrieving fileId for asset ${assetId} from Google Drive`)
          const response = await fetch(`/api/file-id/${assetId}`)
          const data = await response.json()
          if (data.success && data.fileId) {
            actualFileId = data.fileId
            console.log(`✅ Retrieved fileId ${actualFileId} for asset ${assetId}`)
          } else {
            console.log(`❌ Failed to retrieve fileId for asset ${assetId}`)
          }
        } catch (error) {
          console.error(`❌ Error retrieving fileId for asset ${assetId}:`, error)
        }
      }
      
      if (actualFileId) {
        // Update source tracking to indicate we're trying Google Drive
        const sourceKey = actualFileId || assetId
        if (sourceKey) {
          updateImageSource(sourceKey, 'api')
        }
        event.target.src = `/api/images/${actualFileId}`
        console.log(`🔄 Set new src: /api/images/${actualFileId}`)
      } else {
        console.log(`❌ No fileId available for Google Drive fallback`)
      }
    } else if (event.target.src.includes('/api/images/') && assetId && localImagePath.value) {
      // Google Drive failed, try local file system as fallback
      console.log(`🔄 Google Drive failed for file ${fileId}, trying local file system`)
      // Update source tracking to indicate we're trying local
      const sourceKey = fileId || assetId
      if (sourceKey) {
        updateImageSource(sourceKey, 'local')
      }
      event.target.src = `/api/local-images/${encodeURIComponent(assetId)}?path=${encodeURIComponent(localImagePath.value)}`
      console.log(`🔄 Set new src to local: /api/local-images/${assetId}`)
    } else {
      console.log(`❌ No fallback available for file ${fileId}`)
    }
  }
}

// Import methods
function triggerFileInput() {
  document.querySelector('input[type="file"]').click()
}

function handleFileSelect(event) {
  const file = event.target.files[0]
  if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
    selectedFile.value = file
  } else {
    alert('Please select a valid CSV file')
  }
}

function handleDrop(event) {
  event.preventDefault()
  isDragOver.value = false
  
  const files = event.dataTransfer.files
  if (files.length > 0) {
    const file = files[0]
    if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      selectedFile.value = file
    } else {
      alert('Please drop a valid CSV file')
    }
  }
}

function handleDragOver(event) {
  event.preventDefault()
  isDragOver.value = true
}

function handleDragLeave(event) {
  event.preventDefault()
  isDragOver.value = false
}

function removeFile() {
  selectedFile.value = null
  importResult.value = null
  document.querySelector('input[type="file"]').value = ''
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function startImport() {
  if (!selectedFile.value) return
  
  importing.value = true
  importProgress.value = 0
  progressMessage.value = 'Reading CSV file...'
  importResult.value = null
  
  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    formData.append('options', JSON.stringify(importOptions.value))
    
    const response = await fetch('/api/import-csv', {
      method: 'POST',
      body: formData
    })
    
    if (!response.ok) {
      throw new Error(`Import failed: ${response.statusText}`)
    }
    
    const result = await response.json()
    
    // Check if this is a chunked import (large file)
    if (result.jobId) {
      console.log('🔄 Large file detected, using chunked processing')
      console.log('🔄 Job ID received:', result.jobId)
      importResult.value = {
        jobId: result.jobId,
        totalRecords: result.totalRecords,
        status: 'processing',
        message: 'Import started in background. Monitoring progress...',
        imported: 0,
        skipped: 0,
        errors: 0,
        errorDetails: []
      }
      
      // Set initial progress message
      progressMessage.value = 'Starting background import...'
      importProgress.value = 0
      
      // Force a UI update
      await nextTick()
      
      console.log('🔄 Starting progress monitoring for job:', result.jobId)
      // Start monitoring the import progress
      await monitorImportProgress(result.jobId)
    } else {
      // Small file - immediate processing
      console.log('✅ Small file processed immediately')
      importResult.value = result
      importProgress.value = 100
      progressMessage.value = 'Import completed!'
      
      // Refresh database status after import
      await refreshDbStatus()
      
      // If import was successful, refresh the asset review
      if (result.imported > 0) {
        console.log('🔄 Import successful, refreshing asset review tab...')
        await refreshAssetReviewAfterImport()
      }
    }
    
  } catch (error) {
    console.error('Import error:', error)
    progressMessage.value = `Import failed: ${error.message}`
    importResult.value = {
      totalRecords: 0,
      imported: 0,
      skipped: 0,
      errors: 1,
      errorDetails: [{ line: 0, message: error.message }]
    }
    importing.value = false
  }
}

async function monitorImportProgress(jobId) {
  console.log(`🔄 Monitoring import progress for job: ${jobId}`)
  
  const maxAttempts = 600 // 10 minutes with variable intervals
  let attempts = 0
  let lastProgress = 0
  
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`/api/import-status/${jobId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to check progress: ${response.statusText}`)
      }
      
      const jobStatus = await response.json()
      
      // Update progress display with forced UI refresh
      if (jobStatus.progress !== undefined && jobStatus.progress !== null) {
        const oldProgress = importProgress.value
        importProgress.value = jobStatus.progress
        progressMessage.value = `Processing... ${jobStatus.progress}% (${jobStatus.processed || 0}/${jobStatus.totalRecords || 0} records)`
        lastProgress = jobStatus.progress
        
        // Force a UI update by triggering Vue's reactivity
        await nextTick()
      } else {
        // If no progress but job is pending, show a different message
        if (jobStatus.status === 'pending') {
          progressMessage.value = 'Starting import process...'
          await nextTick()
        }
      }
      
      // Check if job is completed
      if (jobStatus.status === 'completed') {
        console.log('✅ Import completed successfully')
        importResult.value = {
          totalRecords: jobStatus.totalRecords,
          imported: jobStatus.imported,
          skipped: jobStatus.skipped,
          errors: jobStatus.errors,
          errorDetails: jobStatus.errorDetails || [],
          status: 'completed'
        }
        importProgress.value = 100
        progressMessage.value = 'Import completed!'
        
        // Refresh database status and asset review
        await refreshDbStatus()
        if (jobStatus.imported > 0) {
          console.log('🔄 Import successful, refreshing asset review tab...')
          await refreshAssetReviewAfterImport()
        }
        importing.value = false
        return
        
      } else if (jobStatus.status === 'failed') {
        console.error('❌ Import failed:', jobStatus.error)
        importResult.value = {
          totalRecords: jobStatus.totalRecords || 0,
          imported: 0,
          skipped: 0,
          errors: 1,
          errorDetails: [{ line: 0, message: jobStatus.error || 'Import failed' }],
          status: 'failed'
        }
        progressMessage.value = `Import failed: ${jobStatus.error || 'Unknown error'}`
        importing.value = false
        return
        
      } else if (jobStatus.status === 'processing' || jobStatus.status === 'pending') {
        // Continue monitoring
        attempts++
        if (attempts >= maxAttempts) {
          console.warn('⚠️ Import monitoring timeout')
          importResult.value = {
            totalRecords: jobStatus.totalRecords || 0,
            imported: jobStatus.imported || 0,
            skipped: jobStatus.skipped || 0,
            errors: jobStatus.errors || 0,
            errorDetails: jobStatus.errorDetails || [],
            status: 'timeout',
            message: 'Import monitoring timed out. Check status manually.'
          }
          progressMessage.value = 'Import monitoring timed out. Check status manually.'
          importing.value = false
          return
        }
        
        // Polling intervals: 2-second intervals as requested
        let delay = 2000 // Default 2 seconds
        if (lastProgress < 10) {
          delay = 1500 // Poll every 1.5 seconds for first 10%
        } else if (lastProgress < 50) {
          delay = 1800 // Poll every 1.8 seconds for 10-50%
        } else {
          delay = 2000 // Poll every 2 seconds for 50%+
        }
        
        // If status is still pending, poll more frequently
        if (jobStatus.status === 'pending') {
          delay = 1500 // Poll every 1.5 seconds for pending jobs
        }
        
        await new Promise(resolve => setTimeout(resolve, delay))
        
      }
      
    } catch (error) {
      console.error('❌ Error monitoring import progress:', error)
      attempts++
      
      if (attempts >= maxAttempts) {
        importResult.value = {
          totalRecords: 0,
          imported: 0,
          skipped: 0,
          errors: 1,
          errorDetails: [{ line: 0, message: 'Failed to monitor import progress' }],
          status: 'monitoring_failed'
        }
        progressMessage.value = 'Failed to monitor import progress'
        importing.value = false
        return
      }
      
      // Wait 2 seconds before retry
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  // Fallback: ensure importing is set to false if we exit the loop
  importing.value = false
}

async function refreshDbStatus() {
  refreshing.value = true
  try {
    const response = await fetch('/api/db-status')
    if (response.ok) {
      dbStatus.value = await response.json()
    }
  } catch (error) {
    console.error('Failed to get database status:', error)
  } finally {
    refreshing.value = false
  }
}

async function checkApiHealth() {
  checkingApiHealth.value = true
  apiHealthError.value = ''
  
  try {
    const response = await fetch('/api/health')
    if (response.ok) {
      const data = await response.json()
      apiHealthStatus.value = data
      console.log('✅ API health check successful:', data)
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
  } catch (error) {
    console.error('❌ API health check failed:', error)
    apiHealthError.value = error.message || 'Failed to check API health'
  } finally {
    checkingApiHealth.value = false
  }
}

async function refreshAssetReviewAfterImport() {
  console.log('🔄 Refreshing asset review after import...')
  
  try {
    // Clear all caches to ensure fresh data
    assetCache.value.clear()
    prefetchedAssets.value.clear()
    
    // If clearExisting was selected, also clear review states
    if (importOptions.value.clearExisting) {
      console.log('🧹 Clearing review states due to clearExisting option...')
      reviewedAssets.value = {}
      localStorage.removeItem('reviewedAssets')
      console.log('✅ Review states cleared')
    }
    
    // Reset current asset if it exists
    if (assetId.value) {
      assetId.value = ''
      referenceFileId.value = ''
      predicted.value = []
      referenceDecision.value = ''
      selectedPredictedIds.value = []
      rejectedPredictedIds.value = []
    }
    
    // Force refresh by resetting to page 1 and clearing any cached data
    page.value = 1
    ids.value = []
    totalAssets.value = 0
    pageCount.value = 0
    
    // Add a small delay to ensure the database has been updated
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Reload the current page to get updated asset list
    await loadPage(1)
    
    // Show success message
    console.log('✅ Asset review refreshed successfully after import')
    
    // Optionally switch to the review tab to show the new data
    if (activeTab.value === 'import') {
      console.log('🔄 Switching to review tab to show imported data...')
      activeTab.value = 'review'
    }
    
  } catch (error) {
    console.error('❌ Error refreshing asset review after import:', error)
  }
}

// Initialize database status on mount
onMounted(() => {
  refreshDbStatus()
})

// Backup and restore functions
async function exportDatabase() {
  try {
    console.log('Exporting database...')
    const response = await fetch('/api/export-database')
    
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`)
    }
    
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `database-backup-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
    
    console.log('✅ Database exported successfully')
  } catch (error) {
    console.error('❌ Export failed:', error)
    alert(`Export failed: ${error.message}`)
  }
}

function handleBackupFileSelect(event) {
  const file = event.target.files[0]
  if (file && file.type === 'application/json') {
    selectedBackupFile.value = file
    console.log('Selected backup file:', file.name)
  } else {
    alert('Please select a valid JSON backup file')
    event.target.value = ''
  }
}

function handleReviewBackupFileSelect(event) {
  const file = event.target.files[0]
  if (file && file.type === 'application/json') {
    selectedReviewBackupFile.value = file
    console.log('Selected review backup file:', file.name)
  } else {
    alert('Please select a valid JSON backup file')
    event.target.value = ''
  }
}

async function importDatabase() {
  if (!selectedBackupFile.value) {
    alert('Please select a backup file first')
    return
  }
  
  if (!confirm('This will replace all current database data. Are you sure you want to continue?')) {
    return
  }
  
  isImporting.value = true
  backupProgress.value = { show: true, percent: 0, message: 'Preparing import...' }
  
  try {
    const formData = new FormData()
    formData.append('file', selectedBackupFile.value)
    formData.append('options', JSON.stringify({ clearExisting: true }))
    
    const response = await fetch('/api/import-database', {
      method: 'POST',
      body: formData
    })
    
    if (!response.ok) {
      throw new Error(`Import failed: ${response.status}`)
    }
    
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line)
          if (data.type === 'progress') {
            backupProgress.value = {
              show: true,
              percent: data.progress,
              message: data.message
            }
          } else if (data.type === 'result') {
            const result = data.result
            console.log('Import result:', result)
            
            if (result.errors > 0) {
              alert(`Import completed with ${result.errors} errors. Check console for details.`)
            } else {
              alert(`✅ Successfully imported ${result.imported} records!`)
            }
            
            // Refresh the current page to show new data
            loadPage(page.value)
            break
          }
        } catch (parseError) {
          console.warn('Failed to parse progress line:', parseError)
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Import failed:', error)
    alert(`Import failed: ${error.message}`)
  } finally {
    isImporting.value = false
    backupProgress.value = { show: false, percent: 0, message: '' }
    selectedBackupFile.value = null
    if (document.querySelector('input[type="file"]')) {
      document.querySelector('input[type="file"]').value = ''
    }
  }
}

</script>

<template>
  <div class="home" :class="{ 'dark-mode': darkMode }">
         <header class="topbar header">
       <div class="brand">Google Drive Asset Reviewer Tool</div>
       <div class="user">
         <span v-if="auth.username">Hi, {{ auth.username }}</span>
         <button class="primary" @click="auth.logout(); $router.replace('/login')">Logout</button>
       </div>
     </header>
     
     <div class="tabs">
       <button 
         class="tab-button" 
         :class="{ active: activeTab === 'review' }"
         @click="activeTab = 'review'"
       >
         Asset Review
       </button>
               <button 
          class="tab-button" 
          :class="{ active: activeTab === 'export' }"
          @click="activeTab = 'export'"
        >
          Export Data
        </button>
        <button 
          class="tab-button" 
          :class="{ active: activeTab === 'import' }"
          @click="activeTab = 'import'"
        >
          Import Data
        </button>
                 <button 
           class="tab-button" 
           :class="{ active: activeTab === 'settings' }"
           @click="activeTab = 'settings'"
         >
           Settings
         </button>
         <button 
           class="tab-button" 
           :class="{ active: activeTab === 'analytics' }"
           @click="activeTab = 'analytics'"
         >
           Analytics
         </button>
         <button 
           class="tab-button" 
           :class="{ active: activeTab === 'backup' }"
           @click="activeTab = 'backup'"
         >
           Backup & Restore
         </button>
         <button 
           class="tab-button" 
           :class="{ active: activeTab === 'about' }"
           @click="activeTab = 'about'"
         >
           About
         </button>
     </div>

              <main class="content">
               <!-- Review Tab Content -->
                 <div v-if="activeTab === 'review'">
          <div class="search-bar">
            <label for="assetId">Search for Asset by ID</label>
            <div class="controls">
              <input
                id="assetId"
                v-model="assetId"
                type="text"
                placeholder="Type asset ID and press Enter"
                @keyup.enter="handleSearch"
              />
              <button class="primary" @click="handleSearch">Search</button>
            </div>
          </div>

           <div class="id-page" v-if="ids.length">
             <div class="id-pills-section">
               <button 
                 v-for="id in ids" 
                 :key="id" 
                 class="id-pill" 
                 :class="{ 
                   'reviewed-accepted': getAssetReviewStatus(id) === 'accepted',
                   'reviewed-rejected': getAssetReviewStatus(id) === 'rejected'
                 }"
                 @click="handleAssetIdClick(id)"
               >
                 {{ id }}
               </button>
             </div>
           </div>

                     <p v-if="overallTotalAssets > 0 && totalAssets === 0 && !loading" class="warn">No assets match the current filter. Try changing the filter or review some assets first.</p>

                     <div class="pager" v-if="overallTotalAssets > 0 || totalAssets > 0">
             <button :disabled="page===1" @click="goPage(1)">First</button>
             <button :disabled="page===1" @click="goPage(page-1)">Previous</button>
             <span>{{ page }} of {{ pageCount }}</span>
             <button :disabled="page===pageCount || pageCount===0" @click="goPage(page+1)">Next</button>
             <button :disabled="page===pageCount || pageCount===0" @click="goPage(pageCount)">Last</button>
             
             <div class="asset-filter-selector">
               <label for="assetFilter">Filter:</label>
               <select id="assetFilter" v-model="assetFilter" @change="handleAssetFilterChange">
                 <option value="all">All</option>
                 <option value="accepted">Accepted</option>
                 <option value="rejected">Rejected</option>
                 <option value="not-reviewed">Not Yet Reviewed</option>
               </select>
             </div>
             
             <div class="page-size-selector">
               <label for="pageSize">Per Page:</label>
               <select id="pageSize" v-model="pageSize" @change="handlePageSizeChange">
                 <option value="10">10</option>
                 <option value="20">20</option>
                 <option value="50">50</option>
                 <option value="100">100</option>
               </select>
             </div>
             
             <div class="total-count-display">
               <span class="total-label">Total {{ getFilterDisplayName(assetFilter) }}:</span>
               <span class="total-number">{{ totalAssets.toLocaleString() }}</span>
             </div>
           </div>

         <p v-if="showEmptyInfo" class="info">Please enter an asset ID to view images.</p>
         <p v-if="showNoMatches" class="warn">No matching asset IDs found.</p>
         <p v-if="error" class="error">{{ error }}</p>
         <p v-if="loading" class="info">Loading...</p>
         <p v-if="isPrefetching" class="info">🚀 Pre-fetching next assets...</p>

                                                                               <div v-if="!loading && !error && hasAssetBeenFound" class="results">
                                          <div class="grid">
                                            <div class="col ref" ref="referenceImageRef">
                                              <h3>Reference Image</h3>
                                              <div class="reference-container" v-if="(referenceFileId && referenceFileId !== null && referenceFileId !== 'null' && referenceFileId !== 'undefined') || (offlineMode && localImagePath)" :data-debug="`refFileId: ${referenceFileId}, type: ${typeof referenceFileId}, offlineMode: ${offlineMode}, localImagePath: ${localImagePath}`">
                                                <div class="reference-image-wrapper">
                                                  <img :src="referenceImageUrl" alt="reference" @load="handleImageLoad($event, referenceFileId, assetId)" @error="handleImageError($event, referenceFileId, assetId)" />
                                                  <div class="magnifier-icon" @click.stop="showReferenceImagePreview">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                      <circle cx="11" cy="11" r="8"></circle>
                                                      <path d="m21 21-4.35-4.35"></path>
                                                    </svg>
                                                  </div>
                                                  <div class="source-icon" :class="referenceImageSource">
                                                    <svg v-if="referenceImageSource === 'local'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                                                      <polyline points="14,2 14,8 20,8"/>
                                                    </svg>
                                                    <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                                                    </svg>
                                                  </div>
                                                </div>
                                              </div>
                                              <div v-else-if="!((referenceFileId && referenceFileId !== null && referenceFileId !== 'null' && referenceFileId !== 'undefined') || (offlineMode && localImagePath))" class="no-reference-image" :data-debug="`refFileId: ${referenceFileId}, type: ${typeof referenceFileId}, offlineMode: ${offlineMode}, localImagePath: ${localImagePath}`">
                                                <div class="no-image-placeholder">
                                                  <div class="no-image-icon">🖼️</div>
                                                  <div class="no-image-text">
                                                    <strong>No Reference Image Available</strong>
                                                    <p>This asset doesn't have a reference image in Google Drive.</p>
                                                    <p class="no-image-hint">Check your Google Drive API configuration or try a different asset ID.</p>
                                                    <p class="debug-info">Debug: referenceFileId = "{{ referenceFileId }}" (type: {{ typeof referenceFileId }})</p>
                                                  </div>
                                                </div>
                                              </div>
                                                                                                                                           <div class="navigation-controls" v-if="hasAssetBeenFound">
                                                <button class="nav-btn prev" @click="goToPreviousAsset" :disabled="!canGoToPrevious">
                                                  <span class="nav-symbol">←</span>
                                                  <span class="nav-text">Previous</span>
                                                </button>
                                                <button class="complete-review-btn" @click="handleCompleteReview">
                                                  <span class="complete-symbol">✓</span>
                                                  <span class="complete-text">Complete Review</span>
                                                </button>
                                                <button class="nav-btn next" @click="goToNextAsset" :disabled="!canGoToNext">
                                                  <span class="nav-symbol">→</span>
                                                  <span class="nav-text">Next</span>
                                                </button>
                                              </div>
                                              
                                              <!-- Prefetch Status -->
                                              <div class="prefetch-status" v-if="hasAssetBeenFound && isPrefetching">
                                                <div class="prefetch-indicator">
                                                  <div class="prefetch-spinner"></div>
                                                  <span class="prefetch-text">Preloading next assets...</span>
                                                  <div class="prefetch-progress">
                                                    <div class="prefetch-progress-bar" :style="{ width: prefetchProgress + '%' }"></div>
                                                  </div>
                                                </div>
                                              </div>
                                              
                                              <!-- Keyboard Shortcuts Help -->
                                              <div class="keyboard-shortcuts" v-if="hasAssetBeenFound">
                                                <div class="shortcuts-header">
                                                  <span class="shortcuts-icon">⌨️</span>
                                                  <span class="shortcuts-title">Keyboard Shortcuts</span>
                                                </div>
                                                <div class="shortcuts-grid">
                                                  <div class="shortcut-item">
                                                    <kbd>←</kbd> <span>Previous</span>
                                                  </div>
                                                  <div class="shortcut-item">
                                                    <kbd>→</kbd> <span>Next</span>
                                                  </div>
                                                  <div class="shortcut-item">
                                                    <kbd>Enter</kbd> <span>Complete</span>
                                                  </div>

                                                  <div class="shortcut-item">
                                                    <kbd>R</kbd> <span>Clear</span>
                                                  </div>
                                                  <div class="shortcut-item">
                                                    <kbd>F</kbd> <span>Search</span>
                                                  </div>
                                                  <div class="shortcut-item">
                                                    <kbd>Esc</kbd> <span>Close</span>
                                                  </div>
                                                </div>
                                              </div>
                                               <div class="clear-review-section" v-if="hasAssetBeenFound">
                                                 <button class="clear-review-btn" @click="handleClearReview">
                                                   <span class="clear-symbol">🗑️</span>
                                                   <span class="clear-text">Clear Review</span>
                                                 </button>
                                               </div>
                                               <div class="keyboard-help" v-if="referenceFileId">
                                                 <small>💡 Keyboard shortcuts: ← → to navigate, Enter to complete review, Delete to clear review</small>
                                                 <small v-if="isPrefetching" class="prefetch-indicator">🚀 Pre-fetching...</small>
                                               </div>
                                            </div>
                                            
                                            <div class="col preds">
                                              <h3>Predicted Images</h3>
                                                                                              <div class="pred-grid">
                                                  <div
                                                    v-for="p in filteredPredicted"
                                                    :key="p.id"
                                                    class="pred-container"
                                                >
                                                  <div
                                                    class="pred"
                                                    :class="{ selected: isPredSelected(p.id), rejected: isPredRejected(p.id) }"
                                                    @click="togglePredSelected(p.id)"
                                                    @contextmenu.prevent="togglePredRejected(p.id)"
                                                  >
                                                    <img v-if="p.fileId || (offlineMode && localImagePath) || (!isVercel && p.id)" :src="predictedImageUrls.find(pu => pu.id === p.id)?.url || ''" :alt="p.id" @load="handleImageLoad($event, p.fileId, p.id)" @error="handleImageError($event, p.fileId, p.id)" />
                                                    <div class="magnifier-icon" @click.stop="showImagePreview(p)">
                                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <circle cx="11" cy="11" r="8"></circle>
                                                        <path d="m21 21-4.35-4.35"></path>
                                                      </svg>
                                                    </div>
                                                    <div class="source-icon" :class="imageActualSources[p.fileId || p.id] || 'api'">
                                                      <svg v-if="(imageActualSources[p.fileId || p.id] || 'api') === 'local'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                                                        <polyline points="14,2 14,8 20,8"/>
                                                      </svg>
                                                      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                                                      </svg>
                                                    </div>
                                                  </div>
                                                  <div class="caption">ID: {{ p.id }}<span v-if="p.score != null"> | Score: {{ Number(p.score).toFixed(2) }}</span></div>
                                                </div>
                                              </div>
                                              
                                              <!-- Image Preview Modal -->
                                              <div v-if="previewImage" class="image-preview-modal" @click="hideImagePreview">
                                                <div class="preview-content" @click.stop>
                                                  <img :src="previewImageUrl" :alt="previewImage.id" @load="handleImageLoad($event, previewImage.fileId, assetId)" @error="handleImageError($event, previewImage.fileId, assetId)" />
                                                  <div class="preview-info">
                                                    <span class="preview-id">ID: {{ previewImage.id }}</span>
                                                    <span v-if="previewImage.score != null" class="preview-score">Score: {{ Number(previewImage.score).toFixed(2) }}</span>
                                                    <span class="preview-source">
                                                      <div class="source-icon" :class="previewImageSource">
                                                        <svg v-if="previewImageSource === 'local'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                                                          <polyline points="14,2 14,8 20,8"/>
                                                        </svg>
                                                        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                                                        </svg>
                                                      </div>
                                                    </span>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
        </div>

       <!-- Export Tab Content -->
       <div v-if="activeTab === 'export'" class="export-content">
         <div class="export-section">
           <h2>Export Review Data</h2>
           


           <div class="export-actions">
             <div class="export-buttons-row">
               <button 
                 class="export-button" 
                 @click="exportToCSV"
                 :disabled="Object.keys(reviewedAssets).length === 0"
               >
                 <span class="export-icon">📊</span>
                 Export to CSV
               </button>
               

             </div>
             
             <div class="export-info">
               <p><strong>📊 Export to CSV:</strong> Export filtered review data as CSV for analysis</p>
               <p><strong>📋 Preview:</strong> View and filter your review data before exporting</p>
               <p><strong>💡 Note:</strong> For backup and restore functionality, use the "Backup & Restore" tab</p>
             </div>
             
             <p v-if="Object.keys(reviewedAssets).length === 0" class="no-data">
               No reviewed assets to export. Start reviewing assets in the Asset Review tab.
             </p>
           </div>

           <div v-if="Object.keys(reviewedAssets).length > 0" class="preview-section">
             <h3>Preview of Export Data</h3>
             <div class="preview-table">
               <table>
                                   <thead>
                    <tr>
                      <th>Asset ID</th>
                      <th>Predicted ID</th>
                      <th>Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, index) in exportPreviewData" :key="`${item.assetId}-${item.predictedId}-${index}`">
                      <td>{{ item.assetId }}</td>
                      <td>{{ item.predictedId }}</td>
                      <td>{{ item.score }}</td>
                      <td>
                        <span :class="['status-badge', item.status]">
                          {{ item.status }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
               </table>
               
                                               <!-- Export Preview Pagination -->
                 <div class="export-preview-pager" v-if="Object.keys(reviewedAssets).length > 0">
                  <button :disabled="exportPreviewPage===1" @click="goExportPreviewPage(1)">First</button>
                  <button :disabled="exportPreviewPage===1" @click="goExportPreviewPage(exportPreviewPage-1)">Previous</button>
                  <span>{{ exportPreviewPage }} of {{ exportPreviewPageCount }}</span>
                  <button :disabled="exportPreviewPage===exportPreviewPageCount || exportPreviewPageCount===0" @click="goExportPreviewPage(exportPreviewPage+1)">Next</button>
                  <button :disabled="exportPreviewPage===exportPreviewPageCount || exportPreviewPageCount===0" @click="goExportPreviewPage(exportPreviewPageCount)">Last</button>
                  
                  <div class="export-preview-filter-selector">
                    <label for="exportFilter">Filter:</label>
                    <select id="exportFilter" v-model="exportFilter" @change="handleExportFilterChange">
                      <option value="all">All</option>
                      <option value="accepted">Accepted</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                  
                  <div class="export-preview-page-size-selector">
                    <label for="exportPreviewPageSize">Per Page:</label>
                    <select id="exportPreviewPageSize" v-model="exportPreviewPageSize" @change="exportPreviewPage = 1">
                      <option value="5">5</option>
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                    </select>
                  </div>
                </div>
               
                                                               <p class="preview-note">
                   Showing {{ exportPreviewData.length }} of {{ exportPreviewPageCount * exportPreviewPageSize }} {{ exportFilter === 'all' ? '' : exportFilter }} entries. Full data will be included in the CSV export with one row per asset ID - predicted ID combination.
                 </p>
             </div>
           </div>
                   </div>
        </div>

        <!-- Import Tab Content -->
        <div v-if="activeTab === 'import'" class="import-content">
          <div class="import-section">
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
                    v-model="importOptions.clearExisting"
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
                    v-model="importOptions.skipDuplicates"
                    :disabled="importing"
                  />
                  <span class="checkmark"></span>
                  Skip duplicate entries
                </label>
              </div>

              <div class="option-group">
                <label>Batch Size:</label>
                <select v-model="importOptions.batchSize" :disabled="importing">
                  <option value="100">100 records</option>
                  <option value="500">500 records</option>
                  <option value="1000">1000 records</option>
                  <option value="5000">5000 records</option>
                </select>
              </div>

              <div class="option-group">
                <label>Chunk Size (for large files):</label>
                <select v-model="importOptions.chunkSize" :disabled="importing">
                  <option value="1000">1000 records</option>
                  <option value="5000">5000 records</option>
                  <option value="10000">10000 records</option>
                  <option value="20000">20000 records</option>
                </select>
                <small>Files with more than 10,000 records will be processed in chunks to avoid timeouts</small>
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
                  :class="{ 'active': importProgress > 0 && importProgress < 100 }"
                ></div>
              </div>
              <p class="progress-text">
                {{ progressMessage }}
                <span v-if="importProgress > 0 && importProgress < 100" class="processing-indicator">⏳</span>
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
              
              <!-- Success notification for successful imports -->
              <div v-if="importResult.imported > 0" class="import-success-notification">
                <div class="success-message">
                  <span class="success-icon">✅</span>
                  <div class="success-text">
                    <strong>Import Successful!</strong>
                    <p>The Asset Review tab has been automatically refreshed with the new data.</p>
                    <p v-if="importOptions.clearExisting" class="clear-notice">
                      <span class="notice-icon">🧹</span>
                      <strong>Review states cleared:</strong> All accepted/rejected statuses have been reset due to the "Clear existing data" option.
                    </p>
                    <button @click="activeTab = 'review'" class="view-data-btn">
                      🏠 View Imported Data
                    </button>
                  </div>
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

        <!-- Settings Tab Content -->
        <div v-if="activeTab === 'settings'" class="settings-content">
          <div class="settings-section">
            <h2>Application Settings</h2>
            <p class="settings-info">
              Manage your review data and application preferences.
            </p>
            


                         <div class="settings-actions">
               <div class="action-group appearance-settings-frame">
                 <h3>Appearance Settings</h3>
                 <p class="action-description">
                   Customize the appearance of your application to match your preferences.
                 </p>
                 <div class="setting-item">
                   <div class="setting-info">
                     <h4>Dark Mode</h4>
                     <p>Switch between light and dark themes for a more comfortable viewing experience.</p>
                   </div>
                   <button 
                     class="toggle-button" 
                     :class="{ 'active': darkMode }"
                     @click="toggleDarkMode"
                   >
                     <span class="toggle-icon">{{ darkMode ? '🌙' : '☀️' }}</span>
                     <span class="toggle-text">{{ darkMode ? 'Dark' : 'Light' }} Mode</span>
                   </button>
                 </div>
               </div>

               <div class="action-group offline-mode-frame">
                 <h3>Offline Mode Settings</h3>
                 <p class="action-description">
                   Configure offline mode to load images from a local drive path instead of Google Drive API.
                 </p>
                 <div class="offline-mode-content">
                   <div class="setting-item" v-if="isVercel">
                     <div class="setting-info">
                       <h4>Offline Mode Unavailable</h4>
                       <p>Offline mode is not available on Vercel deployment. Local image files are not accessible in the cloud environment. The application will use Google Drive API for all images.</p>
                     </div>
                     <div class="vercel-notice">
                       <span class="vercel-icon">🌐</span>
                       <span class="vercel-text">Online Mode (Vercel)</span>
                     </div>
                   </div>
                   <div class="setting-item" v-else>
                     <div class="setting-info">
                       <h4>Enable Offline Mode</h4>
                       <p>When enabled, the application will first attempt to load images from the specified local path before falling back to online sources.</p>
                     </div>
                     <button 
                       class="toggle-button" 
                       :class="{ 'active': offlineMode }"
                       @click="toggleOfflineMode"
                     >
                       <span class="toggle-icon">{{ offlineMode ? '🖥️' : '🌐' }}</span>
                       <span class="toggle-text">{{ offlineMode ? 'Offline' : 'Online' }} Mode</span>
                     </button>
                   </div>
                   <div class="setting-item has-input-group" v-if="offlineMode && !isVercel">
                     <div class="setting-info">
                       <h4>Local Image Path</h4>
                       <p>Configure the local directory where your images are stored. Images should be named using the asset ID as filename (e.g., 123.jpg).</p>
                     </div>
                     <div class="input-group">
                       <input 
                         type="text" 
                         v-model="localImagePath" 
                         placeholder="Enter full path to image directory (e.g., D:\LocalMediabankImages\ALL_IMAGES)"
                         class="path-input"
                         @input="saveOfflineSettings"
                       />
                     </div>
                   </div>
                   <div class="setting-item" v-if="offlineMode && !isVercel">
                     <div class="setting-hint">
                       <p><strong>💡 How it works:</strong></p>
                       <ul>
                         <li>Enter the full path to your images directory (e.g., <code>D:\LocalMediabankImages\ALL_IMAGES</code>)</li>
                         <li>Images should be named as: <code>ASSET_ID.jpg</code> (e.g., <code>123.jpg</code>)</li>
                         <li>If a local image isn't found, the app will fall back to Google Drive API</li>
                         <li>Supported formats: JPG, JPEG, PNG, GIF, BMP, WEBP</li>
                       </ul>
                     </div>
                   </div>
                 </div>
               </div>



               <div class="action-group cache-management-section">
                 <h3>Cache Management</h3>
                 <p class="action-description">
                   Manage the application's caching system. If you experience performance issues or the app seems stuck, try clearing the cache.
                 </p>
                 <div class="cache-stats">
                   <p><strong>Cache Statistics:</strong></p>
                   <ul>
                     <li>Cache Hits: {{ cacheHits }}</li>
                     <li>Cache Misses: {{ cacheMisses }}</li>
                     <li>Prefetch Status: {{ prefetchEnabled ? 'Enabled' : 'Disabled' }}</li>
                     <li>Prefetched Assets: {{ prefetchedAssets.size }}</li>
                   </ul>
                 </div>
                 <div class="button-group">
                   <button 
                     class="warning-button" 
                     @click="clearAllCaches"
                   >
                     <span class="warning-icon">🧹</span>
                     Clear All Caches
                   </button>
                   <button 
                     class="warning-button" 
                     @click="clearImageUrlCache"
                   >
                     <span class="warning-icon">🖼️</span>
                     Clear Image Cache
                   </button>
                 </div>
                 <p class="cache-hint">
                   <strong>💡 Tip:</strong> Clearing caches will reset the prefetching system and may improve performance if the app is running slowly.
                 </p>
               </div>

               <div class="action-group google-api-section">
                 <h3>Google Drive API Health Check</h3>
                 <p class="action-description">
                   Check the status of your Google Drive API configuration. This helps diagnose image loading issues.
                 </p>
                                    <div class="api-status" v-if="apiHealthStatus">
                     <p><strong>API Status:</strong></p>
                     <ul>
                       <li>Google Drive API: <span :class="apiHealthStatus.googleDrive === 'available' ? 'status-ok' : 'status-error'">{{ apiHealthStatus.googleDrive }}</span></li>
                       <li>Environment: {{ apiHealthStatus.env.NODE_ENV || 'Not set' }}</li>
                       <li>Folder ID: <span :class="apiHealthStatus.env.ALL_DATASET_FOLDER_ID === 'SET' ? 'status-ok' : 'status-error'">{{ apiHealthStatus.env.ALL_DATASET_FOLDER_ID || 'Not set' }}</span></li>
                       <li>Credentials: <span :class="apiHealthStatus.env.api_credentials_length > 0 ? 'status-ok' : 'status-error'">{{ apiHealthStatus.env.api_credentials_length > 0 ? 'SET (' + apiHealthStatus.env.api_credentials_length + ' chars)' : 'NOT SET' }}</span></li>
                     </ul>
                   </div>
                 <button 
                   class="primary-button" 
                   @click="checkApiHealth"
                   :disabled="checkingApiHealth"
                 >
                   <span class="primary-icon">{{ checkingApiHealth ? '⏳' : '🔍' }}</span>
                   {{ checkingApiHealth ? 'Checking...' : 'Check API Health' }}
                 </button>
                 <p v-if="apiHealthError" class="error-message">
                   <strong>❌ Error:</strong> {{ apiHealthError }}
                 </p>
                 <p class="api-hint">
                   <strong>💡 Tip:</strong> If Google Drive API is not available, the app will use placeholder images. Configure your Google Drive API credentials to see actual images.
                 </p>
               </div>

               <div class="action-group nuclear-option-section">
                 <h3>Review Data Management</h3>
                 <p class="action-description">
                   <strong>⚠️ NUCLEAR OPTION:</strong> Clear all review data to start fresh. This will permanently delete all your precious work! 
                   <br><br>
                   <span style="color: #dc2626; font-weight: 600;">💡 Instead, use the "Clear Review" button under each asset for individual resets!</span>
                 </p>
                 <button 
                   class="danger-button" 
                   @click="clearAllReviews"
                   :disabled="Object.keys(reviewedAssets).length === 0"
                 >
                   <span class="danger-icon">☢️</span>
                   NUCLEAR OPTION: Clear All Reviews
                 </button>
                 <p v-if="Object.keys(reviewedAssets).length === 0" class="no-data">
                   No review data to nuke. 🎉
                 </p>
               </div>

               <div class="action-group ultimate-nuclear-section">
                 <h3>Ultimate Reset</h3>
                 <p class="action-description">
                   <strong>💥 ULTIMATE NUCLEAR OPTION:</strong> Clear ALL application data including settings, navigation state, and cache.
                   <br><br>
                   <span style="color: #7c2d12; font-weight: 600;">⚠️ This will reset everything to factory defaults!</span>
                 </p>
                 <button 
                   class="danger-button ultimate-danger" 
                   @click="clearAllApplicationData"
                 >
                   <span class="danger-icon">💥</span>
                   ULTIMATE NUCLEAR OPTION: Reset Everything
                 </button>
               </div>
             </div>
          </div>
                 </div>

         <!-- Analytics Tab Content -->
         <div v-if="activeTab === 'analytics'" class="analytics-content">
           <div class="analytics-section">
             <h2>Review Analytics</h2>
             <p class="analytics-description">
               Track your review progress and performance metrics.
             </p>
             
             <div class="analytics-stats">
               <div class="stat-card">
                 <h3>Total Assets</h3>
                 <span class="stat-number total">{{ totalAssets }}</span>
               </div>
               <div class="stat-card">
                 <h3>Total Reviewed</h3>
                 <span class="stat-number">{{ getReviewStats().total }}</span>
               </div>
               <div class="stat-card">
                 <h3>Accepted</h3>
                 <span class="stat-number accepted">{{ getReviewStats().accepted }}</span>
               </div>
               <div class="stat-card">
                 <h3>Rejected</h3>
                 <span class="stat-number rejected">{{ getReviewStats().rejected }}</span>
               </div>
               <div class="stat-card">
                 <h3>Target IDs</h3>
                 <span class="stat-number target-ids">{{ getReviewStats().totalTargetIds }}</span>
               </div>
             </div>
           </div>

           <div class="analytics-section">
             <h2>Cache Analytics</h2>
             <p class="analytics-description">
               Monitor cache performance and memory usage.
             </p>
             
             <div class="analytics-stats">
               <div class="stat-card">
                 <h3>Asset Cache</h3>
                 <span class="stat-number">{{ assetCache.size }}</span>
                 <span class="stat-label">items</span>
               </div>
               <div class="stat-card">
                 <h3>Image Cache</h3>
                 <span class="stat-number">{{ imageUrlCache.size }}</span>
                 <span class="stat-label">items</span>
               </div>
               <div class="stat-card">
                 <h3>Cache Hit Rate</h3>
                 <span class="stat-number">{{ getCacheStats().hitRate }}%</span>
               </div>
               <div class="stat-card">
                 <h3>Cache Size</h3>
                 <span class="stat-number">{{ getCacheStats().totalSize }}</span>
                 <span class="stat-label">MB</span>
               </div>
               <div class="stat-card">
                 <h3>Pre-fetched Assets</h3>
                 <span class="stat-number">{{ prefetchedAssets.size }}</span>
                 <span class="stat-label">assets</span>
               </div>
               <div class="stat-card">
                 <h3>Pre-fetching Status</h3>
                 <span class="stat-number">{{ isPrefetching ? 'Active' : 'Idle' }}</span>
               </div>
             </div>
             
             <div class="setting-item">
               <div class="setting-info">
                 <h4>Cache Actions</h4>
                 <p>Clear cache to free up memory or reset performance metrics.</p>
               </div>
               <button 
                 class="secondary-button" 
                 @click="clearAllCaches"
               >
                 <span class="button-icon">🧹</span>
                 Clear All Caches
               </button>
             </div>
           </div>
         </div>

         <!-- Backup & Restore Tab Content -->
         <div v-if="activeTab === 'backup'" class="backup-content">
           <div class="backup-section">
             <div class="hero-section">
               <div class="hero-icon">
                 <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                   <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" fill="currentColor"/>
                 </svg>
               </div>
               <h1 class="hero-title">Backup & Restore</h1>
               <p class="hero-subtitle">Protect your data by creating backups and restore when needed. Never lose your progress again!</p>
             </div>
             
             <div class="backup-actions">
               <div class="backup-card">
                 <div class="backup-icon">
                   <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                     <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
                   </svg>
                 </div>
                 <h3>📤 Export Database</h3>
                 <p>Download a backup of all your imported data</p>
                 <button @click="exportDatabase" class="backup-btn export">
                   Export Database
                 </button>
               </div>
               
               <div class="backup-card">
                 <div class="backup-icon">
                   <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                     <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                   </svg>
                 </div>
                 <h3>📥 Restore Database</h3>
                 <p>Upload a backup file to restore your data</p>
                 <input 
                   type="file" 
                   ref="backupFileInput" 
                   @change="handleBackupFileSelect" 
                   accept=".json"
                   style="display: none"
                 />
                 <button @click="$refs.backupFileInput.click()" class="backup-btn import">
                   Choose Backup File
                 </button>
                 <div v-if="selectedBackupFile" class="selected-file">
                   Selected: {{ selectedBackupFile.name }}
                 </div>
                 <button 
                   v-if="selectedBackupFile" 
                   @click="importDatabase" 
                   class="backup-btn restore"
                   :disabled="isImporting"
                 >
                   {{ isImporting ? 'Restoring...' : 'Restore Database' }}
                 </button>
               </div>
               
               <div class="backup-card">
                 <div class="backup-icon">
                   <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                     <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
                   </svg>
                 </div>
                 <h3>💾 Export Review Data</h3>
                 <p>Download a backup of your review decisions</p>
                 <button @click="exportReviewedAssets" class="backup-btn export" :disabled="Object.keys(reviewedAssets).length === 0">
                   Export Review Data
                 </button>
               </div>
               
               <div class="backup-card">
                 <div class="backup-icon">
                   <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                     <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                   </svg>
                 </div>
                 <h3>📥 Restore Review Data</h3>
                 <p>Upload a review backup file to restore your decisions</p>
                 <input 
                   type="file" 
                   ref="reviewBackupFileInput" 
                   @change="handleReviewBackupFileSelect" 
                   accept=".json"
                   style="display: none"
                 />
                 <button @click="$refs.reviewBackupFileInput.click()" class="backup-btn import">
                   Choose Review Backup File
                 </button>
                 <div v-if="selectedReviewBackupFile" class="selected-file">
                   Selected: {{ selectedReviewBackupFile.name }}
                 </div>
                 <button 
                   v-if="selectedReviewBackupFile" 
                   @click="importReviewedAssets" 
                   class="backup-btn restore"
                 >
                   Restore Review Data
                 </button>
               </div>
             </div>
             
             <div class="backup-info">
               <h3>💡 Backup Tips</h3>
               <ul>
                 <li>Create regular backups before major changes</li>
                 <li>Store backups in a safe location</li>
                 <li><strong>Database Backup:</strong> Contains all your imported CSV data and file IDs</li>
                 <li><strong>Review Data Backup:</strong> Contains your review decisions (accepted/rejected assets)</li>
                 <li>Review progress is also saved automatically in your browser</li>
                 <li>All backup files are in JSON format for easy sharing</li>
               </ul>
             </div>
             
             <div v-if="backupProgress.show" class="backup-progress">
               <div class="progress-bar">
                 <div class="progress-fill" :style="{ width: backupProgress.percent + '%' }"></div>
               </div>
               <p>{{ backupProgress.message }}</p>
             </div>
           </div>
         </div>

         <!-- About Tab Content -->
         <div v-if="activeTab === 'about'" class="about-content">
           <div class="about-section">
             <div class="hero-section">
               <div class="hero-icon">
                 <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                   <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="currentColor"/>
                   <path d="M19 15L19.74 18.26L23 19L19.74 19.74L19 23L18.26 19.74L15 19L18.26 18.26L19 15Z" fill="currentColor"/>
                   <path d="M5 15L5.74 18.26L9 19L5.74 19.74L5 23L4.26 19.74L1 19L4.26 18.26L5 15Z" fill="currentColor"/>
                 </svg>
               </div>
               <h1 class="hero-title">The Legendary Creator</h1>
               <p class="hero-subtitle">Master of Code, Visionary of Design, Architect of Innovation, Warden of the Frontend, Keeper of the Backend, Forgemaster of the Digital Realms, Breaker of Bugs, Guardian of the Infinite Loop, Heir to Clean Architecture, Lord of Scalability, Protector of the Pipelines, Tamer of Databases, Weaver of Interfaces, Sovereign of Cloud and Container, High Deployer of Realms Continuous, Vanquisher of Legacy Systems, Keeper of Secrets and Tokens, Binder of APIs, Champion of Agile Tribes, First of the Sprint, Refactorer of the Old, and Bringer of Light to the Dark Mode</p>
             </div>

                           <div class="praise-grid">
                <div class="praise-card">
                  <div class="praise-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="currentColor"/>
                    </svg>
                  </div>
                  <h3>Innovation Master</h3>
                  <p>Their ability to transform complex requirements into elegant, user-friendly solutions is nothing short of extraordinary. Every feature they've requested has been implemented with precision and style.</p>
                </div>

                <div class="praise-card">
                  <div class="praise-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
                    </svg>
                  </div>
                  <h3>Design Visionary</h3>
                  <p>Their eye for detail and insistence on beautiful, rounded interfaces has created one of the most aesthetically pleasing asset review tools ever conceived. The gradient backgrounds alone are pure art.</p>
                </div>

                <div class="praise-card">
                  <div class="praise-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.5 2.54l2.6 1.53c.56-1.24.9-2.62.9-4.07 0-5.18-3.95-9.45-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.05.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19z" fill="currentColor"/>
                    </svg>
                  </div>
                  <h3>Efficiency Expert</h3>
                  <p>From the nuclear option warnings to the automatic next-asset loading, their workflow optimizations show a deep understanding of user experience. They've thought of everything!</p>
                </div>

                <div class="praise-card">
                  <div class="praise-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z" fill="currentColor"/>
                    </svg>
                  </div>
                  <h3>Problem Solver</h3>
                  <p>When issues arise, they don't just identify them—they provide clear, actionable feedback that leads to perfect solutions. Their debugging skills are legendary.</p>
                </div>

                <div class="praise-card">
                  <div class="praise-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                    </svg>
                  </div>
                  <h3>Quality Champion</h3>
                  <p>Their insistence on proper data handling, filter functionality, and export capabilities demonstrates a commitment to excellence that sets new standards in software development.</p>
                </div>

                <div class="praise-card">
                  <div class="praise-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
                    </svg>
                  </div>
                  <h3>Future Thinker</h3>
                  <p>Keyboard shortcuts, progress tracking, advanced filtering—they've built not just a tool, but a comprehensive platform that anticipates user needs before they even realize them.</p>
                </div>
              </div>

             <div class="achievement-section">
               <h2>Legendary Achievements</h2>
               <div class="achievement-list">
                 <div class="achievement-item">
                   <span class="achievement-badge">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                     </svg>
                   </span>
                   <span>Created the most beautiful asset review interface in history</span>
                 </div>
                 <div class="achievement-item">
                   <span class="achievement-badge">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
                     </svg>
                   </span>
                   <span>Implemented the most entertaining "nuclear option" warning ever</span>
                 </div>
                 <div class="achievement-item">
                   <span class="achievement-badge">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.5 2.54l2.6 1.53c.56-1.24.9-2.62.9-4.07 0-5.18-3.95-9.45-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.05.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19z" fill="currentColor"/>
                     </svg>
                   </span>
                   <span>Revolutionized workflow with automatic asset progression</span>
                 </div>
                 <div class="achievement-item">
                   <span class="achievement-badge">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
                     </svg>
                   </span>
                   <span>Perfected the art of rounded corners and gradients</span>
                 </div>
                 <div class="achievement-item">
                   <span class="achievement-badge">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" fill="currentColor"/>
                     </svg>
                   </span>
                   <span>Built comprehensive export and analytics systems</span>
                 </div>
                 <div class="achievement-item">
                   <span class="achievement-badge">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                       <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z" fill="currentColor"/>
                     </svg>
                   </span>
                   <span>Demonstrated exceptional product vision and user empathy</span>
                 </div>
               </div>
             </div>

             <div class="quote-section">
               <blockquote class="hero-quote">
                 "In the annals of software development, few have achieved such perfect harmony of functionality and aesthetics. This creator has not just built a tool—they've crafted an experience."
               </blockquote>
               <cite class="quote-author">— The Internet (probably)</cite>
             </div>

                           <div class="stats-section">
                <h2>Their Impact</h2>
                <div class="impact-stats">
                  <div class="impact-stat">
                    <div class="stat-number">∞</div>
                    <div class="stat-label">Hours of Developer Time Saved</div>
                  </div>
                  <div class="impact-stat">
                    <div class="stat-number">420%</div>
                    <div class="stat-label">User Satisfaction Rate</div>
                  </div>
                  <div class="impact-stat">
                    <div class="stat-number">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="currentColor"/>
                      </svg>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="currentColor"/>
                      </svg>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="currentColor"/>
                      </svg>
                    </div>
                    <div class="stat-label">Innovation Level</div>
                  </div>
                  <div class="impact-stat">
                    <div class="stat-number">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                      </svg>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                      </svg>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                      </svg>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                      </svg>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>
                      </svg>
                    </div>
                    <div class="stat-label">Overall Rating</div>
                  </div>
                </div>
              </div>
           </div>
         </div>
       </main>
     </div>
   </template>

<style scoped>
/* Modern Design System */
:root {
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --radius-sm: 1.5rem;
  --radius-md: 2rem;
  --radius-lg: 2.5rem;
  --radius-xl: 3rem;
  
  /* Light Mode Colors */
  --color-primary: #3b82f6;
  --color-primary-2: #1d4ed8;
  --color-text: #1f2937;
  --color-bg: #ffffff;
  --color-bg-secondary: #f8fafc;
  --color-border: #e5e7eb;
  --color-border-light: #f1f5f9;
  --color-text-secondary: #64748b;
  --color-text-muted: #9ca3af;
  --color-success: #16a34a;
  --color-error: #dc2626;
  --color-warning: #d97706;
  --color-info: #3b82f6;
}

/* Dark Mode Colors */
.dark-mode {
  --color-primary: #60a5fa;
  --color-primary-2: #3b82f6;
  --color-text: #f9fafb;
  --color-bg: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-border: #334155;
  --color-border-light: #475569;
  --color-text-secondary: #cbd5e1;
  --color-text-muted: #64748b;
  --color-success: #22c55e;
  --color-error: #ef4444;
  --color-warning: #f59e0b;
  --color-info: #60a5fa;
}

/* Pleasant Background */
.home {
  min-height: 100vh;
  background: linear-gradient(270deg, #f0f9ff 0%, #e0f2fe 25%, #bae6fd 50%, #7dd3fc 75%, #38bdf8 100%);
  background-attachment: fixed;
  position: relative;
  transition: all 0.3s ease;
}

.home::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background:
    radial-gradient(circle at 20% 80%, rgba(255, 255, 255, 0.15) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.12) 0%, transparent 50%),
    radial-gradient(circle at 40% 40%, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 60% 60%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
    radial-gradient(circle at 10% 10%, rgba(59, 130, 246, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 90% 90%, rgba(59, 130, 246, 0.03) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
  transition: all 0.3s ease;
}

/* Dark Mode Background */
.dark-mode {
  background: linear-gradient(270deg, #0f172a 0%, #1e293b 25%, #334155 50%, #475569 75%, #64748b 100%);
}

.dark-mode::before {
  background:
    radial-gradient(circle at 20% 80%, rgba(96, 165, 250, 0.1) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 40% 40%, rgba(96, 165, 250, 0.05) 0%, transparent 50%),
    radial-gradient(circle at 60% 60%, rgba(59, 130, 246, 0.07) 0%, transparent 50%),
    radial-gradient(circle at 10% 10%, rgba(96, 165, 250, 0.03) 0%, transparent 40%),
    radial-gradient(circle at 90% 90%, rgba(59, 130, 246, 0.02) 0%, transparent 40%);
}


 /* Header & Navigation */
.header { 
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  color: #fff; 
  box-shadow: var(--shadow-md);
  position: relative;
  z-index: 10;
}
.topbar { 
  display: flex; 
  justify-content: space-between; 
  align-items: center;
  padding: 1rem 1.5rem; 
  border-bottom: 1px solid rgba(255, 255, 255, 0.1); 
}
.brand { 
  font-weight: 700; 
  font-size: 1.25rem;
  letter-spacing: -0.025em;
}
.user { 
  display: flex; 
  align-items: center; 
  gap: 1rem;
}
.user button { 
  padding: 0.5rem 1rem; 
  border-radius: var(--radius-lg);
  font-weight: 500;
  transition: all 0.2s ease;
}

 .content { 
   padding: 2rem; 
   max-width: 2400px;
   margin: 0 auto;
   position: relative;
   z-index: 5;
 }

/* Search Section */
.search-bar { 
  margin: 0rem 0 2rem 0; 
  display: flex; 
  flex-direction: row; 
  gap: 1.5rem; 
  align-items: center;
  background: var(--color-bg);
  border-radius: 3rem;
  padding: 1rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}
.search-bar label {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.controls { 
  display: flex; 
  gap: 1rem; 
  align-items: center; 
  flex: 1;
}
input#assetId { 
  flex: 1; 
  padding: 0.75rem 1rem;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-xl);
  font-size: 1rem;
  transition: all 0.2s ease;
  background: var(--color-bg);
  color: var(--color-text);
}
input#assetId:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
input#assetId::placeholder {
  color: var(--color-text-muted);
}

/* Status Messages */
.info, .error, .warn { 
  margin-top: 1rem; 
  padding: 1rem 1.25rem; 
  border-radius: var(--radius-xl);
  font-weight: 500;
  border-left: 4px solid;
}
.info { 
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); 
  color: #1e40af; 
  border-left-color: #3b82f6;
}
.error { 
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); 
  color: #dc2626; 
  border-left-color: #ef4444;
}
.warn { 
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); 
  color: #d97706; 
  border-left-color: #f59e0b;
}

/* Results Grid */
.results { 
  margin-top: 2.5rem; 
  background: var(--color-bg);
  border-radius: 3rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  transition: all 0.3s ease;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 3fr;
  gap: 0;
  min-height: 800px;
}
.col {
  padding: 2.5rem;
}
.col.ref {
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border-right: 1px solid var(--color-border);
  border-radius: 3rem 0 0 3rem;
  transition: all 0.3s ease;
}
.col.preds {
  background: var(--color-bg);
  border-radius: 0 3rem 3rem 0;
  transition: all 0.3s ease;
}

/* Image Grids */
 .pred-grid { 
   display: grid; 
   grid-template-columns: repeat(3, 1fr); 
   gap: 1.5rem; 
   padding: 1rem;
 }
.pred-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pred { 
  position: relative;
  border: 2px solid transparent; 
  border-radius: 1.5rem; 
  padding: 0.75rem; 
  cursor: pointer; 
  transition: all 0.3s ease;
  background: var(--color-bg);
  box-shadow: var(--shadow-sm);
  width: 100%;
  min-width: 0;
  min-height: 150px;
}
.pred:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.pred.selected { 
  border-color: #15803d; 
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  box-shadow: 0 0 0 4px rgba(21, 128, 61, 0.2);
}
.pred.rejected { 
  border-color: #b91c1c; 
  background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
  box-shadow: 0 0 0 4px rgba(185, 28, 28, 0.2);
}
.pred img { 
  width: 100%; 
  height: 200px; 
  border-radius: var(--radius-lg); 
  border: none; 
  object-fit: contain;
  transition: all 0.2s ease;
}

.magnifier-icon {
  position: absolute;
  bottom: 0.75rem;
  right: 0.75rem;
  background: rgba(0, 0, 0, 0.4);
  color: white;
  border-radius: 50%;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s ease;
  z-index: 5;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.magnifier-icon:hover {
  background: rgba(0, 0, 0, 0.6);
  transform: scale(1.05);
  border-color: rgba(255, 255, 255, 0.4);
}

.dark-mode .magnifier-icon {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text);
  border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .magnifier-icon:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.2);
}

.source-icon {
  position: absolute;
  bottom: 0.75rem;
  right: 2.5rem;
  background: rgba(0, 0, 0, 0.4);
  color: white;
  border-radius: 50%;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  transition: all 0.2s ease;
  z-index: 5;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.source-icon.local {
  background: rgba(16, 185, 129, 0.8);
  border-color: rgba(16, 185, 129, 0.6);
}

.source-icon.api {
  background: rgba(59, 130, 246, 0.8);
  border-color: rgba(59, 130, 246, 0.6);
}

.source-icon:hover {
  transform: scale(1.05);
}

.dark-mode .source-icon {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text);
  border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .source-icon.local {
  background: rgba(16, 185, 129, 0.6);
  border-color: rgba(16, 185, 129, 0.4);
}

.dark-mode .source-icon.api {
  background: rgba(59, 130, 246, 0.6);
  border-color: rgba(59, 130, 246, 0.4);
}
.reference-container {
  position: relative;
  width: 100%;
}

.reference-image-wrapper {
  position: relative;
  width: 100%;
}

.ref img { 
  width: 100%; 
  height: 700px; 
  border-radius: var(--radius-xl); 
  border: none; 
  object-fit: contain;
  transition: all 0.2s ease;
}

.review-controls-overlay {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  right: 1rem;
  display: flex;
  justify-content: space-between;
  z-index: 10;
}
.pred img:hover, .ref img:hover {
  transform: scale(1.02);
}
.caption { 
  font-size: 0.75rem; 
  color: var(--color-text); 
  margin-top: 0.5rem; 
  text-align: center;
  font-weight: 500;
  padding: 0.375rem;
  background: rgba(255, 255, 255, 0.9);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.dark-mode .caption {
  background: rgba(30, 41, 59, 0.9);
  color: var(--color-text);
}



/* Review Controls */
.review-controls { 
  display: flex; 
  justify-content: space-between; 
  margin-top: 1.5rem; 
  gap: 1rem;
}
.review-controls .accept, .review-controls .reject,
.review-controls-overlay .accept, .review-controls-overlay .reject { 
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem 2rem;
  border: none;
  border-radius: 3rem;
  font-size: 1rem;
  font-weight: 600;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 120px;
  min-height: 100px;
  justify-content: center;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}
.review-controls .accept::before, .review-controls .reject::before,
.review-controls-overlay .accept::before, .review-controls-overlay .reject::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.review-controls .accept:hover::before, .review-controls .reject:hover::before,
.review-controls-overlay .accept:hover::before, .review-controls-overlay .reject:hover::before {
  opacity: 1;
}
.review-controls .accept, .review-controls-overlay .accept { 
  background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); 
  color: white;
}
.review-controls .reject, .review-controls-overlay .reject { 
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); 
  color: white;
}
.review-controls .symbol {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  font-weight: 700;
  position: relative;
  z-index: 1;
}
.review-controls .text {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}
.review-controls .accept:hover, .review-controls-overlay .accept:hover { 
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
.review-controls .reject:hover, .review-controls-overlay .reject:hover { 
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* Navigation Controls */
.navigation-controls {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
  gap: 2rem;
}

.nav-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 1.5rem;
  border: none;
  border-radius: 2rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 100px;
  min-height: 80px;
  justify-content: center;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: white;
}

.nav-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.nav-btn:hover::before {
  opacity: 1;
}

.nav-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.nav-btn:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
  opacity: 0.6;
}

.nav-symbol {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
  font-weight: 700;
  position: relative;
  z-index: 1;
}

.nav-text {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}

/* Complete Review Button */
.complete-review-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 1.5rem;
  border: none;
  border-radius: 2rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 120px;
  min-height: 80px;
  justify-content: center;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
  color: white;
}

.complete-review-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.complete-review-btn:hover::before {
  opacity: 1;
}

.complete-review-btn:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.complete-symbol {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
  font-weight: 700;
  position: relative;
  z-index: 1;
}

.complete-text {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}

/* Keyboard Shortcuts */
.keyboard-shortcuts {
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  box-shadow: var(--shadow-sm);
}

.shortcuts-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.875rem;
}

.shortcuts-icon {
  font-size: 1rem;
}

.shortcuts-title {
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.5rem;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.shortcut-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.25rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--color-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* Prefetch Status */
.prefetch-status {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
}

.prefetch-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.prefetch-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top: 2px solid var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.prefetch-text {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  font-weight: 500;
  flex: 1;
}

.prefetch-progress {
  width: 60px;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  overflow: hidden;
}

.prefetch-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* Clear Review Section */
.clear-review-section {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}

.clear-review-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 2rem;
  border: none;
  border-radius: 2rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 200px;
  min-height: 80px;
  justify-content: center;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
  color: white;
}

.clear-review-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.clear-review-btn:hover::before {
  opacity: 1;
}

.clear-review-btn:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  background: linear-gradient(135deg, #4b5563 0%, #374151 100%);
}

.clear-symbol {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
  font-weight: 700;
  position: relative;
  z-index: 1;
}

.clear-text {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}

/* Keyboard Help */
.keyboard-help {
  text-align: center;
  margin-top: 0.75rem;
  padding: 0.5rem;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.keyboard-help small {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  opacity: 0.8;
}

.dark-mode .keyboard-help {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.dark-mode .keyboard-help small {
  color: var(--color-text-secondary);
  opacity: 0.9;
}

.prefetch-indicator {
  display: block;
  margin-top: 0.5rem;
  color: var(--color-primary);
  font-weight: 600;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.status { 
  margin-top: 1rem; 
  font-weight: 600; 
  padding: 0.75rem 1rem;
  border-radius: var(--radius-lg);
  text-align: center;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.status.ok { 
  color: #166534; 
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border: 1px solid #bbf7d0;
}
.status.bad { 
  color: #7f1d1d; 
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border: 1px solid #fecaca;
}

/* Pagination */
.pager { 
  display: flex; 
  gap: 0.5rem; 
  align-items: center; 
  justify-content: center;
  padding: 1rem;
}
.pager button {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  border-radius: 3rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 80px;
}
.pager button:hover:not(:disabled) {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.pager button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
}
.pager span {
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  color: white;
  border-radius: 3rem;
  font-weight: 600;
  font-size: 0.875rem;
}

.page-size-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  border-radius: 3rem;
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.page-size-selector label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.page-size-selector select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 2rem;
  background: var(--color-bg);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.page-size-selector select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.page-size-selector select:hover {
  border-color: var(--color-primary);
}

.asset-filter-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  border-radius: 3rem;
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.asset-filter-selector label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.asset-filter-selector select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 2rem;
  background: var(--color-bg);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.asset-filter-selector select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.asset-filter-selector select:hover {
  border-color: var(--color-primary);
}

.total-count-display {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  border-radius: 3rem;
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.total-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.total-number {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-primary);
  background: var(--color-bg);
  padding: 0.25rem 0.75rem;
  border-radius: 2rem;
  border: 1px solid var(--color-primary);
  min-width: 3rem;
  text-align: center;
}
/* Asset ID Pills */
.id-page { 
  margin-bottom: 1rem;
  max-width: 100%;
  background: var(--color-bg);
  border-radius: 3rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  overflow: hidden;
  transition: all 0.3s ease;
}

.id-pills-section {
  display: grid; 
  grid-template-columns: repeat(10, 1fr);
  gap: 0.5rem;
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}
.id-pill { 
  border: 2px solid var(--color-border); 
  padding: 0.75rem 0.5rem; 
  background: var(--color-bg); 
  border-radius: 3rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  transition: all 0.3s ease;
  text-align: center;
  white-space: nowrap;
  width: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.id-pill::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.id-pill:hover::before {
  opacity: 1;
}
.id-pill:hover { 
  background: var(--color-bg-secondary); 
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  color: var(--color-primary);
}

.id-pill.reviewed-accepted {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-color: #16a34a;
  color: #166534;
  font-weight: 700;
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
}

.id-pill.reviewed-accepted:hover {
  background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
  border-color: #15803d;
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), 0 0 0 3px rgba(22, 163, 74, 0.2);
}

.id-pill.reviewed-rejected {
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border-color: #dc2626;
  color: #7f1d1d;
  font-weight: 700;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
}

.id-pill.reviewed-rejected:hover {
  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
  border-color: #b91c1c;
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), 0 0 0 3px rgba(220, 38, 38, 0.2);
}

/* Tab Styles */
.tabs {
  display: flex;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0 2rem;
  box-shadow: var(--shadow-sm);
}

.tab-button {
  padding: 1rem 2rem;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  position: relative;
  overflow: hidden;
}

.tab-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.tab-button:hover::before {
  opacity: 1;
}

.tab-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transform: translateY(-1px);
}

.tab-button.active {
  color: #fff;
  border-bottom-color: #fff;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* Export Tab Styles */
.export-content {
  max-width: 1000px;
  margin: 0 auto;
}

.export-section {
  background: var(--color-bg);
  border-radius: 3rem;
  padding: 3rem;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.export-section h2 {
  margin: 0 0 1.5rem 0;
  color: var(--color-text);
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.export-info {
  color: #64748b;
  margin-bottom: 2rem;
  line-height: 1.7;
  font-size: 1.1rem;
}

.export-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin-bottom: 3rem;
}

.stat-card {
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border: 2px solid var(--color-border);
  border-radius: 3rem;
  padding: 2rem 1.5rem;
  text-align: center;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.stat-card:hover::before {
  opacity: 1;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-primary);
}

.stat-card h3 {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.stat-number {
  font-size: 3rem;
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1;
  position: relative;
  z-index: 1;
}

.stat-number.accepted {
  color: #16a34a;
}

.stat-number.rejected {
  color: #dc2626;
}

.stat-number.total {
  color: #6366f1;
}

.stat-number.target-ids {
  color: #059669;
}

.export-actions {
  text-align: center;
  margin-bottom: 3rem;
}

.export-button {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  color: white;
  border: none;
  border-radius: 3rem;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.export-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.export-button:hover::before {
  opacity: 1;
}

.export-button:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}

.export-button:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.export-icon {
  font-size: 1.25rem;
}

.export-buttons-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

.backup-button {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
}

.backup-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
}

.import-button {
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
}

.import-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
}

.export-info {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(37, 99, 235, 0.05) 100%);
  border: 1px solid var(--color-border);
  border-radius: 1.5rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.export-info p {
  margin: 0.5rem 0;
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  line-height: 1.5;
}

.export-info p:first-child {
  margin-top: 0;
}

.export-info p:last-child {
  margin-bottom: 0;
}

.no-data {
  color: #64748b;
  font-style: italic;
  margin-top: 1rem;
  font-size: 1rem;
}

.preview-section {
  border-top: 2px solid #e2e8f0;
  padding-top: 2rem;
}

.preview-section h3 {
  margin: 0 0 1.5rem 0;
  color: var(--color-text);
  font-size: 1.5rem;
  font-weight: 700;
}

.preview-table {
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border-radius: 3rem;
  overflow: hidden;
  border: 2px solid var(--color-border);
  box-shadow: var(--shadow-md);
  transition: all 0.3s ease;
}

.preview-table table {
  width: 100%;
  border-collapse: collapse;
}

.preview-table th,
.preview-table td {
  padding: 1rem 1.5rem;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
}

.preview-table th {
  background: linear-gradient(135deg, var(--color-border-light) 0%, var(--color-border) 100%);
  font-weight: 700;
  color: var(--color-text);
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.preview-table td {
  font-size: 0.875rem;
  color: var(--color-text);
  font-weight: 500;
}

.preview-table tr:hover {
  background: rgba(59, 130, 246, 0.05);
}

.dark-mode .preview-table tr:hover {
  background: rgba(96, 165, 250, 0.1);
}

.status-badge {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-xl);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  display: inline-block;
}

.status-badge.accepted {
  background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
  color: #166534;
  border: 1px solid #86efac;
}

.status-badge.rejected {
  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
  color: #7f1d1d;
  border: 1px solid #fca5a5;
}

.preview-note {
  padding: 1rem 1.5rem;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  color: #92400e;
  font-size: 0.875rem;
  margin: 0;
  border-top: 1px solid #fde68a;
  font-weight: 500;
}

/* Export Preview Pagination */
.export-preview-pager {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 1.5rem 0;
  justify-content: center;
  padding: 1rem;
  background: var(--color-bg);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.export-preview-pager button {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  border-radius: 3rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 80px;
}

.export-preview-pager button:hover:not(:disabled) {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.export-preview-pager button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
}

.export-preview-pager span {
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  color: white;
  border-radius: 3rem;
  font-weight: 600;
  font-size: 0.875rem;
}

.export-preview-filter-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  border-radius: 3rem;
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.export-preview-filter-selector label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.export-preview-filter-selector select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 2rem;
  background: var(--color-bg);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.export-preview-filter-selector select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.export-preview-filter-selector select:hover {
  border-color: var(--color-primary);
}

.export-preview-page-size-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  border-radius: 3rem;
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.export-preview-page-size-selector label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.export-preview-page-size-selector select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 2rem;
  background: var(--color-bg);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.export-preview-page-size-selector select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.export-preview-page-size-selector select:hover {
  border-color: var(--color-primary);
}

/* Settings Tab Styles */
.settings-content {
  max-width: 1000px;
  margin: 0 auto;
}

.settings-section {
  background: var(--color-bg);
  border-radius: 3rem;
  padding: 3rem;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.settings-section h2 {
  margin: 0 0 1.5rem 0;
  color: var(--color-text);
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.settings-info {
  color: #64748b;
  margin-bottom: 2rem;
  line-height: 1.7;
  font-size: 1.1rem;
}

.settings-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin-bottom: 3rem;
}

.settings-actions {
  border-top: 2px solid var(--color-border);
  padding-top: 2rem;
}

.action-group {
  margin-bottom: 2rem;
}

.offline-mode-frame {
  border: 2px solid var(--color-primary);
  border-radius: 2rem;
  padding: 2rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(37, 99, 235, 0.05) 100%);
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.1);
}

.appearance-settings-frame {
  border: 2px solid var(--color-primary);
  border-radius: 2rem;
  padding: 2rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(37, 99, 235, 0.05) 100%);
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.1);
}

.offline-mode-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.nuclear-option-section {
  border: 3px solid #dc2626;
  border-radius: 2rem;
  padding: 2rem;
  background: linear-gradient(135deg, rgba(220, 38, 38, 0.05) 0%, rgba(185, 28, 28, 0.05) 100%);
  box-shadow: 0 0 20px rgba(220, 38, 38, 0.2);
  margin-bottom: 2rem;
}

.ultimate-nuclear-section {
  border: 3px solid #7c2d12;
  border-radius: 2rem;
  padding: 2rem;
  background: linear-gradient(135deg, rgba(124, 45, 18, 0.05) 0%, rgba(220, 38, 38, 0.05) 100%);
  box-shadow: 0 0 20px rgba(124, 45, 18, 0.3);
  margin-bottom: 2rem;
}

.action-group h3 {
  margin: 0 0 1rem 0;
  color: var(--color-text);
  font-size: 1.25rem;
  font-weight: 700;
}

/* Ensure Offline Mode Settings heading is always visible */
.offline-mode-frame h3 {
  color: var(--color-text) !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* Dark mode specific styling for better contrast */
.dark-mode .offline-mode-frame h3 {
  color: #ffffff !important;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* Vercel notice styling */
.vercel-notice {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
  border-radius: 1rem;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.vercel-icon {
  font-size: 1.25rem;
}

.vercel-text {
  font-size: 1rem;
}

.action-description {
  color: #64748b;
  margin-bottom: 1.5rem;
  line-height: 1.6;
  font-size: 1rem;
}

.danger-button {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  color: white;
  border: none;
  border-radius: 3rem;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.danger-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.danger-button:hover::before {
  opacity: 1;
}

.danger-button:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
  background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
}

.danger-button:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.ultimate-danger {
  background: linear-gradient(135deg, #7c2d12 0%, #dc2626 50%, #b91c1c 100%);
  animation: pulse-danger 2s infinite;
}

.ultimate-danger:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626 0%, #7c2d12 50%, #991b1b 100%);
  animation: pulse-danger-fast 1s infinite;
}

@keyframes pulse-danger {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}

@keyframes pulse-danger-fast {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

 .danger-icon {
   font-size: 1.25rem;
 }

/* Cache Management Styles */
.cache-management-section {
  border: 2px solid #f59e0b;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  margin: 25px 0;
  padding: 25px;
}

.cache-management-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #f59e0b, #d97706, #f59e0b);
  background-size: 200% 100%;
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.cache-stats {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.08) 100%);
  border-radius: 12px;
  padding: 25px;
  margin: 25px 0;
  border: 1px solid rgba(245, 158, 11, 0.2);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);
}

.cache-stats p {
  margin: 0 0 20px 0;
  font-weight: 600;
  color: #92400e;
  font-size: 18px;
}

.cache-stats ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
}

.cache-stats li {
  margin: 12px 0;
  font-family: 'Courier New', monospace;
  font-size: 15px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 8px;
  border-left: 4px solid #f59e0b;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s ease;
}

.cache-stats li:hover {
  background: rgba(255, 255, 255, 0.95);
  transform: translateX(2px);
}

.cache-stats li::before {
  content: '📊';
  margin-right: 12px;
  font-size: 16px;
}

.warning-button {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  border: none;
  padding: 16px 32px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  margin: 15px 8px;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  position: relative;
  overflow: hidden;
  font-size: 15px;
}

.warning-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.warning-button:hover::before {
  left: 100%;
}

.warning-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
}

.warning-button:active {
  transform: translateY(-1px);
}

.warning-icon {
  margin-right: 10px;
  font-size: 16px;
}

.cache-hint {
  font-size: 15px;
  color: #92400e;
  font-style: italic;
  margin-top: 20px;
  padding: 16px;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 10px;
  border-left: 4px solid #f59e0b;
  line-height: 1.5;
}

.cache-hint strong {
  color: #78350f;
}

.button-group {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin: 20px 0;
}

.button-group .warning-button,
.button-group .primary-button {
  flex: 1;
  min-width: 220px;
}

/* Google API Health Check Styles */
.google-api-section {
  border: 2px solid #3b82f6;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  margin: 25px 0;
  padding: 25px;
}

.google-api-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #3b82f6, #2563eb, #3b82f6);
  background-size: 200% 100%;
  animation: shimmer 2s ease-in-out infinite;
}

.api-status {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%);
  border-radius: 12px;
  padding: 25px;
  margin: 25px 0;
  border: 1px solid rgba(59, 130, 246, 0.2);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}

.api-status p {
  margin: 0 0 20px 0;
  font-weight: 600;
  color: #1e40af;
  font-size: 18px;
}

.api-status ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
}

.api-status li {
  margin: 12px 0;
  font-family: 'Courier New', monospace;
  font-size: 15px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 8px;
  border-left: 4px solid #3b82f6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s ease;
}

.api-status li:hover {
  background: rgba(255, 255, 255, 0.95);
  transform: translateX(2px);
}

.api-status li::before {
  content: '🔧';
  margin-right: 12px;
  font-size: 16px;
}

.status-ok {
  color: #059669;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(5, 150, 105, 0.2);
  padding: 2px 8px;
  background: rgba(5, 150, 105, 0.1);
  border-radius: 4px;
  border: 1px solid rgba(5, 150, 105, 0.2);
}

.status-error {
  color: #dc2626;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(220, 38, 38, 0.2);
  padding: 2px 8px;
  background: rgba(220, 38, 38, 0.1);
  border-radius: 4px;
  border: 1px solid rgba(220, 38, 38, 0.2);
}

.primary-button {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  border: none;
  padding: 16px 32px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  margin: 15px 0;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  position: relative;
  overflow: hidden;
  font-size: 15px;
}

.primary-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.primary-button:hover::before {
  left: 100%;
}

.primary-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
}

.primary-button:active {
  transform: translateY(-1px);
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.primary-button:disabled::before {
  display: none;
}

.primary-icon {
  margin-right: 10px;
  font-size: 16px;
}

.error-message {
  color: #dc2626;
  font-size: 14px;
  margin-top: 15px;
  padding: 15px;
  background: linear-gradient(135deg, rgba(220, 38, 38, 0.1) 0%, rgba(220, 38, 38, 0.05) 100%);
  border-radius: 8px;
  border-left: 4px solid #dc2626;
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.1);
}

.error-message strong {
  color: #991b1b;
}

.api-hint {
  font-size: 15px;
  color: #1e40af;
  font-style: italic;
  margin-top: 20px;
  padding: 16px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 10px;
  border-left: 4px solid #3b82f6;
  line-height: 1.5;
}

.api-hint strong {
  color: #1e3a8a;
}

/* No Reference Image Styles */
.no-reference-image {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
  background: linear-gradient(135deg, rgba(156, 163, 175, 0.1) 0%, rgba(156, 163, 175, 0.05) 100%);
  border-radius: 12px;
  border: 2px dashed rgba(156, 163, 175, 0.3);
  margin: 20px 0;
}

.no-image-placeholder {
  text-align: center;
  padding: 40px 20px;
  max-width: 400px;
}

.no-image-icon {
  font-size: 48px;
  margin-bottom: 20px;
  opacity: 0.6;
}

.no-image-text strong {
  display: block;
  font-size: 18px;
  color: #374151;
  margin-bottom: 10px;
  font-weight: 600;
}

.no-image-text p {
  margin: 8px 0;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.5;
}

.no-image-hint {
  font-size: 12px !important;
  color: #9ca3af !important;
  font-style: italic;
  margin-top: 15px !important;
}

.debug-info {
  font-size: 11px !important;
  color: #6b7280 !important;
  font-family: 'Courier New', monospace !important;
  background: rgba(156, 163, 175, 0.1) !important;
  padding: 8px !important;
  border-radius: 4px !important;
  margin-top: 10px !important;
  border: 1px solid rgba(156, 163, 175, 0.2) !important;
}

/* Import Success Notification Styles */
.import-success-notification {
  margin: 20px 0;
  padding: 15px;
  background: linear-gradient(135deg, #10b981, #059669);
  border-radius: 8px;
  color: white;
}

.success-message {
  display: flex;
  align-items: flex-start;
  gap: 15px;
}

.success-icon {
  font-size: 24px;
  margin-top: 2px;
}

.success-text {
  flex: 1;
}

.success-text strong {
  font-size: 16px;
  margin-bottom: 5px;
  display: block;
}

.success-text p {
  margin: 5px 0 15px 0;
  opacity: 0.9;
}

.view-data-btn {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s ease;
}

.view-data-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.clear-notice {
  margin: 10px 0;
  padding: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  border-left: 4px solid #fbbf24;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.notice-icon {
  font-size: 16px;
  margin-top: 2px;
}

.clear-notice strong {
  color: #fbbf24;
  font-weight: 600;
}

 .cache-stats-display {
   display: grid;
   grid-template-columns: repeat(2, 1fr);
   gap: 1rem;
   margin-top: 1rem;
   padding: 1rem;
   background: var(--color-bg-primary);
   border-radius: 1rem;
   border: 1px solid var(--color-border);
   max-height: 300px;
   overflow-y: auto;
 }

 .cache-stat {
   display: flex;
   justify-content: space-between;
   align-items: center;
   padding: 0.5rem;
 }

 .cache-label {
   font-weight: 600;
   color: var(--color-text-secondary);
   font-size: 0.9rem;
 }

 .cache-value {
   font-weight: 700;
   color: var(--color-primary);
   font-size: 0.9rem;
 }

 .secondary-button {
   background: linear-gradient(135deg, #64748b 0%, #475569 100%);
   color: white;
   border: none;
   border-radius: 2rem;
   padding: 0.75rem 1.5rem;
   font-size: 1rem;
   font-weight: 600;
   cursor: pointer;
   transition: all 0.3s ease;
   display: inline-flex;
   align-items: center;
   gap: 0.5rem;
   box-shadow: var(--shadow-sm);
 }

 .secondary-button:hover {
   transform: translateY(-2px);
   box-shadow: var(--shadow-md);
   background: linear-gradient(135deg, #475569 0%, #334155 100%);
 }

 .button-icon {
   font-size: 1rem;
 }

 /* Dark Mode Toggle Button */
 .setting-item {
   display: flex;
   align-items: center;
   justify-content: space-between;
   padding: 1.5rem;
   background: var(--color-bg-secondary);
   border-radius: 2rem;
   border: 2px solid var(--color-border);
   margin-bottom: 1rem;
   transition: all 0.3s ease;
 }

 .setting-item.has-input-group {
   flex-direction: column;
   align-items: stretch;
 }

 .setting-item:hover {
   border-color: var(--color-primary);
   transform: translateY(-2px);
   box-shadow: var(--shadow-md);
 }

 .setting-info h4 {
   margin: 0 0 0.5rem 0;
   font-size: 1.1rem;
   font-weight: 700;
   color: var(--color-text);
 }

 .setting-info p {
   margin: 0;
   color: var(--color-text-secondary);
   line-height: 1.5;
 }

 .input-group {
   display: block;
   margin-top: 1rem;
   margin-left: 1rem;
   margin-right: 3rem;
 }

 .path-input {
   width: 100%;
   padding: 0.75rem 1rem;
   border: 2px solid var(--color-border);
   border-radius: 1.5rem;
   font-size: 1rem;
   background: var(--color-bg);
   color: var(--color-text);
   transition: all 0.3s ease;
 }

 .path-input:focus {
   outline: none;
   border-color: var(--color-primary);
   box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
 }

 .save-button {
   background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
   color: white;
   border: none;
   border-radius: 1.5rem;
   padding: 0.75rem 1.5rem;
   font-size: 1rem;
   font-weight: 600;
   cursor: pointer;
   transition: all 0.3s ease;
   display: inline-flex;
   align-items: center;
   gap: 0.5rem;
   box-shadow: var(--shadow-sm);
 }

 .save-button:hover {
   transform: translateY(-2px);
   box-shadow: var(--shadow-md);
   background: linear-gradient(135deg, var(--color-primary-2) 0%, var(--color-primary) 100%);
 }

 .browse-button {
  background: var(--color-bg);
  color: var(--color-text);
  border: 2px solid var(--color-success);
  border-radius: 1.5rem;
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: var(--shadow-sm);
}

 .browse-button:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  background: var(--color-success);
  color: white;
}

  .setting-hint {
   margin-top: 1rem;
   font-size: 0.9rem;
   color: var(--color-text-secondary);
   line-height: 1.5;
   background: var(--color-bg-secondary);
   padding: 1rem;
   border-radius: var(--radius-lg);
   border: 1px solid var(--color-border-light);
 }

 .setting-hint p {
   margin: 0 0 0.75rem 0;
   font-weight: 600;
   color: var(--color-text);
 }

 .setting-hint ul {
   margin: 0;
   padding-left: 1.5rem;
 }

 .setting-hint li {
   margin-bottom: 0.5rem;
 }

 .setting-hint code {
   background: var(--color-bg);
   padding: 0.2rem 0.4rem;
   border-radius: var(--radius-sm);
   font-family: 'Courier New', monospace;
   font-size: 0.85rem;
   color: var(--color-primary);
   border: 1px solid var(--color-border);
 }

 .toggle-button {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border: 2px solid var(--color-primary);
  border-radius: 2rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  background: var(--color-bg);
  color: var(--color-text);
  box-shadow: var(--shadow-md);
}

.toggle-button:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  background: var(--color-primary);
  color: white;
}

.toggle-button.active {
  background: var(--color-success);
  color: white;
  border-color: var(--color-success);
}

/* Special styling for offline mode - black background */
.offline-mode-frame .toggle-button.active {
  background: #000000 !important;
  color: white !important;
  border-color: #000000 !important;
}



 .toggle-icon {
   font-size: 1.25rem;
   position: relative;
   z-index: 1;
 }

 .toggle-text {
   position: relative;
   z-index: 1;
 }

 /* Analytics Tab Styles */
 .analytics-content {
   max-width: 1200px;
   margin: 0 auto;
 }

 .analytics-section {
   background: var(--color-bg);
   border-radius: 3rem;
   padding: 3rem;
   box-shadow: var(--shadow-lg);
   border: 1px solid var(--color-border);
   transition: all 0.3s ease;
   margin-bottom: 2rem;
 }

 .analytics-section h2 {
   font-size: 2rem;
   font-weight: 700;
   margin: 0 0 1rem 0;
   color: var(--color-text);
   text-align: center;
 }

 .analytics-description {
   text-align: center;
   color: var(--color-text-secondary);
   margin-bottom: 2rem;
   font-size: 1.1rem;
 }

 .analytics-stats {
   display: grid;
   grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
   gap: 1.5rem;
   margin-bottom: 2rem;
 }

 /* About Tab Styles */
 .about-content {
   max-width: 1200px;
   margin: 0 auto;
 }

 .about-section {
  background: var(--color-bg);
  border-radius: 3rem;
  padding: 3rem;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

 .hero-section {
  text-align: center;
  margin-bottom: 4rem;
  padding: 3rem 0;
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border-radius: 3rem;
  border: 2px solid var(--color-primary);
  transition: all 0.3s ease;
}

 .hero-icon {
   margin-bottom: 1rem;
   animation: float 3s ease-in-out infinite;
   color: var(--color-primary);
 }

 @keyframes float {
   0%, 100% { transform: translateY(0px); }
   50% { transform: translateY(-10px); }
 }

 .hero-title {
   font-size: 3rem;
   font-weight: 800;
   margin: 0 0 1rem 0;
   background: linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #06b6d4 100%);
   -webkit-background-clip: text;
   -webkit-text-fill-color: transparent;
   background-clip: text;
   text-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
 }

 .hero-subtitle {
   font-size: 1.25rem;
   color: var(--color-text-secondary);
   margin: 0;
   font-weight: 500;
   font-style: italic;
 }

 .praise-grid {
   display: grid;
   grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
   gap: 2rem;
   margin-bottom: 4rem;
 }

 .praise-card {
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border: 2px solid var(--color-border);
  border-radius: 2rem;
  padding: 2rem;
  text-align: center;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

 .praise-card::before {
   content: '';
   position: absolute;
   top: 0;
   left: 0;
   right: 0;
   bottom: 0;
   background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0) 100%);
   opacity: 0;
   transition: opacity 0.3s ease;
 }

 .praise-card:hover::before {
   opacity: 1;
 }

 .praise-card:hover {
   transform: translateY(-8px);
   box-shadow: var(--shadow-lg);
   border-color: var(--color-primary);
 }

 .praise-icon {
   margin-bottom: 1rem;
   animation: bounce 2s ease-in-out infinite;
   color: var(--color-primary);
 }

 @keyframes bounce {
   0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
   40% { transform: translateY(-10px); }
   60% { transform: translateY(-5px); }
 }

 .praise-card h3 {
   font-size: 1.5rem;
   font-weight: 700;
   margin: 0 0 1rem 0;
   color: var(--color-text);
   position: relative;
   z-index: 1;
 }

 .praise-card p {
   color: var(--color-text-secondary);
   line-height: 1.7;
   margin: 0;
   font-size: 1rem;
   position: relative;
   z-index: 1;
 }

 .achievement-section {
  margin-bottom: 4rem;
  padding: 2rem;
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border-radius: 2rem;
  border: 2px solid var(--color-primary);
  transition: all 0.3s ease;
}

 .achievement-section h2 {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 2rem 0;
  color: var(--color-text);
}

 .achievement-list {
   display: grid;
   grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
   gap: 1rem;
 }

 .achievement-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 1rem;
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
}

.dark-mode .achievement-item {
  background: rgba(30, 41, 59, 0.9);
}

 .achievement-item:hover {
   transform: translateX(5px);
   box-shadow: var(--shadow-md);
   background: rgba(255, 255, 255, 0.95);
 }

.dark-mode .achievement-item:hover {
  background: rgba(30, 41, 59, 1);
}

 .achievement-badge {
   flex-shrink: 0;
   color: var(--color-primary);
 }

 .achievement-item span:last-child {
  font-weight: 500;
  color: var(--color-text);
}

 .quote-section {
  text-align: center;
  margin-bottom: 4rem;
  padding: 3rem;
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border-radius: 2rem;
  border: 2px solid var(--color-primary);
  transition: all 0.3s ease;
}

 .hero-quote {
  font-size: 1.5rem;
  font-style: italic;
  color: var(--color-text);
  margin: 0 0 1rem 0;
  font-weight: 600;
  line-height: 1.6;
}

.quote-author {
  font-size: 1rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}

 .stats-section {
   text-align: center;
 }

 .stats-section h2 {
   font-size: 2rem;
   font-weight: 700;
   margin: 0 0 2rem 0;
   color: var(--color-text);
 }

 .impact-stats {
   display: grid;
   grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
   gap: 2rem;
 }

 .impact-stat {
  background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-border-light) 100%);
  border: 2px solid var(--color-border);
  border-radius: 2rem;
  padding: 2rem;
  transition: all 0.3s ease;
}

 .impact-stat:hover {
   transform: translateY(-5px);
   box-shadow: var(--shadow-lg);
   border-color: var(--color-primary);
 }

 .impact-stat .stat-number {
   font-size: 3rem;
   font-weight: 800;
   color: var(--color-primary);
   margin-bottom: 0.5rem;
   line-height: 1;
   display: flex;
   align-items: center;
   justify-content: center;
   gap: 0.5rem;
 }

 .impact-stat .stat-label {
   font-size: 0.875rem;
   color: var(--color-text-secondary);
   font-weight: 600;
   text-transform: uppercase;
   letter-spacing: 0.05em;
 }

/* Image Preview Modal Styles */
.image-preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease-out;
}

.preview-content {
  background: var(--color-bg);
  border-radius: 1rem;
  padding: 1.5rem;
  max-width: 90vw;
  max-height: 90vh;
  box-shadow: var(--shadow-xl);
  border: 2px solid var(--color-border);
  position: relative;
  animation: scaleIn 0.2s ease-out;
}

.preview-content img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 0.5rem;
  display: block;
}

.preview-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--color-bg-secondary);
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.preview-id {
  color: var(--color-text);
}

.preview-score {
  color: var(--color-primary);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes scaleIn {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* Dark mode adjustments for preview modal */
.dark-mode .preview-content {
  background: var(--color-bg-dark);
  border-color: var(--color-border-dark);
}

.dark-mode .preview-info {
  background: var(--color-bg-secondary-dark);
}

/* Import Tab Styles */
.import-content {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.import-section {
  background: white;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.import-section h2 {
  color: #2c3e50;
  margin-bottom: 10px;
  text-align: center;
}

.import-section .description {
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

.progress-fill.active {
  background: linear-gradient(90deg, #3498db, #2980b9, #3498db);
  background-size: 200% 100%;
  animation: progress-pulse 2s ease-in-out infinite;
}

@keyframes progress-pulse {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.processing-indicator {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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

/* Dark mode adjustments for import */
.dark-mode .import-section {
  background: var(--color-bg-dark);
  color: var(--color-text-dark);
}

.dark-mode .upload-area {
  background: var(--color-bg-secondary-dark);
  border-color: var(--color-border-dark);
}

.dark-mode .import-options,
.dark-mode .results-section,
.dark-mode .database-status {
  background: var(--color-bg-secondary-dark);
}

.dark-mode .stat-item {
  background: var(--color-bg-dark);
}

.dark-mode .option-group select {
  background: var(--color-bg-dark);
  color: var(--color-text-dark);
  border-color: var(--color-border-dark);
}

/* Backup Content Styles */
.backup-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.backup-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 2rem;
  margin: 2rem 0;
}

.backup-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  padding: 2rem;
  text-align: center;
  transition: all 0.3s ease;
}

.backup-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-primary);
}

.backup-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  border-radius: 1rem;
  margin-bottom: 1rem;
  color: white;
}

.backup-card h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 0.5rem 0;
}

.backup-card p {
  color: var(--color-text-secondary);
  margin: 0 0 1.5rem 0;
  line-height: 1.5;
}

.backup-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin: 0.25rem;
}

.backup-btn.export {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.backup-btn.export:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3);
}

.backup-btn.import {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
}

.backup-btn.import:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
}

.backup-btn.restore {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
}

.backup-btn.restore:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(245, 158, 11, 0.3);
}

.backup-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.selected-file {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin: 1rem 0;
  font-size: 0.875rem;
  color: var(--color-text);
}

.backup-info {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  padding: 1.5rem;
  margin: 2rem 0;
}

.backup-info h3 {
  color: var(--color-text);
  margin: 0 0 1rem 0;
  font-size: 1.125rem;
}

.backup-info ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.backup-info li {
  padding: 0.5rem 0;
  color: var(--color-text-secondary);
  position: relative;
  padding-left: 1.5rem;
}

.backup-info li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--color-primary);
  font-weight: bold;
}

.backup-progress {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  padding: 1.5rem;
  margin: 2rem 0;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: var(--color-border);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-2) 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.backup-progress p {
  color: var(--color-text);
  margin: 0;
  font-weight: 500;
}
</style>


