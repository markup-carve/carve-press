import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import type { CarvePressConfig } from './config.js'

export interface ResponseDescriptor {
  status: number
  headers: Record<string, string>
  body: string | Uint8Array
}

export interface StaticRequestOptions {
  cleanUrls: boolean
  injectHtml?: boolean
  /** Normalized site base, as `resolveConfig` produces it (`/` or `/prefix/`). */
  base?: string
}

export interface RunningServer {
  server: Server
  port: number
  host: string
  url: string
  close(): Promise<void>
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

const DEV_RELOAD_SCRIPT = `<script>(()=>{let e;const c=()=>{e=new EventSource('/__carve_press_events');e.addEventListener('reload',()=>location.reload());e.addEventListener('error',()=>{e.close();setTimeout(c,1000)})};c()})()</script>`

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function parsePath(url: string): string | undefined {
  let pathname: string
  try {
    pathname = new URL(url, 'http://carve.press').pathname
  } catch {
    return undefined
  }
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

/**
 * Returns the path relative to the site root, or undefined when the request
 * falls outside the base entirely.
 */
function stripServedBase(pathname: string, base: string): string | undefined {
  if (base === '/') return pathname
  if (pathname === base.slice(0, -1)) return '/'
  if (!pathname.startsWith(base)) return undefined
  return `/${pathname.slice(base.length)}`
}

function injectLiveReload(html: string): string {
  return html.includes('</body>') ? html.replace('</body>', `${DEV_RELOAD_SCRIPT}\n  </body>`) : `${html}${DEV_RELOAD_SCRIPT}`
}

async function fileResponse(path: string, injectHtml: boolean): Promise<ResponseDescriptor> {
  const type = contentType(path)
  let body: string | Uint8Array = await fs.readFile(path)
  if (injectHtml && type.startsWith('text/html')) {
    body = injectLiveReload(Buffer.from(body).toString('utf8'))
  }
  return { status: 200, headers: { 'Content-Type': type }, body }
}

async function existingFile(path: string): Promise<string | undefined> {
  try {
    const info = await fs.stat(path)
    return info.isFile() ? path : undefined
  } catch {
    return undefined
  }
}

export async function mapStaticRequest(
  method: string,
  url: string,
  outDir: string,
  options: StaticRequestOptions,
): Promise<ResponseDescriptor> {
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Method not allowed\n' }
  }

  const requested = parsePath(url)
  if (requested === undefined || requested.includes('\0')) {
    return { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Bad request\n' }
  }

  // Every emitted URL carries the base, so a served path has to shed it again
  // before it means anything under outDir. Without this, a site with a base
  // previews as a wall of 404s while the deployed build is fine.
  const base = options.base ?? '/'
  const pathname = stripServedBase(requested, base)
  if (pathname === undefined) {
    return requested === '/' || `${requested}/` === base
      ? { status: 302, headers: { Location: base }, body: '' }
      : notFoundResponse(resolve(outDir), method, options.injectHtml === true)
  }

  const root = resolve(outDir)
  const candidates: string[] = []
  const direct = resolve(root, `.${pathname}`)
  candidates.push(direct)
  if (pathname.endsWith('/')) {
    candidates.push(resolve(root, `.${pathname}`, 'index.html'))
  } else if (options.cleanUrls && extname(basename(pathname)) === '') {
    candidates.push(resolve(root, `.${pathname}`, 'index.html'))
  }

  for (const candidate of candidates) {
    if (!isInside(root, candidate)) continue
    const path = await existingFile(candidate)
    if (path !== undefined) {
      const response = await fileResponse(path, options.injectHtml === true)
      return method === 'HEAD' ? { ...response, body: '' } : response
    }
  }

  return notFoundResponse(root, method, options.injectHtml === true)
}

async function notFoundResponse(
  root: string,
  method: string,
  injectHtml: boolean,
): Promise<ResponseDescriptor> {
  const notFound = resolve(root, '404.html')
  if (isInside(root, notFound) && (await existingFile(notFound)) !== undefined) {
    const response = await fileResponse(notFound, injectHtml)
    return { ...response, status: 404, body: method === 'HEAD' ? '' : response.body }
  }
  return { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found\n' }
}

function writeDescriptor(res: import('node:http').ServerResponse, descriptor: ResponseDescriptor): void {
  res.writeHead(descriptor.status, descriptor.headers)
  res.end(descriptor.body)
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolveListen, reject) => {
    function onError(error: NodeJS.ErrnoException): void {
      server.off('listening', onListening)
      reject(error)
    }
    function onListening(): void {
      server.off('error', onError)
      const address = server.address()
      resolveListen(typeof address === 'object' && address !== null ? address.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function startStaticServer(opts: {
  outDir: string
  config: CarvePressConfig
  getOutDir?: () => string
  getConfig?: () => CarvePressConfig
  port: number
  host: string
  injectHtml?: boolean
  onEventsRequest?: (res: import('node:http').ServerResponse) => boolean
}): Promise<RunningServer> {
  const server = createServer((req, res) => {
    if (req.url === '/__carve_press_events' && opts.onEventsRequest?.(res) === true) return
    const config = opts.getConfig?.() ?? opts.config
    void mapStaticRequest(req.method ?? 'GET', req.url ?? '/', opts.getOutDir?.() ?? opts.outDir, {
      cleanUrls: config.cleanUrls,
      injectHtml: opts.injectHtml,
      base: config.base,
    })
      .then((descriptor) => writeDescriptor(res, descriptor))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        writeDescriptor(res, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: `${message}\n`,
        })
      })
  })

  let port = opts.port
  // Bounded: a machine where the next 20 ports are all taken is a machine where
  // walking up forever would look exactly like a hang.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const actualPort = await listen(server, port, opts.host)
      return {
        server,
        port: actualPort,
        host: opts.host,
        url: `http://${opts.host}:${actualPort}`,
        close: () =>
          new Promise((resolveClose, reject) => {
            server.close((error) => (error === undefined ? resolveClose() : reject(error)))
          }),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || opts.port === 0) throw error
      if (attempt >= 20) throw error
      port += 1
    }
  }
}
