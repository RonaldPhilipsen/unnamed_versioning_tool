// Do not mock @actions/core here; tests assert parser return values only.
import {
  ParseConventionalTitle,
  ParseConventionalBody,
  getConventionalImpact,
} from '../src/conventional_commits';
import { PullRequest } from '../src/github.js';
import { Impact } from '../src/semver.js';

describe('ParseSemanticTitle', () => {
  test('feat with breaking-change footer => minor/major detection', () => {
    const msg = `feat: allow provided config object to extend other configs`;
    const res = ParseConventionalTitle(msg);
    expect(res).toBeDefined();
    expect(res!.impact).toBeDefined();
    // Parser returns a ParsedCommitInfo; check impact and type
    expect(res!.impact).toBe(Impact.MINOR);
    expect(res!.type).toBe('feat');
  });

  test('feat! (breaking) => major', () => {
    const msg = `feat!: send an email to the customer when a product is shipped`;
    const res = ParseConventionalTitle(msg);
    expect(res).toBeDefined();
    expect(res!.impact).toBeDefined();
    expect(res!.impact).toBe(Impact.MAJOR);
    expect(res!.type).toBe('feat');
  });

  test('feat(scope)! (breaking) => major', () => {
    const msg = `feat(api)!: send an email to the customer when a product is shipped`;
    const res = ParseConventionalTitle(msg);
    expect(res).toBeDefined();
    expect(res!.impact).toBe(Impact.MAJOR);
    expect(res!.type).toBe('feat');
  });

  test('chore! with breaking footer => major', () => {
    const msg = `chore!: drop support for old browsers`;
    const res = ParseConventionalTitle(msg);
    expect(res).toBeDefined();
    expect(res!.impact).toBe(Impact.MAJOR);
    expect(res!.type).toBe('chore');
  });
});

describe('conventional_commits.ts (parser) - concise coverage', () => {
  test.each([
    ['feat: add feature', Impact.MINOR],
    ['feat!: breaking change', Impact.MAJOR],
    ['feat(api)!: breaking', Impact.MAJOR],
    ['chore!: drop support', Impact.MAJOR],
    ['docs: update readme', Impact.NOIMPACT],
    ['fix: bugfix', Impact.PATCH],
    ['chore(deps): update dependency @eslint/compat to v2 ', Impact.NOIMPACT],
  ])("ParseConventionalTitle('%s') => %p", (title, expected) => {
    const res = ParseConventionalTitle(title);
    expect(res).toBeDefined();
    expect(res!.impact).toBe(expected);
  });

  test('ParseConventionalBody recognizes BREAKING CHANGE', () => {
    expect(ParseConventionalBody('desc\n\nBREAKING CHANGE: removed')).toBe(
      Impact.MAJOR,
    );
  });

  test('getConventionalImpact prefers body over title', () => {
    const pr = {
      title: 'feat: add new feature',
      body: 'This is the body.\n\nBREAKING CHANGE: incompatible API change.',
    } as PullRequest;
    const gi1 = getConventionalImpact(pr);
    expect(gi1).toBeDefined();
    expect(gi1!.impact).toBe(Impact.MAJOR);

    const pr2 = {
      title: 'fix: bugfix',
      body: '',
    } as PullRequest;

    const gi2 = getConventionalImpact(pr2);
    expect(gi2).toBeDefined();
    expect(gi2!.impact).toBe(Impact.PATCH);
  });

  test.each([
    ['unknown: x'],
    ['this is not conventional'],
    ['Feat: capitalized'],
    ['feat-prod: bad type'],
  ])('malformed titles return undefined: %s', (t) => {
    expect(ParseConventionalTitle(t)).toBeUndefined();
  });

  test('ParseConventionalBody returns undefined when no BREAKING CHANGE', () => {
    expect(ParseConventionalBody('normal body')).toBeUndefined();
  });
});

describe('bugs found', () => {
  test('Renovate release notes are stripped', () => {
    const body_with_release_notes = `This PR updates a dependency.

---

### Release Notes

<details>
<summary>eslint/rewrite (@&#8203;eslint/compat)</summary>

### [\`v2.0.0\`](https://redirect.github.com/eslint/rewrite/blob/HEAD/packages/compat/CHANGELOG.md#200-2025-11-14)

[Compare Source](https://redirect.github.com/eslint/rewrite/compare/f5ecc7e945634a173af677d2d597d583bd2704e6...c368656dbba4d927344905f24b3993a378a59a88)

##### ⚠ BREAKING CHANGES

- Require Node.js ^20.19.0 || ^22.13.0 || >=24 ([#&#8203;297](https://redirect.github.com/eslint/rewrite/issues/297))


</details>

---`;

    expect(ParseConventionalBody(body_with_release_notes)).toBeUndefined();
  });
  test('Renovate release notes are stripped, but real majors are kept', () => {
    const body_with_release_notes = `This PR updates a dependency.
BREAKING CHANGE: changed API behavior.
---

### Release Notes

<details>
<summary>eslint/rewrite (@&#8203;eslint/compat)</summary>

### [\`v2.0.0\`](https://redirect.github.com/eslint/rewrite/blob/HEAD/packages/compat/CHANGELOG.md#200-2025-11-14)

[Compare Source](https://redirect.github.com/eslint/rewrite/compare/f5ecc7e945634a173af677d2d597d583bd2704e6...c368656dbba4d927344905f24b3993a378a59a88)

##### ⚠ BREAKING CHANGES

- Require Node.js ^20.19.0 || ^22.13.0 || >=24 ([#&#8203;297](https://redirect.github.com/eslint/rewrite/issues/297))


</details>

---`;

    expect(ParseConventionalBody(body_with_release_notes)).toBe(Impact.MAJOR);
  });
});
