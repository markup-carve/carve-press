// test/expand.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expandIncludes } from '../src/include/expand.js'

async function site(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cp-inc-'))
  for (const [name, body] of Object.entries(files)) {
    const path = resolve(dir, name)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, body)
  }
  return dir
}

describe('expandIncludes', () => {
  it('inlines a whole file', async () => {
    const dir = await site({ 'p.crv': 'one\ntwo\n' })
    const r = expandIncludes('a\n%% @include: ./p.crv\nb\n', {
      srcPath: 'main.crv',
      baseDir: dir,
      roots: [dir],
    })
    expect(r.source).toBe('a\none\ntwo\nb\n')
  })

  it('inlines an inclusive line range', async () => {
    const dir = await site({ 'p.txt': 'l1\nl2\nl3\nl4\n' })
    const r = expandIncludes('%% @include: ./p.txt{2,3}\n', {
      srcPath: 'main.crv',
      baseDir: dir,
      roots: [dir],
    })
    expect(r.source).toBe('l2\nl3\n')
  })

  it('supports open-ended ranges in both directions', async () => {
    const dir = await site({ 'p.txt': 'l1\nl2\nl3\n' })
    const from = expandIncludes('%% @include: ./p.txt{2,}\n', {
      srcPath: 'm.crv',
      baseDir: dir,
      roots: [dir],
    })
    expect(from.source).toBe('l2\nl3\n')
    const to = expandIncludes('%% @include: ./p.txt{,2}\n', {
      srcPath: 'm.crv',
      baseDir: dir,
      roots: [dir],
    })
    expect(to.source).toBe('l1\nl2\n')
  })

  it('inlines a heading section by slug', async () => {
    const dir = await site({
      'g.crv': '# Top\n\nintro\n\n## Basic Usage\n\nbody\n\n## Next\n\nafter\n',
    })
    const r = expandIncludes('%% @include: ./g.crv#basic-usage\n', {
      srcPath: 'm.crv',
      baseDir: dir,
      roots: [dir],
    })
    expect(r.source).toBe('## Basic Usage\n\nbody\n')
  })

  it('expands recursively', async () => {
    const dir = await site({ 'a.crv': 'A\n%% @include: ./b.crv\n', 'b.crv': 'B\n' })
    const r = expandIncludes('%% @include: ./a.crv\n', {
      srcPath: 'm.crv',
      baseDir: dir,
      roots: [dir],
    })
    expect(r.source).toBe('A\nB\n')
  })

  it('does not expand a directive inside a fenced code block', async () => {
    const dir = await site({ 'p.crv': 'X\n' })
    const src = '```\n%% @include: ./p.crv\n```\n'
    const r = expandIncludes(src, { srcPath: 'm.crv', baseDir: dir, roots: [dir] })
    expect(r.source).toBe(src)
  })

  it('rejects a path escaping the allowed roots', async () => {
    const dir = await site({ 'p.crv': 'X\n' })
    expect(() =>
      expandIncludes('%% @include: ../../etc/passwd\n', {
        srcPath: 'm.crv',
        baseDir: dir,
        roots: [dir],
      }),
    ).toThrow(/outside the allowed roots/)
  })

  it('rejects a cycle and names it', async () => {
    const dir = await site({ 'a.crv': '%% @include: ./b.crv\n', 'b.crv': '%% @include: ./a.crv\n' })
    expect(() =>
      expandIncludes('%% @include: ./a.crv\n', { srcPath: 'm.crv', baseDir: dir, roots: [dir] }),
    ).toThrow(/include cycle/)
  })

  it('rejects a missing file with the including line', async () => {
    const dir = await site({})
    expect(() =>
      expandIncludes('x\n%% @include: ./gone.crv\n', {
        srcPath: 'm.crv',
        baseDir: dir,
        roots: [dir],
      }),
    ).toThrow(/m\.crv:2:1/)
  })

  it('maps an expanded line back to its original file and line', async () => {
    const dir = await site({ 'p.crv': 'one\ntwo\nthree\n' })
    const r = expandIncludes('a\n%% @include: ./p.crv\nb\n', {
      srcPath: 'main.crv',
      baseDir: dir,
      roots: [dir],
    })
    // Expanded line 1 is "a" from main.crv:1.
    expect(r.map.resolve(1)).toEqual({ srcPath: 'main.crv', line: 1 })
    // Expanded line 3 is "two", the second line of the included file.
    expect(r.map.resolve(3).line).toBe(2)
    expect(r.map.resolve(3).srcPath.endsWith('p.crv')).toBe(true)
    // Expanded line 5 is "b", back in main.crv at line 3.
    expect(r.map.resolve(5)).toEqual({ srcPath: 'main.crv', line: 3 })
  })
})
