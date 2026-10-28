import { app, shell, BrowserWindow, ipcMain, protocol, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import Database from 'better-sqlite3'
import fs from 'fs'
import zlib from 'zlib'
import { fromArrayBuffer } from 'geotiff'

// Папка для хранения архивов полетов в "Документах" пользователя
const archiveDir = join(app.getPath('documents'), 'UAV_Archive')
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true })
}

// Файл сохранения пользовательских настроек путей (в AppData)
const configPath = join(app.getPath('userData'), 'user-paths.json')

interface UserPathsConfig {
  mbtilesPath?: string
  demDirPath?: string
}

function loadPathsConfig(): UserPathsConfig {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (e) {
    console.error('[ERROR] Failed to read user-paths.json:', e)
  }
  return {}
}

function savePathsConfig(cfg: UserPathsConfig): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (e) {
    console.error('[ERROR] Failed to save user-paths.json:', e)
  }
}

// Универсальный поиск ресурсов по умолчанию
function resolveResourcePath(relativeName: string): string | null {
  const candidates = [
    join(__dirname, '../../', relativeName),
    join(process.resourcesPath, relativeName),
    join(app.getAppPath(), relativeName),
    join(process.cwd(), relativeName)
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

let db: Database.Database | null = null
let tileStmt: Database.Statement | null = null
let currentMbtilesPath: string | null = null
let currentDemDir: string | null = null

interface CachedDemTile {
  key: string
  width: number
  height: number
  data: Float32Array | Int16Array
}
const demMainCache = new Map<string, CachedDemTile>()

// Функция подключения/переподключения файла карты .mbtiles
function initMbTiles(filePath: string | null): boolean {
  if (!filePath || !fs.existsSync(filePath)) return false
  try {
    if (db) {
      try {
        db.close()
      } catch {}
    }
    db = new Database(filePath, { readonly: true, fileMustExist: true })
    tileStmt = db.prepare(
      'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
    )
    currentMbtilesPath = filePath
    console.log('[OK] MBTiles connected:', filePath)
    return true
  } catch (e) {
    console.error('[ERROR] Failed to open mbtiles:', e)
    db = null
    tileStmt = null
    return false
  }
}

// Функция подключения/переподключения папки высот DEM
function initDemDir(dirPath: string | null): boolean {
  if (!dirPath || !fs.existsSync(dirPath)) return false
  try {
    const stat = fs.statSync(dirPath)
    if (stat.isDirectory()) {
      currentDemDir = dirPath
      demMainCache.clear() // Очищаем кэш старых высот
      console.log('[OK] DEM directory connected:', dirPath)
      return true
    }
  } catch (e) {
    console.error('[ERROR] Failed to set DEM dir:', e)
  }
  return false
}

// Инициализация путей при старте (сначала проверяем сохраненные пользователем, иначе дефолтные)
const savedConfig = loadPathsConfig()
if (!initMbTiles(savedConfig.mbtilesPath || null)) {
  initMbTiles(resolveResourcePath('russia.mbtiles'))
}
if (!initDemDir(savedConfig.demDirPath || null)) {
  initDemDir(resolveResourcePath('russia_dem'))
}

const workerFilePath = resolveResourcePath(
  'node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js'
)

function formatDemFilename(latFloor: number, lngFloor: number): string {
  const ns = latFloor >= 0 ? 'N' : 'S'
  const ew = lngFloor >= 0 ? 'E' : 'W'
  const latStr = String(Math.abs(latFloor)).padStart(2, '0')
  const lngStr = String(Math.abs(lngFloor)).padStart(3, '0')
  return `${ns}${latStr}_${ew}${lngStr}.tif`
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'map-tile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // =========================================================
  // IPC КАНАЛЫ ВЫБОРА ПУТЕЙ К КАРТЕ (.mbtiles) И ПАПКЕ ВЫСОТ (DEM)
  // =========================================================
  ipcMain.handle('settings:get-paths', () => {
    return {
      mbtilesPath: currentMbtilesPath,
      demDirPath: currentDemDir
    }
  })

  ipcMain.handle('settings:select-mbtiles', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Выберите файл карты (.mbtiles)',
      defaultPath: currentMbtilesPath || app.getAppPath(),
      filters: [{ name: 'MBTiles Map Database', extensions: ['mbtiles', 'db', 'sqlite'] }],
      properties: ['openFile']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      const ok = initMbTiles(selectedPath)
      if (ok) {
        const cfg = loadPathsConfig()
        savePathsConfig({ ...cfg, mbtilesPath: selectedPath })
      }
    }

    return {
      mbtilesPath: currentMbtilesPath,
      demDirPath: currentDemDir
    }
  })

  ipcMain.handle('settings:select-dem', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Выберите папку с файлами карты высот (DEM .tif)',
      defaultPath: currentDemDir || app.getAppPath(),
      properties: ['openDirectory']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedDir = result.filePaths[0]
      const ok = initDemDir(selectedDir)
      if (ok) {
        const cfg = loadPathsConfig()
        savePathsConfig({ ...cfg, demDirPath: selectedDir })
      }
    }

    return {
      mbtilesPath: currentMbtilesPath,
      demDirPath: currentDemDir
    }
  })

  // =========================================================
  // ЧТЕНИЕ ТАЙЛА ВЫСОТ GeoTIFF
  // =========================================================
  ipcMain.handle('dem:get-tile', async (_, latFloor: number, lngFloor: number) => {
    if (!currentDemDir) return null
    const fileName = formatDemFilename(latFloor, lngFloor)
    const key = `${latFloor}_${lngFloor}`

    if (demMainCache.has(key)) {
      return demMainCache.get(key)!
    }

    const filePath = join(currentDemDir, fileName)
    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const fileBuf = await fs.promises.readFile(filePath)
      const arrayBuffer = fileBuf.buffer.slice(
        fileBuf.byteOffset,
        fileBuf.byteOffset + fileBuf.byteLength
      ) as ArrayBuffer
      const tiff = await fromArrayBuffer(arrayBuffer)
      const image = await tiff.getImage()
      const width = image.getWidth()
      const height = image.getHeight()
      const rasters = await image.readRasters()
      const rawBand = rasters[0] as Float32Array | Int16Array

      const data =
        rawBand instanceof Int16Array || rawBand instanceof Float32Array
          ? rawBand
          : new Float32Array(rawBand as ArrayLike<number>)

      const tileObj: CachedDemTile = { key, width, height, data }

      if (demMainCache.size >= 4) {
        const oldestKey = demMainCache.keys().next().value
        if (oldestKey) demMainCache.delete(oldestKey)
      }
      demMainCache.set(key, tileObj)

      return tileObj
    } catch (e) {
      console.error(`[ERROR] Failed to read DEM file ${fileName}:`, e)
      return null
    }
  })

  // =========================================================
  // ФАЙЛОВЫЙ АРХИВ ПОЛЕТОВ
  // =========================================================
  ipcMain.handle('archive:list', async () => {
    try {
      const files = await fs.promises.readdir(archiveDir)
      const metas: Array<{ id: number; name: string; frameCount: number }> = []
      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          const content = await fs.promises.readFile(join(archiveDir, file), 'utf-8')
          metas.push(JSON.parse(content))
        }
      }
      return metas.sort((a, b) => a.id - b.id)
    } catch (e) {
      console.error('[ERROR] archive:list failed:', e)
      return []
    }
  })

  ipcMain.handle(
    'archive:save',
    async (_, flight: { id: number; name: string; frameCount: number; data: unknown[] }) => {
      try {
        const metaPath = join(archiveDir, `flight_${flight.id}.meta.json`)
        const dataPath = join(archiveDir, `flight_${flight.id}.data.json`)

        await fs.promises.writeFile(
          metaPath,
          JSON.stringify(
            { id: flight.id, name: flight.name, frameCount: flight.frameCount },
            null,
            2
          ),
          'utf-8'
        )
        await fs.promises.writeFile(dataPath, JSON.stringify(flight.data), 'utf-8')
        return true
      } catch (e) {
        console.error('[ERROR] archive:save failed:', e)
        return false
      }
    }
  )

  ipcMain.handle('archive:load', async (_, id: number) => {
    try {
      const dataPath = join(archiveDir, `flight_${id}.data.json`)
      if (!fs.existsSync(dataPath)) return []
      const raw = await fs.promises.readFile(dataPath, 'utf-8')
      return JSON.parse(raw)
    } catch (e) {
      console.error('[ERROR] archive:load failed:', e)
      return []
    }
  })

  ipcMain.handle('archive:delete', async (_, id: number) => {
    try {
      const metaPath = join(archiveDir, `flight_${id}.meta.json`)
      const dataPath = join(archiveDir, `flight_${id}.data.json`)
      if (fs.existsSync(metaPath)) await fs.promises.unlink(metaPath)
      if (fs.existsSync(dataPath)) await fs.promises.unlink(dataPath)
      return true
    } catch (e) {
      console.error('[ERROR] archive:delete failed:', e)
      return false
    }
  })

  ipcMain.handle('archive:open-folder', async () => {
    await shell.openPath(archiveDir)
  })

  // =========================================================
  // ПРОТОКОЛ РАЗДАЧИ ТАЙЛОВ И ВОРКЕРА КАРТЫ
  // =========================================================
  protocol.handle('map-tile', async (request) => {
    const url = new URL(request.url)

    if (url.pathname.endsWith('worker.js') && workerFilePath && fs.existsSync(workerFilePath)) {
      const code = await fs.promises.readFile(workerFilePath)
      return new Response(new Uint8Array(code), {
        headers: {
          'Content-Type': 'application/javascript',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const parts = url.pathname.replace(/^\//, '').split('/')
    if (parts.length >= 3 && tileStmt) {
      const z = parseInt(parts[parts.length - 3], 10)
      const x = parseInt(parts[parts.length - 2], 10)
      const y = (1 << z) - 1 - parseInt(parts[parts.length - 1].replace('.pbf', ''), 10)

      try {
        const row = tileStmt.get(z, x, y) as { tile_data: Buffer } | undefined
        if (row && row.tile_data) {
          let data = row.tile_data
          if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
            data = zlib.unzipSync(data)
          }
          return new Response(new Uint8Array(data), {
            headers: {
              'Content-Type': 'application/x-protobuf',
              'Access-Control-Allow-Origin': '*'
            }
          })
        }
      } catch (error) {
        console.error('[ERROR] Failed to read map tile:', error)
      }
    }

    return new Response(null, { status: 404 })
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (db) db.close()
  if (process.platform !== 'darwin') app.quit()
})