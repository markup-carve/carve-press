import type { CarveExtension } from '@markup-carve/carve'
import { BuildError } from './errors.js'
import type { BuildEventBus } from './events.js'

export type HeadTag = [tag: string, attrs: Record<string, string>]

export interface NavItem {
  text: string
  link?: string
  items?: NavItem[]
}

export interface SidebarItem {
  text: string
  link?: string
  items?: SidebarItem[]
}

export interface SidebarGroup {
  text: string
  collapsed?: boolean
  items: SidebarItem[]
}

export interface SocialLink {
  icon: string
  link: string
}

export interface ThemeConfig {
  nav: NavItem[]
  /** Path-keyed: the longest matching key prefix wins for a given route. */
  sidebar: Record<string, SidebarGroup[]>
  socialLinks: SocialLink[]
  editLink?: { pattern: string; text: string }
  footer?: { message: string; copyright: string }
  outline: { level: [number, number] }
}

/** A site-level extension: it subscribes to build events and writes derived files. */
export interface SiteExtension {
  name: string
  setup(bus: BuildEventBus): void
}

export interface CarvePressConfig {
  title: string
  description?: string
  base: string
  srcDir: string
  outDir: string
  srcExclude: string[]
  cleanUrls: boolean
  ignoreDeadLinks: boolean
  head: HeadTag[]
  themeConfig: ThemeConfig
  carve: { extensions: CarveExtension[]; profile?: string }
  extensions: SiteExtension[]
}

export type UserConfig = Partial<Omit<CarvePressConfig, 'title' | 'themeConfig' | 'carve'>> & {
  title: string
  themeConfig?: Partial<ThemeConfig>
  carve?: Partial<CarvePressConfig['carve']>
}

/** Identity function; exists so a config file gets type checking and completion. */
export function defineConfig(config: UserConfig): UserConfig {
  return config
}

/**
 * A base is concatenated into every emitted URL, so the four ways a user might
 * write it must collapse to one form before anything reads it.
 */
function normalizeBase(base: string): string {
  const trimmed = base.replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

export function resolveConfig(user: UserConfig): CarvePressConfig {
  if (!user || typeof user.title !== 'string' || user.title === '') {
    throw new BuildError('config: title is required')
  }
  return {
    title: user.title,
    description: user.description,
    base: normalizeBase(user.base ?? '/'),
    srcDir: user.srcDir ?? 'docs',
    outDir: user.outDir ?? 'dist',
    srcExclude: user.srcExclude ?? [],
    cleanUrls: user.cleanUrls ?? true,
    ignoreDeadLinks: user.ignoreDeadLinks ?? false,
    head: user.head ?? [],
    themeConfig: {
      nav: user.themeConfig?.nav ?? [],
      sidebar: user.themeConfig?.sidebar ?? {},
      socialLinks: user.themeConfig?.socialLinks ?? [],
      editLink: user.themeConfig?.editLink,
      footer: user.themeConfig?.footer,
      outline: user.themeConfig?.outline ?? { level: [2, 3] },
    },
    carve: {
      extensions: user.carve?.extensions ?? [],
      profile: user.carve?.profile,
    },
    extensions: user.extensions ?? [],
  }
}
