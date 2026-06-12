import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

interface OpenedFile {
  name: string
  data: Uint8Array
}

// Test harnesses set this to isolate the instance — userData also scopes
// the single-instance lock, so an override avoids colliding with a dev run.
if (process.env.PDFX_USER_DATA) {
  app.setPath('userData', process.env.PDFX_USER_DATA)
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
let pendingOpenPaths: string[] = []

function collectFileArgs(argv: string[]): string[] {
  return argv.filter((arg) => /\.(pdf|pdfx)$/i.test(arg) && existsSync(arg))
}

async function readFiles(paths: string[]): Promise<OpenedFile[]> {
  return Promise.all(
    paths.map(async (p) => ({ name: basename(p), data: new Uint8Array(await readFile(p)) }))
  )
}

async function sendOpenPaths(paths: string[]): Promise<void> {
  if (!mainWindow || paths.length === 0) return
  mainWindow.webContents.send('pdfx:files-opened', await readFiles(paths))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f7f5',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 19 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
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

// macOS: files opened via Finder / file association
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (rendererReady) {
    void sendOpenPaths([path])
  } else {
    pendingOpenPaths.push(path)
  }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    void sendOpenPaths(collectFileArgs(argv.slice(1)))
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.pdfx.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    pendingOpenPaths.push(...collectFileArgs(process.argv.slice(1)))

    ipcMain.handle('pdfx:renderer-ready', async () => {
      rendererReady = true
      const paths = pendingOpenPaths
      pendingOpenPaths = []
      await sendOpenPaths(paths)
    })

    ipcMain.handle('pdfx:choose-save-path', async (_event, defaultName: string) => {
      if (!mainWindow) return null
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export PDFX',
        defaultPath: defaultName,
        filters: [{ name: 'PDFX', extensions: ['pdfx'] }]
      })
      return result.canceled || !result.filePath ? null : result.filePath
    })

    ipcMain.handle('pdfx:write-file', async (_event, path: string, data: Uint8Array) => {
      await writeFile(path, data)
      return basename(path)
    })

    ipcMain.handle('pdfx:open-files', async (): Promise<OpenedFile[]> => {
      if (!mainWindow) return []
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open PDF or PDFX',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'PDF & PDFX', extensions: ['pdf', 'pdfx'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled) return []
      return readFiles(result.filePaths)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
