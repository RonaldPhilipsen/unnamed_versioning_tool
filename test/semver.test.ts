import { SemanticVersion, Impact } from '../src/semver';

describe('SemanticVersion.bump', () => {
  test('major bump resets minor and patch', () => {
    const v = new SemanticVersion(1, 2, 3);
    const bumped = v.bump(Impact.MAJOR, undefined, undefined);
    expect(bumped.major).toBe(2);
    expect(bumped.minor).toBe(0);
    expect(bumped.patch).toBe(0);
    // original should be unchanged
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
  });

  test('minor bump resets patch', () => {
    const v = new SemanticVersion(1, 2, 3);
    const bumped = v.bump(Impact.MINOR, undefined, undefined);
    expect(bumped.major).toBe(1);
    expect(bumped.minor).toBe(3);
    expect(bumped.patch).toBe(0);
    // original should be unchanged
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
  });

  test('patch bump increments patch only', () => {
    const v = new SemanticVersion(1, 2, 3);
    const bumped = v.bump(Impact.PATCH, undefined, undefined);
    expect(bumped.major).toBe(1);
    expect(bumped.minor).toBe(2);
    expect(bumped.patch).toBe(4);
    // original should be unchanged
    expect(v.patch).toBe(3);
  });

  test('noimpact keeps numbers but accepts metadata', () => {
    const v = new SemanticVersion(1, 2, 3);
    const bumped = v.bump(Impact.NOIMPACT, 'alpha.1', 'exp.sha.5114f85');
    expect(bumped.major).toBe(1);
    expect(bumped.minor).toBe(2);
    expect(bumped.patch).toBe(3);
    expect(bumped.prerelease).toBe('alpha.1');
    expect(bumped.buildmetadata).toBe('exp.sha.5114f85');
    // original should not have metadata set
    expect(v.prerelease).toBeUndefined();
    expect(v.buildmetadata).toBeUndefined();
  });

  test('bump with metadata on major/minor/patch', () => {
    const v = new SemanticVersion(0, 9, 9);
    const b1 = v.bump(Impact.MAJOR, 'rc.1', 'build.1');
    expect(b1.toString()).toBe('1.0.0-rc.1+build.1');

    const b2 = v.bump(Impact.MINOR, 'beta', 'm1');
    expect(b2.toString()).toBe('0.10.0-beta+m1');

    const b3 = v.bump(Impact.PATCH, undefined, 'm2');
    expect(b3.toString()).toBe('0.9.10+m2');
  });
});

test('parse simple version', () => {
  const v = SemanticVersion.parse('1.2.3')!;
  expect(v.major).toBe(1);
  expect(v.minor).toBe(2);
  expect(v.patch).toBe(3);
  expect(v.prerelease).toBeUndefined();
  expect(v.buildmetadata).toBeUndefined();
});

test('parse prerelease and buildmetadata', () => {
  const v = SemanticVersion.parse('1.2.3-alpha.1+exp.sha.5114f85')!;
  expect(v.major).toBe(1);
  expect(v.minor).toBe(2);
  expect(v.patch).toBe(3);
  expect(v.prerelease).toBe('alpha.1');
  expect(v.buildmetadata).toBe('exp.sha.5114f85');
});

test('parse v-prefixed version', () => {
  const v = SemanticVersion.parse('v1.2.3')!;
  expect(v.major).toBe(1);
  expect(v.minor).toBe(2);
  expect(v.patch).toBe(3);
});

test('parse v-prefixed prerelease and metadata', () => {
  const v = SemanticVersion.parse('v1.2.3-alpha.1+build123')!;
  expect(v.major).toBe(1);
  expect(v.minor).toBe(2);
  expect(v.patch).toBe(3);
  expect(v.prerelease).toBe('alpha.1');
  expect(v.buildmetadata).toBe('build123');
});

test('invalid version returns undefined', () => {
  expect(SemanticVersion.parse('not-a-version')).toBe(undefined);
});

