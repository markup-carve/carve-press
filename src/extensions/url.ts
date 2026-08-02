import { withBase } from '../layout/shell.js'

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function routeUrl(base: string, route: string): string {
  return withBase(base, route)
}

export function absoluteRouteUrl(hostname: string, base: string, route: string): string {
  return `${hostname.replace(/\/+$/, '')}${routeUrl(base, route)}`
}
