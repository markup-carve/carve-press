import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CarveExtension } from '@markup-carve/carve'
import type { LanguageRegistration } from '@shikijs/types'
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
  lastUpdated?: boolean
  outline: { level: [number, number] }
}

/** A site-level extension: it subscribes to build events and writes derived files. */
export interface SiteExtension {
  name: string
  setup(bus: BuildEventBus): void
}

export type ShikiLanguage = string | LanguageRegistration

export interface ShikiConfig {
  langs: ShikiLanguage[]
  themes: { light: string; dark: string }
}

export interface ThemeAssetsConfig {
  /** Replaces the built-in theme wholesale. */
  css?: string
  /**
   * Appended after the theme. This is what a site wants when it only needs a
   * few extra rules - pointing `css` at a partial stylesheet silently discards
   * the entire built-in theme, and the build still succeeds.
   */
  extraCss?: string[]
}

export type SearchConfig = false | Required<SearchIndexOptions>

export interface PlaygroundConfig {
  /** Directory of wasm-pack output - carve_wasm.js plus carve_wasm_bg.wasm - copied verbatim. */
  wasmEngine?: string
  /** A self-contained classic script that assigns a global. Copied as-is. */
  mermaid?: string
  chart?: string
}

export interface CarvePressConfig {
  title: string
  description?: string
  hostname?: string
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
  playground: PlaygroundConfig
  extensions: SiteExtension[]
}

export type UserConfig = Partial<
  Omit<CarvePressConfig, 'title' | 'theme' | 'themeConfig' | 'carve' | 'shiki' | 'search' | 'playground'>
> & {
  title: string
  theme?: Partial<ThemeAssetsConfig>
  themeConfig?: Partial<ThemeConfig>
  carve?: Partial<CarvePressConfig['carve']>
  shiki?: Partial<Omit<ShikiConfig, 'themes'>> & { themes?: Partial<ShikiConfig['themes']> }
  search?: false | SearchIndexOptions
  playground?: PlaygroundConfig
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

function shikiLanguageName(lang: ShikiLanguage): string {
  return typeof lang === 'string' ? lang : lang.name
}

function mergeShikiLanguages(defaults: ShikiLanguage[], user: ShikiLanguage[] | undefined): ShikiLanguage[] {
  const merged = new Map<string, ShikiLanguage>()
  for (const lang of [...defaults, ...(user ?? [])]) {
    merged.set(shikiLanguageName(lang), lang)
  }
  return [...merged.values()]
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

function resolvePlaygroundPath(
  root: string | undefined,
  key: keyof PlaygroundConfig,
  value: string | undefined,
  kind: 'directory' | 'file',
): string | undefined {
  if (value === undefined) return undefined
  const resolved = root === undefined ? value : resolve(root, value)
  if (root === undefined) return resolved

  let stats
  try {
    stats = statSync(resolved)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      throw new BuildError(`config playground.${key} does not exist: ${resolved}`)
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new BuildError(`cannot inspect config playground.${key}: ${resolved}`, [reason])
  }

  if (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()) {
    throw new BuildError(`config playground.${key} must be a ${kind}: ${resolved}`)
  }
  return resolved
}

function resolvePlaygroundConfig(
  playground: PlaygroundConfig | undefined,
  root: string | undefined,
): PlaygroundConfig {
  return {
    ...(playground?.wasmEngine === undefined
      ? {}
      : { wasmEngine: resolvePlaygroundPath(root, 'wasmEngine', playground.wasmEngine, 'directory') }),
    ...(playground?.mermaid === undefined
      ? {}
      : { mermaid: resolvePlaygroundPath(root, 'mermaid', playground.mermaid, 'file') }),
    ...(playground?.chart === undefined
      ? {}
      : { chart: resolvePlaygroundPath(root, 'chart', playground.chart, 'file') }),
  }
}

export function resolveConfig(user: UserConfig, root?: string): CarvePressConfig {
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
    hostname: user.hostname,
    base: normalizeBase(user.base ?? '/'),
    srcDir: user.srcDir ?? 'docs',
    outDir: user.outDir ?? 'dist',
    publicDir: user.publicDir ?? 'public',
    srcExclude: user.srcExclude ?? [],
    cleanUrls: user.cleanUrls ?? true,
    ignoreDeadLinks: user.ignoreDeadLinks ?? false,
    head: user.head ?? [],
    theme: {
      ...(user.theme?.css === undefined ? {} : { css: user.theme.css }),
      ...(user.theme?.extraCss === undefined ? {} : { extraCss: user.theme.extraCss }),
    },
    themeConfig: {
      nav: user.themeConfig?.nav ?? [],
      sidebar: user.themeConfig?.sidebar ?? {},
      socialLinks: user.themeConfig?.socialLinks ?? [],
      editLink: user.themeConfig?.editLink,
      footer: user.themeConfig?.footer,
      lastUpdated: user.themeConfig?.lastUpdated,
      outline: user.themeConfig?.outline ?? { level: [2, 3] },
    },
    carve: {
      extensions: user.carve?.extensions ?? [],
      profile: user.carve?.profile,
    },
    shiki: {
      // Additive, not a replacement. Naming one extra language should not cost a
      // site every default it never asked to lose - and the failure is quiet:
      // the build still succeeds, every fence just renders unhighlighted.
      langs: mergeShikiLanguages(DEFAULT_SHIKI.langs, user.shiki?.langs),
      themes: {
        light: user.shiki?.themes?.light ?? DEFAULT_SHIKI.themes.light,
        dark: user.shiki?.themes?.dark ?? DEFAULT_SHIKI.themes.dark,
      },
    },
    search,
    playground: resolvePlaygroundConfig(user.playground, root),
    extensions: [...(search === false ? [] : [searchIndex(search)]), ...(user.extensions ?? [])],
  }
}