describe('SemanticVersion.output', () => {
  test('toString and as_tag with prerelease and buildmetadata', () => {
    const v = new SemanticVersion(1, 0, 0, 'alpha.1', 'build.1');
    expect(v.toString()).toBe('1.0.0-alpha.1+build.1');
    expect(v.as_tag()).toBe('v1.0.0-alpha.1+build.1');
  });

  test('as_pep_440 converts prerelease identifiers', () => {
    const v1 = new SemanticVersion(1, 2, 3, 'alpha.1', undefined);
    // alpha -> a (implementation keeps a dot before the numeric part)
    expect(v1.as_pep_440()).toBe('1.2.3a.1');

    const v2 = new SemanticVersion(2, 0, 0, 'beta.2', undefined);
    expect(v2.as_pep_440()).toBe('2.0.0b.2');

    const v3 = new SemanticVersion(0, 1, 0, 'rc.1', undefined);
    expect(v3.as_pep_440()).toBe('0.1.0rc.1');

    // unknown identifier should be preserved (e.g., 'preview')
    const v4 = new SemanticVersion(0, 0, 1, 'preview.5', undefined);
    expect(v4.as_pep_440()).toBe('0.0.1preview.5');
  });

  test('constructor rejects invalid prerelease and build metadata', () => {
    // invalid prerelease (contains invalid characters)
    expect(() => new SemanticVersion(1, 0, 0, '*bad*', undefined)).toThrow();
    // invalid build metadata (contains spaces)
    expect(() => new SemanticVersion(1, 0, 0, undefined, 'bad meta')).toThrow();
  });

  test('parse rejects invalid versions and leading zeros', () => {
    expect(SemanticVersion.parse('not-a-version')).toBeUndefined();
    // leading zeros in major/minor/patch are invalid unless zero
    expect(SemanticVersion.parse('01.2.3')).toBeUndefined();
    expect(SemanticVersion.parse('1.02.3')).toBeUndefined();
    expect(SemanticVersion.parse('1.2.03')).toBeUndefined();
  });

  test('bump NOIMPACT preserves numbers and applies metadata', () => {
    const v = new SemanticVersion(3, 4, 5);
    const b = v.bump(Impact.NOIMPACT, 'pre', 'buildmeta');
    expect(b.major).toBe(3);
    expect(b.minor).toBe(4);
    expect(b.patch).toBe(5);
    expect(b.prerelease).toBe('pre');
    expect(b.buildmetadata).toBe('buildmeta');
  });
});

describe('SemanticVersion.nextRcIndex', () => {
  test('returns 0 when no tags provided', () => {
    const base = new SemanticVersion(1, 2, 3);
    expect(SemanticVersion.nextRcIndex(base, [])).toBe(0);
  });

  test('returns 1 when rc0 exists for same version', () => {
    const base = new SemanticVersion(1, 2, 3);
    const tags = ['v1.2.3-rc0', 'v1.2.3'];
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(1);
  });

  test('ignores rc for other versions', () => {
    const base = new SemanticVersion(1, 2, 3);
    const tags = ['v1.2.2-rc3', 'v1.3.0-rc1'];
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(0);
  });

  test('picks maximum rc index among multiple tags', () => {
    const base = new SemanticVersion(2, 0, 0);
    const tags = ['v2.0.0-rc0', 'v2.0.0-rc2', 'v2.0.0-rc1'];
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(3);
  });

  test('ignores malformed prereleases and non-numeric rc parts', () => {
    const base = new SemanticVersion(3, 1, 4);
    const tags = ['v3.1.4-rcX', 'v3.1.4-preview', 'v3.1.4-rc.0'];
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(1);
  });
});

describe('SemanticVersion.comparePrerelease', () => {
  test('both undefined returns 0', () => {
    expect(SemanticVersion.comparePrerelease(undefined, undefined)).toBe(0);
  });

  test('release > prerelease (undefined > defined)', () => {
    expect(SemanticVersion.comparePrerelease(undefined, 'alpha')).toBe(1);
  });

  test('prerelease < release (defined < undefined)', () => {
    expect(SemanticVersion.comparePrerelease('alpha', undefined)).toBe(-1);
  });

  test('identical prerelease strings return 0', () => {
    expect(SemanticVersion.comparePrerelease('alpha.1', 'alpha.1')).toBe(0);
  });

  test('numeric identifiers compared numerically', () => {
    expect(SemanticVersion.comparePrerelease('1', '2')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('2', '1')).toBe(1);
    expect(SemanticVersion.comparePrerelease('10', '2')).toBe(1); // numeric comparison, not lexical
  });

  test('numeric < non-numeric identifiers', () => {
    expect(SemanticVersion.comparePrerelease('1', 'alpha')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('alpha', '1')).toBe(1);
  });

  test('non-numeric identifiers compared lexically', () => {
    expect(SemanticVersion.comparePrerelease('alpha', 'beta')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('beta', 'alpha')).toBe(1);
  });

  test('dot-separated identifiers compared part by part', () => {
    expect(SemanticVersion.comparePrerelease('alpha.1', 'alpha.2')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('alpha.2', 'alpha.1')).toBe(1);
    expect(SemanticVersion.comparePrerelease('alpha.1', 'beta.1')).toBe(-1);
  });

  test('shorter prerelease < longer prerelease when prefixes match', () => {
    expect(SemanticVersion.comparePrerelease('alpha', 'alpha.1')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('alpha.1', 'alpha')).toBe(1);
    expect(SemanticVersion.comparePrerelease('alpha.1', 'alpha.1.2')).toBe(-1);
  });

  test('complex prerelease comparison scenarios', () => {
    // alpha < alpha.1 < alpha.beta < beta < beta.1 < beta.11 < rc.1
    expect(SemanticVersion.comparePrerelease('alpha', 'alpha.1')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('alpha.1', 'alpha.beta')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('alpha.beta', 'beta')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('beta', 'beta.1')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('beta.1', 'beta.11')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('beta.11', 'rc.1')).toBe(-1);
  });

  test('mixed numeric and non-numeric parts', () => {
    expect(SemanticVersion.comparePrerelease('1.alpha', '1.beta')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('1.alpha', '2.alpha')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('alpha.1', 'alpha.alpha')).toBe(
      -1,
    );
  });

  test('alpha.2 vs beta.1 comparison', () => {
    expect(SemanticVersion.comparePrerelease('alpha.2', 'beta.1')).toBe(-1);
    expect(SemanticVersion.comparePrerelease('beta.1', 'alpha.2')).toBe(1);
  });
});

