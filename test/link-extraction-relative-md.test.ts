import { describe, test, expect } from 'bun:test';
import {
  extractRelativeMarkdownRefs,
  extractPageLinks,
  isRelativeMarkdownEnabled,
} from '../src/core/link-extraction.ts';
import type { BrainEngine } from '../src/core/engine.ts';

// BH carry (connectivity-fix): repo-relative markdown link resolution behind
// auto_link.relative_markdown. `[spec](../../docs/specs/x.md)` — the dominant
// cross-reference style in docs/, skills/, and session content — produced ZERO
// graph edges before this carry. This file is the regression net; if it fails
// after an upstream rebase, the carry got dropped.

const allowAllResolver = { resolve: async () => null as string | null };
const engineWithConfig = (value: string | null): BrainEngine =>
  ({ getConfig: async (_key: string) => value } as unknown as BrainEngine);

describe('extractRelativeMarkdownRefs — resolution', () => {
  test('sibling relative link resolves against the page dir', () => {
    const refs = extractRelativeMarkdownRefs('docs/lattice/ingestion', 'See [overview](overview.md).');
    expect(refs.map(r => r.slug)).toEqual(['docs/lattice/overview']);
    expect(refs[0].name).toBe('overview');
    expect(refs[0].dir).toBe('docs');
  });

  test('../ parent link walks up one dir', () => {
    const refs = extractRelativeMarkdownRefs('docs/lattice/ingestion', 'Spec: [x](../specs/x.md).');
    expect(refs.map(r => r.slug)).toEqual(['docs/specs/x']);
  });

  test('../../ multi-parent link', () => {
    const refs = extractRelativeMarkdownRefs('a/b/c/page', '[up](../../top.md)');
    expect(refs.map(r => r.slug)).toEqual(['a/top']);
  });

  test('/root-absolute link resolves from the repo root (baseDir ignored)', () => {
    const refs = extractRelativeMarkdownRefs('docs/lattice/ingestion', '[readme](/readme.md)');
    expect(refs.map(r => r.slug)).toEqual(['readme']);
  });

  test('#fragment is stripped before resolution', () => {
    const refs = extractRelativeMarkdownRefs('docs/x', '[sec](../specs/y.md#a-heading)');
    expect(refs.map(r => r.slug)).toEqual(['specs/y']);
  });

  test('%20 (and other percent-escapes) are decoded then slugified', () => {
    const refs = extractRelativeMarkdownRefs('docs/x', '[file](../specs/my%20file.md)');
    expect(refs.map(r => r.slug)).toEqual(['specs/my-file']);
  });

  test('.mdx extension is accepted', () => {
    const refs = extractRelativeMarkdownRefs('docs/x', '[c](../comp/card.mdx)');
    expect(refs.map(r => r.slug)).toEqual(['comp/card']);
  });
});

describe('extractRelativeMarkdownRefs — exclusions', () => {
  test('external https:// links are excluded', () => {
    expect(extractRelativeMarkdownRefs('docs/x', '[site](https://example.com/x.md)')).toEqual([]);
  });

  test('mailto: links are excluded', () => {
    expect(extractRelativeMarkdownRefs('docs/x', '[mail](mailto:a@b.com)')).toEqual([]);
  });

  test('protocol-relative //host links are excluded', () => {
    expect(extractRelativeMarkdownRefs('docs/x', '[cdn](//cdn.example.com/x.md)')).toEqual([]);
  });

  test('bare #anchor (same-page) targets are excluded', () => {
    expect(extractRelativeMarkdownRefs('docs/x', '[here](#section)')).toEqual([]);
  });

  test('non-.md targets (assets, code) are skipped', () => {
    const refs = extractRelativeMarkdownRefs(
      'docs/x',
      '[img](../assets/logo.png) and [code](../src/foo.ts)',
    );
    expect(refs).toEqual([]);
  });

  test('.. escaping above the repo root is skipped', () => {
    expect(extractRelativeMarkdownRefs('a/b', '[up](../../../up.md)')).toEqual([]);
  });

  test('links inside code fences are ignored', () => {
    const refs = extractRelativeMarkdownRefs('docs/x', '```\n[c](../specs/y.md)\n```');
    expect(refs).toEqual([]);
  });
});

describe('extractPageLinks — relativeMarkdown gate + no double-emit', () => {
  // Page dir is `docs/lattice`, so `../specs/x.md` resolves up one level to
  // `docs/specs/x`.
  test('flag off (default): repo-relative links produce zero candidates', async () => {
    const content = 'See [spec](../specs/x.md) for details.';
    const off = await extractPageLinks('docs/lattice/guide', content, {}, 'note', allowAllResolver);
    expect(off.candidates.map(c => c.targetSlug)).not.toContain('docs/specs/x');
  });

  test('flag on: repo-relative links become markdown candidates', async () => {
    const content = 'See [spec](../specs/x.md) for details.';
    const on = await extractPageLinks('docs/lattice/guide', content, {}, 'note', allowAllResolver, {
      relativeMarkdown: true,
    });
    const spec = on.candidates.find(c => c.targetSlug === 'docs/specs/x');
    expect(spec).toBeDefined();
    expect(spec!.linkSource).toBe('markdown');
  });

  test('no double-emit: a link the entity-dir pass owns is not re-resolved by the relative pass', async () => {
    // `people` is a default entity dir, so pass-1 emits people/alice. The
    // relative pass, if unmasked, would resolve people/alice against the page
    // dir → docs/people/alice (a spurious slug). Masking suppresses that.
    const content = 'Met [Alice](people/alice.md) today.';
    const on = await extractPageLinks('docs/guide', content, {}, 'note', allowAllResolver, {
      relativeMarkdown: true,
    });
    const targets = on.candidates.map(c => c.targetSlug);
    expect(targets).toContain('people/alice');       // entity-dir pass owns it
    expect(targets).not.toContain('docs/people/alice'); // relative pass must NOT double-emit
  });
});

describe('isRelativeMarkdownEnabled', () => {
  test('unset config → false (opt-in)', async () => {
    expect(await isRelativeMarkdownEnabled(engineWithConfig(null))).toBe(false);
  });

  test('truthy config → true', async () => {
    expect(await isRelativeMarkdownEnabled(engineWithConfig('true'))).toBe(true);
    expect(await isRelativeMarkdownEnabled(engineWithConfig('1'))).toBe(true);
  });

  test('falsy config → false', async () => {
    expect(await isRelativeMarkdownEnabled(engineWithConfig('false'))).toBe(false);
  });
});
