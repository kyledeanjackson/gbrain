import { describe, test, expect } from 'bun:test';
import {
  DEFAULT_ENTITY_DIRS,
  buildDirPattern,
  buildEntityRegexes,
  extractEntityRefs,
  extractPageLinks,
  getAutoLinkExtraDirs,
} from '../src/core/link-extraction.ts';
import type { BrainEngine } from '../src/core/engine.ts';

// BH carry: config-driven extension of the entity-dir whitelist via
// auto_link.extra_dirs. Sites with numbered dirs ("03-ventures") or shorthand
// aliases ("venture/") extend the DIR_PATTERN whitelist without forking the
// regexes. This file is the regression net that keeps the carry alive across
// upstream rebases — if these fail after a rebase, the carry got dropped.

const BH_EXTRAS = ['03-ventures', '06-people', '07-decisions', 'venture', 'person'];

function engineWithConfig(value: string | null): BrainEngine {
  return { getConfig: async (_key: string) => value } as unknown as BrainEngine;
}

describe('buildDirPattern', () => {
  test('defaults reproduce the canonical whitelist', () => {
    const pat = buildDirPattern();
    for (const dir of DEFAULT_ENTITY_DIRS) expect(pat).toContain(dir);
  });

  test('extras are appended, defaults retained, duplicates collapsed', () => {
    const pat = buildDirPattern(['03-ventures', 'people', '03-ventures']);
    expect(pat).toContain('03-ventures');
    expect(pat).toContain('people');
    expect(pat.match(/03-ventures/g)?.length).toBe(1);
  });

  test('regex metacharacters in extras are escaped', () => {
    // A hostile dir name must not break or widen the alternation.
    const pat = buildDirPattern(['a.b*c']);
    expect(() => new RegExp(pat)).not.toThrow();
    expect(new RegExp(`^${pat}$`).test('a.b*c')).toBe(true);
    expect(new RegExp(`^${pat}$`).test('aXbbc')).toBe(false);
  });
});

describe('extractEntityRefs with extraDirs', () => {
  const md = 'See [Kavlo](03-ventures/kavlo.md) and canonical [Alice](people/alice.md).';

  test('default: markdown links to non-whitelisted dirs are NOT extracted', () => {
    const slugs = extractEntityRefs(md).map(r => r.slug);
    expect(slugs).toContain('people/alice');
    expect(slugs).not.toContain('03-ventures/kavlo');
  });

  test('with extras: numbered-dir markdown links ARE extracted, canonical retained', () => {
    const slugs = extractEntityRefs(md, BH_EXTRAS).map(r => r.slug);
    expect(slugs).toContain('03-ventures/kavlo');
    expect(slugs).toContain('people/alice');
  });

  test('dir-qualified wikilinks honor extras without needsResolution', () => {
    const refs = extractEntityRefs('Link: [[03-ventures/kavlo|Kavlo]]', BH_EXTRAS);
    const kavlo = refs.find(r => r.slug === '03-ventures/kavlo');
    expect(kavlo).toBeDefined();
    expect(kavlo!.needsResolution).toBeUndefined();
    expect(kavlo!.name).toBe('Kavlo');
  });

  test('qualified wikilinks ([[src:dir/slug]]) honor extras', () => {
    const refs = extractEntityRefs('[[bh-vault:06-people/ram-venkat]]', BH_EXTRAS);
    const ram = refs.find(r => r.slug === '06-people/ram-venkat');
    expect(ram).toBeDefined();
    expect(ram!.sourceId).toBe('bh-vault');
  });

  test('buildEntityRegexes variants all include extras', () => {
    const { entityRefRe, wikilinkRe, qualifiedWikilinkRe } = buildEntityRegexes(['03-ventures']);
    expect(entityRefRe.source).toContain('03-ventures');
    expect(wikilinkRe.source).toContain('03-ventures');
    expect(qualifiedWikilinkRe.source).toContain('03-ventures');
  });
});

describe('extractPageLinks opts.extraDirs', () => {
  const allowAllResolver = { resolve: async () => null as string | null };

  test('markdown candidates include extra-dir targets only when opts.extraDirs set', async () => {
    const content = 'Working with [Kavlo](03-ventures/kavlo.md) this week.';
    const without = await extractPageLinks('docs/x', content, {}, 'concept', allowAllResolver);
    const withExtras = await extractPageLinks('docs/x', content, {}, 'concept', allowAllResolver, {
      extraDirs: BH_EXTRAS,
    });
    expect(without.candidates.map(c => c.targetSlug)).not.toContain('03-ventures/kavlo');
    expect(withExtras.candidates.map(c => c.targetSlug)).toContain('03-ventures/kavlo');
  });

  test('bare slug refs in prose honor extras', async () => {
    const content = 'Context lives at 03-ventures/kavlo for the pipeline.';
    const withExtras = await extractPageLinks('docs/x', content, {}, 'concept', allowAllResolver, {
      extraDirs: BH_EXTRAS,
    });
    expect(withExtras.candidates.map(c => c.targetSlug)).toContain('03-ventures/kavlo');
  });
});

describe('getAutoLinkExtraDirs', () => {
  test('unset config → empty list', async () => {
    expect(await getAutoLinkExtraDirs(engineWithConfig(null))).toEqual([]);
  });

  test('JSON array string parses', async () => {
    const dirs = await getAutoLinkExtraDirs(engineWithConfig('["03-ventures","venture"]'));
    expect(dirs).toEqual(['03-ventures', 'venture']);
  });

  test('comma-separated string parses with trimming', async () => {
    const dirs = await getAutoLinkExtraDirs(engineWithConfig(' 03-ventures , venture '));
    expect(dirs).toEqual(['03-ventures', 'venture']);
  });

  test('malformed JSON → empty list, no throw', async () => {
    expect(await getAutoLinkExtraDirs(engineWithConfig('["unclosed'))).toEqual([]);
  });

  test('non-string JSON elements are dropped, not crashed on', async () => {
    // Regression: numbers used to escape the try/catch and throw later inside
    // escapeDirForRegex during extraction.
    const dirs = await getAutoLinkExtraDirs(engineWithConfig('[1, "03-ventures", null, ""]'));
    expect(dirs).toEqual(['03-ventures']);
  });

  test('non-[ JSON-ish input falls through to comma parsing as a literal', async () => {
    // Only strings starting with [ take the JSON branch. Anything else is
    // comma-split; a stray object literal becomes one (regex-escaped, inert)
    // dir name rather than an error.
    expect(await getAutoLinkExtraDirs(engineWithConfig('{"a":1}'))).toEqual(['{"a":1}']);
  });

  test('engine read error → empty list', async () => {
    const engine = { getConfig: async () => { throw new Error('db down'); } } as unknown as BrainEngine;
    expect(await getAutoLinkExtraDirs(engine)).toEqual([]);
  });
});
