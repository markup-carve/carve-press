import type { CarveExtension } from '@markup-carve/carve'
import { BuildError } from './errors.js'
import type { BuildEventBus } from './events.js'
import { searchIndex, type SearchIndexOptions } from './extensions/search-index.js'

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

export interface ShikiConfig {
  langs: string[]
  themes: { light: string; dark: string }
}

export interface ThemeAssetsConfig {
  css?: string
}

export type SearchConfig = false | Required<SearchIndexOptions>

export interface CarvePressConfig {
  title: string
  description?: string
  base: string
  srcDir: string
  outDir: string
  publicDir: string
  srcExclude: string[]
  cleanUrls: boolean
  ignoreDeadLinks: boolean
  head: HeadTag[]
  theme: ThemeAssetsConfig
  themeConfig: ThemeConfig
  carve: { extensions: CarveExtension[]; profile?: string }
  shiki: ShikiConfig
  search: SearchConfig
  extensions: SiteExtension[]
}

export type UserConfig = Partial<
  Omit<CarvePressConfig, 'title' | 'theme' | 'themeConfig' | 'carve' | 'shiki' | 'search'>
> & {
  title: string
  theme?: Partial<ThemeAssetsConfig>
  themeConfig?: Partial<ThemeConfig>
  carve?: Partial<CarvePressConfig['carve']>
  shiki?: Partial<Omit<ShikiConfig, 'themes'>> & { themes?: Partial<ShikiConfig['themes']> }
  search?: false | SearchIndexOptions
}

const DEFAULT_SHIKI: ShikiConfig = {
  langs: [
    'carve',
    'html',
    'bash',
    'php',
    'ts',
    'js',
    'go',
    'python',
    'rust',
    'json',
    'yaml',
    'toml',
    'md',
    'txt',
    'diff',
    'css',
    'sql',
    'xml',
  ],
  themes: { light: 'github-light', dark: 'github-dark' },
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
  const search: SearchConfig =
    user.search === false
      ? false
      : {
          filename: user.search?.filename ?? 'search-index.json',
          exclude: user.search?.exclude ?? [],
        }
  return {
    title: user.title,
    description: user.description,
    base: normalizeBase(user.base ?? '/'),
    srcDir: user.srcDir ?? 'docs',
    outDir: user.outDir ?? 'dist',
    publicDir: user.publicDir ?? 'public',
    srcExclude: user.srcExclude ?? [],
    cleanUrls: user.cleanUrls ?? true,
    ignoreDeadLinks: user.ignoreDeadLinks ?? false,
    head: user.head ?? [],
    theme: user.theme?.css === undefined ? {} : { css: user.theme.css },
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
    shiki: {
      langs: user.shiki?.langs ?? DEFAULT_SHIKI.langs,
      themes: {
        light: user.shiki?.themes?.light ?? DEFAULT_SHIKI.themes.light,
        dark: user.shiki?.themes?.dark ?? DEFAULT_SHIKI.themes.dark,
      },
    },
    search,
    extensions: [...(search === false ? [] : [searchIndex(search)]), ...(user.extensions ?? [])],
  }
}
