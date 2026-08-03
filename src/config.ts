import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Profile, type CarveExtension } from '@markup-carve/carve'
import type { LanguageRegistration } from '@shikijs/types'
import { BuildError } from './errors.js'
import type { BuildEventBus } from './events.js'
import { blog, type BlogOptions } from './extensions/blog.js'
import { feed, type FeedOptions } from './extensions/feed.js'
import { redirects } from './extensions/redirects.js'
import { searchIndex, type SearchIndexOptions } from './extensions/search-index.js'
import type { Layout } from './layout/doc.js'

export type HeadTag = [tag: string, attrs: Record<string, string>]
export type CarvePreset = 'minimal' | 'docs' | 'full'

export interface NavItem {
  text: string
  link?: string
  items?: NavItem[]
  current?: boolean
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

export interface GeneratedSidebarGroup {
  text: string
  generate: string
  collapsed?: boolean
  order?: number
}

export type SidebarConfigGroup = SidebarGroup | GeneratedSidebarGroup

export interface SocialLink {
  icon: string | { svg: string }
  link: string
}

export type SubstitutionFormat = 'bold' | 'italic' | 'code' | 'none'
export type SubstitutionConfigValue = string | { value: string; format?: SubstitutionFormat }
export type SubstitutionsConfig = Record<string, SubstitutionConfigValue>
export type NormalizedSubstitution = { value: string; format: SubstitutionFormat }

export type ThemeLogo = string | { light: string; dark: string; alt?: string }

export type OutlineSetting = false | number | [number, number] | 'deep'

export interface ThemeLabels {
  search: string
  previous: string
  next: string
  lastUpdated: string
  onThisPage: string
  pageNotFound: string
  copy: string
  copied: string
  menu: string
  version: string
  versionBanner: string
}

export interface VersionItem {
  text: string
  link: string
  current?: boolean
}

export interface VersionsConfig {
  current: string
  banner?: string
  items: VersionItem[]
}

export interface ThemeConfig {
  nav: NavItem[]
  /** Path-keyed: the longest matching key prefix wins for a given route. */
  sidebar: Record<string, SidebarConfigGroup[]>
  socialLinks: SocialLink[]
  logo?: ThemeLogo
  siteTitle?: string | false
  editLink?: { pattern: string; text: string }
  footer?: { message: string; copyright: string }
  lastUpdated?: boolean
  socialImage?: string
  outline: { level: [number, number] }
  labels: ThemeLabels
  versions?: VersionsConfig
}

export interface LocaleThemeConfig {
  nav?: NavItem[]
  sidebar?: Record<string, SidebarConfigGroup[]>
  footer?: { message: string; copyright: string }
  editLink?: { pattern: string; text: string }
  outline?: { level: OutlineSetting }
  labels?: Partial<ThemeLabels>
  versions?: VersionsConfig
}

export interface LocaleConfig {
  lang: string
  label: string
  title?: string
  description?: string
  themeConfig?: LocaleThemeConfig
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
  lineNumbers: boolean | number
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

export interface DevConfig {
  incremental: boolean
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
  routeManifest: string | false
  head: HeadTag[]
  theme: ThemeAssetsConfig
  themeConfig: ThemeConfig
  carve: { extensions: CarveExtension[]; profile?: Profile; preset: CarvePreset }
  shiki: ShikiConfig
  search: SearchConfig
  blog?: Required<BlogOptions>
  feed: false | Required<FeedOptions>
  redirects: Record<string, string>
  substitutions: Record<string, NormalizedSubstitution>
  playground: PlaygroundConfig
  dev: DevConfig
  extensions: SiteExtension[]
  layouts: Record<string, Layout>
  locales: Record<string, LocaleConfig>
}

export type UserConfig = Partial<
  Omit<CarvePressConfig, 'title' | 'theme' | 'themeConfig' | 'carve' | 'shiki' | 'search' | 'playground'>
> & {
  title: string
  theme?: Partial<ThemeAssetsConfig>
  themeConfig?: Partial<Omit<ThemeConfig, 'labels'>> & { labels?: Partial<ThemeLabels> }
  carve?: { extensions?: CarveExtension[]; profile?: string | Profile; preset?: CarvePreset }
  shiki?: Partial<Omit<ShikiConfig, 'themes'>> & { themes?: Partial<ShikiConfig['themes']> }
  search?: false | SearchIndexOptions
  blog?: BlogOptions
  feed?: false | FeedOptions
  redirects?: Record<string, string>
  substitutions?: SubstitutionsConfig
  layouts?: Record<string, Layout>
  locales?: Record<string, LocaleConfig>
  playground?: PlaygroundConfig
  dev?: Partial<DevConfig>
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
  lineNumbers: false,
}

export const DEFAULT_LABELS: ThemeLabels = {
  search: 'Search',
  previous: 'Previous',
  next: 'Next',
  lastUpdated: 'Last updated',
  onThisPage: 'On this page',
  pageNotFound: 'Page not found',
  copy: 'Copy',
  copied: 'Copied',
  menu: 'Menu',
  version: 'Version',
  versionBanner: '',
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

function resolveProfile(profile: string | Profile | undefined): Profile | undefined {
  if (profile === undefined) return undefined
  if (profile instanceof Profile) return profile.onDisallowed(Profile.ACTION_ERROR)
  const name = profile.toLowerCase()
  const resolved =
    name === 'full'
      ? Profile.full()
      : name === 'article'
        ? Profile.article()
        : name === 'comment'
          ? Profile.comment()
          : name === 'minimal'
            ? Profile.minimal()
            : undefined
  if (resolved === undefined) {
    throw new BuildError(`config: unsupported carve.profile "${profile}"`, [
      'supported profiles: full, article, comment, minimal',
    ])
  }
  return resolved.onDisallowed(Profile.ACTION_ERROR)
}

function normalizeRoute(route: string): string {
  const withLeading = route.startsWith('/') ? route : `/${route}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

function normalizeBlog(blogConfig: BlogOptions | undefined): Required<BlogOptions> | undefined {
  if (blogConfig === undefined) return undefined
  const dir = typeof blogConfig.dir === 'string' ? blogConfig.dir.replace(/^\/+|\/+$/g, '') : ''
  if (dir === '') throw new BuildError('config: blog.dir is required')
  const route = normalizeRoute(blogConfig.route ?? `/${dir}/`)
  return {
    dir,
    route,
    title: blogConfig.title ?? 'Blog',
    description: blogConfig.description ?? '',
    perPage: blogConfig.perPage ?? 10,
    tagsRoute: normalizeRoute(blogConfig.tagsRoute ?? `${route}tags/`),
  }
}

function normalizeFeed(feedConfig: false | FeedOptions | undefined): false | Required<FeedOptions> {
  if (feedConfig === false || feedConfig === undefined) return false
  return {
    filename: feedConfig.filename ?? 'feed.xml',
    title: feedConfig.title ?? '',
    description: feedConfig.description ?? '',
    limit: feedConfig.limit ?? 20,
    type: feedConfig.type ?? 'rss',
  }
}

function normalizeSubstitutions(
  substitutions: SubstitutionsConfig | undefined,
): Record<string, NormalizedSubstitution> {
  if (substitutions === undefined) return {}
  return Object.fromEntries(
    Object.entries(substitutions).map(([key, raw]) => {
      if (typeof raw === 'string') return [key, { value: raw, format: 'none' }]
      return [key, { value: raw.value, format: raw.format ?? 'none' }]
    }),
  )
}

function normalizeLocaleKey(key: string): string {
  const trimmed = key.replace(/^\/+/, '').replace(/\/+$/, '')
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
  const blogConfig = normalizeBlog(user.blog)
  const feedConfig = normalizeFeed(user.feed)
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
    routeManifest: user.routeManifest ?? 'routes.json',
    head: user.head ?? [],
    theme: {
      ...(user.theme?.css === undefined ? {} : { css: user.theme.css }),
      ...(user.theme?.extraCss === undefined ? {} : { extraCss: user.theme.extraCss }),
    },
    themeConfig: {
      nav: user.themeConfig?.nav ?? [],
      sidebar: user.themeConfig?.sidebar ?? {},
      socialLinks: user.themeConfig?.socialLinks ?? [],
      logo: user.themeConfig?.logo,
      siteTitle: user.themeConfig?.siteTitle,
      editLink: user.themeConfig?.editLink,
      footer: user.themeConfig?.footer,
      lastUpdated: user.themeConfig?.lastUpdated,
      socialImage: user.themeConfig?.socialImage,
      outline: user.themeConfig?.outline ?? { level: [2, 3] },
      labels: { ...DEFAULT_LABELS, ...(user.themeConfig?.labels ?? {}) },
      versions: user.themeConfig?.versions,
    },
    carve: {
      extensions: user.carve?.extensions ?? [],
      preset: user.carve?.preset ?? 'docs',
      profile: resolveProfile(user.carve?.profile),
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
      lineNumbers: user.shiki?.lineNumbers ?? DEFAULT_SHIKI.lineNumbers,
    },
    search,
    blog: blogConfig,
    feed: feedConfig,
    redirects: user.redirects ?? {},
    substitutions: normalizeSubstitutions(user.substitutions),
    playground: resolvePlaygroundConfig(user.playground, root),
    dev: {
      incremental: user.dev?.incremental ?? false,
    },
    extensions: [
      ...(blogConfig === undefined ? [] : [blog(blogConfig)]),
      ...(search === false ? [] : [searchIndex(search)]),
      ...(feedConfig === false ? [] : [feed(feedConfig)]),
      redirects(user.redirects ?? {}),
      ...(user.extensions ?? []),
    ],
    layouts: user.layouts ?? {},
    locales: Object.fromEntries(
      Object.entries(user.locales ?? {}).map(([key, locale]) => [normalizeLocaleKey(key), locale]),
    ),
  }
}