describe('SemanticVersion.compare and ordering', () => {
  test('major/minor/patch precedence', () => {
    const a = SemanticVersion.parse('1.2.3')!;
    const b = SemanticVersion.parse('1.2.4')!;
    const c = SemanticVersion.parse('2.0.0')!;
    expect(SemanticVersion.compare(a, b)).toBe(-1);
    expect(SemanticVersion.compare(b, a)).toBe(1);
    expect(SemanticVersion.compare(c, a)).toBe(1);
  });

  test('prerelease ordering (alpha < alpha.1 < beta < release)', () => {
    const a = new SemanticVersion(1, 0, 0, 'alpha');
    const a1 = new SemanticVersion(1, 0, 0, 'alpha.1');
    const b = new SemanticVersion(1, 0, 0, 'beta');
    const r = new SemanticVersion(1, 0, 0);

    expect(a.compareTo(a1)).toBe(-1);
    expect(a1.compareTo(b)).toBe(-1);
    expect(b.compareTo(r)).toBe(-1);
  });

  test('numeric vs alphanumeric prerelease precedence', () => {
    const num = new SemanticVersion(1, 0, 0, '1');
    const alpha = new SemanticVersion(1, 0, 0, 'alpha');
    // numeric identifiers have lower precedence than non-numeric
    expect(SemanticVersion.compare(num, alpha)).toBe(-1);
  });

  test('build metadata is ignored in precedence', () => {
    const b1 = SemanticVersion.parse('1.2.3+build1')!;
    const b2 = SemanticVersion.parse('1.2.3+build2')!;
    expect(b1.compareTo(b2)).toBe(0);
  });

  test('compare equal versions with identical prerelease', () => {
    const x = new SemanticVersion(0, 1, 2, 'rc.1');
    const y = new SemanticVersion(0, 1, 2, 'rc.1');
    expect(SemanticVersion.compare(x, y)).toBe(0);
  });
});

describe('SemanticVersion.nextRcIndex additional edge cases', () => {
  test('treats bare rc as rc0', () => {
    const base = new SemanticVersion(4, 5, 6);
    const tags = ['v4.5.6-rc', 'v4.5.6-rc.0', 'v4.5.6-rc1'];
    // existing rc (bare -> 0, rc.0 -> 0, rc1 -> 1) -> max = 1 -> next = 2
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(2);
  });

  test('ignores tags with non-numeric rc suffix', () => {
    const base = new SemanticVersion(5, 0, 0);
    const tags = ['v5.0.0-rcX', 'v5.0.0-rc.beta', 'v5.0.0-preview'];
    // With strict behavior, non-numeric rc suffixes are ignored; none of
    // these tags contain a strict numeric rc index, so nextRcIndex == 0.
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(0);
  });

  test('handles rc indices > 10 correctly', () => {
    const base = new SemanticVersion(6, 0, 0);
    const tags = ['v6.0.0-rc9', 'v6.0.0-rc10', 'v6.0.0-rc11'];
    // max rc = 11 => next = 12
    expect(SemanticVersion.nextRcIndex(base, tags)).toBe(12);
  });
});
