/**
 * BH carry (connectivity-fix) regression net: config-driven orphan deny
 * prefixes via `orphans.extra_deny_prefixes`.
 *
 * Upstream DENY_PREFIXES is a hardcoded constant, so BH junk domains
 * (`_archive/`, `_templates/`, `finance-os/triage/`, duplicate imports)
 * counted as orphanable and polluted both the orphan set and the
 * total_linkable denominator. This carry reads the extra prefixes from
 * config and threads them into shouldExclude + the denominator loop. If
 * these fail after an upstream rebase, the carry got dropped.
 *
 * Hermetic via PGLite. Models on orphans-pure-fn.test.ts +
 * link-extraction-extra-dirs.test.ts.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { findOrphans, shouldExclude } from '../src/commands/orphans.ts';

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
}, 60_000);

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  await engine.executeRaw('DELETE FROM links');
  await engine.executeRaw('DELETE FROM pages');
  // Reset config between tests so a stale value can't leak across cases.
  await engine.setConfig('orphans.extra_deny_prefixes', '');
});

// Two "real" orphans + two junk-prefix orphans. None have inbound links, and
// none of the junk prefixes are in the hardcoded upstream DENY_PREFIXES, so by
// default all four count as orphans.
async function seedFixture(): Promise<void> {
  await engine.putPage('people/person-1', { type: 'person', title: 'P1', compiled_truth: 'p1', frontmatter: {} });
  await engine.putPage('people/person-2', { type: 'person', title: 'P2', compiled_truth: 'p2', frontmatter: {} });
  await engine.putPage('finance-os/triage/item-1', { type: 'note', title: 'T1', compiled_truth: 't1', frontmatter: {} });
  await engine.putPage('_archive/old-note', { type: 'note', title: 'A1', compiled_truth: 'a1', frontmatter: {} });
}

describe('shouldExclude — extraDenyPrefixes arg', () => {
  test('default (no extras) does NOT exclude BH junk prefixes', () => {
    expect(shouldExclude('finance-os/triage/item-1')).toBe(false);
    expect(shouldExclude('_archive/old-note')).toBe(false);
  });

  test('extra prefixes exclude matching slugs alongside hardcoded DENY_PREFIXES', () => {
    const extras = ['finance-os/triage/', '_archive/'];
    expect(shouldExclude('finance-os/triage/item-1', extras)).toBe(true);
    expect(shouldExclude('_archive/old-note', extras)).toBe(true);
    // hardcoded prefix still fires with extras present
    expect(shouldExclude('templates/meeting', extras)).toBe(true);
    // non-matching slug stays included
    expect(shouldExclude('people/alice', extras)).toBe(false);
  });

  test('empty-string prefix in the list never matches (no match-everything footgun)', () => {
    expect(shouldExclude('people/alice', ['', 'finance-os/triage/'])).toBe(false);
    expect(shouldExclude('finance-os/triage/x', ['', 'finance-os/triage/'])).toBe(true);
  });
});

describe('findOrphans — orphans.extra_deny_prefixes config', () => {
  test('unset config: all four seeded pages are orphans', async () => {
    await seedFixture();
    const r = await findOrphans(engine, {});
    const slugs = r.orphans.map(o => o.slug).sort();
    expect(slugs).toEqual(['_archive/old-note', 'finance-os/triage/item-1', 'people/person-1', 'people/person-2']);
    expect(r.total_orphans).toBe(4);
  });

  test('config set: junk-prefix pages leave BOTH the orphan set and the denominator', async () => {
    await seedFixture();
    const before = await findOrphans(engine, {});

    await engine.setConfig('orphans.extra_deny_prefixes', '["finance-os/triage/","_archive/"]');
    const after = await findOrphans(engine, {});

    // Numerator: the two junk pages are gone.
    expect(after.total_orphans).toBe(before.total_orphans - 2);
    expect(after.orphans.map(o => o.slug).sort()).toEqual(['people/person-1', 'people/person-2']);
    // Denominator: total_linkable shrinks by the same two (excluded ← denominator).
    expect(after.total_linkable).toBe(before.total_linkable - 2);
    // total_pages is unaffected — the pages still exist, they're just not linkable-orphan candidates.
    expect(after.total_pages).toBe(before.total_pages);
  });

  test('comma-separated config value is accepted (same as JSON array)', async () => {
    await seedFixture();
    await engine.setConfig('orphans.extra_deny_prefixes', 'finance-os/triage/, _archive/');
    const r = await findOrphans(engine, {});
    expect(r.orphans.map(o => o.slug).sort()).toEqual(['people/person-1', 'people/person-2']);
  });

  test('malformed config value degrades to [] without throwing', async () => {
    await seedFixture();
    await engine.setConfig('orphans.extra_deny_prefixes', '["unclosed');
    // Must not throw; behaves as if no extras configured.
    const r = await findOrphans(engine, {});
    expect(r.total_orphans).toBe(4);
  });
});
