import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createServer, type Server } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)

let mainWindow: BrowserWindow | null = null
let rendererUrl = ''
let staticServer: Server | null = null

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Firebase Auth starts popup sign-in at /__/auth/handler on the configured auth domain. */
function isFirebaseAuthPopup(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname.endsWith('.firebaseapp.com') || url.hostname.endsWith('.web.app')) &&
      url.pathname.startsWith('/__/auth/')
    )
  } catch {
    return false
  }
}

function isInternalUrl(value: string): boolean {
  try {
    return new URL(value).origin === new URL(rendererUrl).origin
  } catch {
    return false
  }
}

function secureFilePath(root: string, requestPath: string): string | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(requestPath)
  } catch {
    return null
  }

  // Prefixing with '.' makes an absolute URL pathname relative to the asset root.
  const candidate = resolve(root, `.${normalize(pathname)}`)
  const normalizedRoot = resolve(root)
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) return null
  return candidate
}

async function findStaticFile(root: string, requestPath: string): Promise<string | null> {
  const candidate = secureFilePath(root, requestPath)
  const fallback = join(root, 'index.html')
  if (!candidate) return null

  try {
    const info = await stat(candidate)
    if (info.isFile()) return candidate
  } catch {
    // A client-side route should resolve to the SPA entry point below.
  }

  try {
    const info = await stat(fallback)
    return info.isFile() ? fallback : null
  } catch {
    return null
  }
}

/**
 * Firebase's browser Auth SDK needs an http(s) origin. Serving the packaged Vite
 * files on loopback avoids file:// OAuth limitations and never exposes the app
 * to the network.
 */
async function startStaticServer(): Promise<string> {
  const assetRoot = resolve(__dirname, '..', 'dist')

  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const filePath = await findStaticFile(assetRoot, url.pathname)

    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    try {
      const body = await readFile(filePath)
      response.writeHead(200, {
        'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
      })
      response.end(body)
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Unable to read application asset')
    }
  })

  await new Promise<void>((resolveServer, rejectServer) => {
    staticServer?.once('error', rejectServer)
    staticServer?.listen(0, '127.0.0.1', () => resolveServer())
  })

  const address = staticServer.address() as AddressInfo | null
  if (!address || typeof address === 'string') throw new Error('Could not start the local desktop server')
  return `http://127.0.0.1:${address.port}`
}

function installWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Firebase needs a child BrowserWindow for Google popup authentication.
    if (isFirebaseAuthPopup(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          parent: window,
          modal: true,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }

    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
}

async function createMainWindow(): Promise<void> {
  if (!rendererUrl) {
    rendererUrl = isDevelopment
      ? process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
      : await startStaticServer()
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f8fb',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  installWindowSecurity(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  await mainWindow.loadURL(rendererUrl)

  if (isDevelopment) mainWindow.webContents.openDevTools({ mode: 'detach' })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('desktop:open-external', async (_event, url: unknown): Promise<boolean> => {
  if (typeof url !== 'string' || !isSafeExternalUrl(url)) return false
  await shell.openExternal(url)
  return true
})

app.whenReady().then(async () => {
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  staticServer?.close()
  staticServer = null
})
