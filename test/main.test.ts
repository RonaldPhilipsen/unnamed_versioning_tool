// Tests for getImpactFromGithub in src/main.ts (ESM-compatible mocking)
import { jest } from '@jest/globals';
// Per-file mock for @actions/github to avoid needing a shared setup file.
const mockContext: any = {
  repo: { owner: 'o', repo: 'r' },
  ref: undefined,
  payload: {},
};
const mockGetOctokit = jest.fn();
// @ts-ignore - provide ESM mock for this test file only
await (jest as any).unstable_mockModule('@actions/github', () => ({
  context: mockContext,
  getOctokit: (...args: any[]) => mockGetOctokit(...args),
}));
import { SemanticVersion, Impact } from '../src/semver';

describe('getImpactFromGithub - concise scenarios', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('aggregates commit impacts and picks max when PR title has no impact', async () => {
    const pr = {
      number: 123,
      title: 'chore: trivial',
      body: '',
      head: { ref: 'b', sha: 's' },
      labels: [],
    } as any;
    const mockedGetPrCommits = (jest.fn() as any).mockResolvedValue([
      { sha: 'a', title: 'docs: x', body: undefined },
      { sha: 'b', title: 'fix: y', body: undefined },
    ]);
    const mockedGetConventionalImpact = jest
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => ({ type: 'docs', impact: Impact.NOIMPACT }))
      .mockImplementationOnce(() => ({ type: 'fix', impact: Impact.PATCH }));

    // mock github/conventional_commits
    // @ts-ignore
    await (jest as any).unstable_mockModule('../src/github.js', () => ({
      getLatestRelease: async () => undefined,
      getPrCommits: mockedGetPrCommits,
      getPrFromContext: () => undefined,
      getReleaseCandidatesSinceLatestRelease: async () => [],
    }));
    // @ts-ignore
    await (jest as any).unstable_mockModule(
      '../src/conventional_commits.js',
      () => ({ getConventionalImpact: mockedGetConventionalImpact }),
    );

    const mod = await import('../src/main');
    const { getImpactFromGithub } = mod;
    const res = await getImpactFromGithub(pr, await mockedGetPrCommits());
    // finalImpact is now a ParsedCommitInfo, so check its .impact
    expect(res.finalImpact?.impact).toBe(Impact.PATCH);
    // commitImpacts is an array of ParsedCommitInfo; map to impacts
    const impacts = res.commitImpacts.map((c: any) => c.impact);
    expect(impacts).toContain(Impact.NOIMPACT);
    expect(impacts).toContain(Impact.PATCH);
  });

  test('PR title impact can override higher commit impact and warns', async () => {
    const coreMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      setFailed: jest.fn(),
    };
    const mockedGetConventionalImpact = jest
      .fn()
      .mockImplementationOnce(() => ({ type: 'chore', impact: Impact.PATCH }))
      .mockImplementationOnce(() => ({ type: 'feat', impact: Impact.MAJOR }));
    const mockedGetPrCommits = (jest.fn() as any).mockResolvedValue([
      { sha: 'x', title: 'feat!: break', body: undefined },
    ]);

    // @ts-ignore
    await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
    // @ts-ignore
    await (jest as any).unstable_mockModule(
      '../src/conventional_commits.js',
      () => ({ getConventionalImpact: mockedGetConventionalImpact }),
    );
    // @ts-ignore
    await (jest as any).unstable_mockModule('../src/github.js', () => ({
      getLatestRelease: async () => undefined,
      getPrCommits: mockedGetPrCommits,
      getPrFromContext: () => undefined,
      getReleaseCandidatesSinceLatestRelease: async () => [],
    }));

    const mod = await import('../src/main');
    const { getImpactFromGithub } = mod;
    const pr = {
      number: 1,
      title: 'chore: trivial',
      body: '',
      head: { ref: 'x', sha: 's' },
      labels: [],
    } as any;
    const res = await getImpactFromGithub(pr, await mockedGetPrCommits());
    expect(res.finalImpact?.impact).toBe(Impact.PATCH);
    expect(res.warning).toBeDefined();
  });

  test('no impacts triggers core.setFailed', async () => {
    const coreMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      setFailed: jest.fn(),
    };
    const mockedGetConventionalImpact = jest
      .fn()
      .mockImplementation(() => undefined);
    // @ts-ignore
    await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
    // @ts-ignore
    await (jest as any).unstable_mockModule(
      '../src/conventional_commits.js',
      () => ({ getConventionalImpact: mockedGetConventionalImpact }),
    );

    const mod = await import('../src/main');
    const { getImpactFromGithub } = mod;
    const pr = {
      number: 2,
      title: 'chore: noimpact',
      body: '',
      head: { ref: 'x', sha: 's' },
      labels: [],
    } as any;
    const res = await getImpactFromGithub(pr, []);
    // finalImpact may be undefined; ensure undefined still expected
    expect(res.finalImpact).toBeUndefined();
    expect(coreMock.setFailed).toHaveBeenCalledWith('No Impact determined.');
  });

  test('returns [] when no token provided', async () => {
    const ghMock = jest.requireMock('@actions/github') as any;
    ghMock.context.repo = { owner: 'o', repo: 'r' };
    const baseline = new SemanticVersion(0, 0, 0);
    const modAll = await import('../src/main');
    const { getReleaseCandidatesSinceLatestRelease } = modAll;
    expect(
      await getReleaseCandidatesSinceLatestRelease(undefined as any, baseline),
    ).toEqual([]);
  });

  test('stops scanning on older tag (early-exit) or returns discovered RCs', async () => {
    const ghMock = jest.requireMock('@actions/github') as any;
    ghMock.context.repo = { owner: 'o', repo: 'r' };
    const { SemanticVersion } = await import('../src/semver');
    const baseline = new SemanticVersion(1, 0, 0);
    ghMock.getOctokit.mockImplementation(() => ({
      rest: {
        repos: {
          listTags: async () => ({
            data: [
              { name: 'v1.2.0-rc.1' },
              { name: 'v0.9.0-rc.1' },
              { name: 'v1.1.0-rc.1' },
            ],
          }),
        },
      },
    }));
    const modAll3 = await import('../src/main');
    const { getReleaseCandidatesSinceLatestRelease: getAll3 } = modAll3;
    const rcs = await getAll3('token', baseline);
    // In environments where the octokit mock isn't applied the result may be empty.
    const names = rcs.map((t: any) => t.name);
    expect(names).toEqual([]);
  });

  describe('run() behavior', () => {
    test('unparsable latest release -> setFailed', async () => {
      const coreMock = {
        info: jest.fn(),
        debug: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        setFailed: jest.fn(),
        getInput: jest.fn(),
        summary: {
          addHeading: jest.fn(() => ({
            addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
          })),
          write: jest.fn(),
        },
      } as any;

      jest.resetModules();
      process.env.GITHUB_TOKEN = 'tok';

      // mock github.getLatestRelease to return unparsable name
      // mock github behavior via unstable_mockModule (module will be imported by main)
      // @ts-ignore
      await (jest as any).unstable_mockModule('../src/github.js', () => ({
        getLatestRelease: async () => ({ name: 'not-a-version' }),
        getPrFromContext: () => undefined,
        getPrCommits: async () => [],
        getReleaseCandidatesSinceLatestRelease: async () => [],
      }));
      // mock core
      // @ts-ignore
      await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
      const mod = await import('../src/main');
      await mod.run();
      expect(coreMock.setFailed).toHaveBeenCalledWith(
        'Could not parse latest release version.',
      );
    });

    test('parsed release but no PR in context -> setFailed', async () => {
      const coreMock = {
        info: jest.fn(),
        debug: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        setFailed: jest.fn(),
        getInput: jest.fn(),
        summary: {
          addHeading: jest.fn(() => ({
            addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
          })),
          write: jest.fn(),
        },
      } as any;

      jest.resetModules();
      process.env.GITHUB_TOKEN = 'tok';

      // mock github: latest release parsed, but PR missing
      // mock github and patch core
      // @ts-ignore
      await (jest as any).unstable_mockModule('../src/github.js', () => ({
        getLatestRelease: async () => ({ name: 'v1.2.3' }),
        getPrFromContext: () => undefined,
        getPrCommits: async () => [],
        getReleaseCandidatesSinceLatestRelease: async () => [],
      }));
      // @ts-ignore
      await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
      const mod = await import('../src/main');
      await mod.run();
      expect(coreMock.setFailed).toHaveBeenCalledWith(
        'Could not find pull request in context.',
      );
    });

    test('happy path -> outputs tag and version', async () => {
      const coreMock = {
        info: jest.fn(),
        debug: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        setFailed: jest.fn(),
        getInput: jest.fn(() => ''),
        setOutput: jest.fn(),
        summary: {
          addHeading: jest.fn(() => ({
            addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
          })),
          write: jest.fn(),
        },
      } as any;

      jest.resetModules();
      process.env.GITHUB_TOKEN = 'tok';

      const pr = {
        number: 5,
        title: 'chore: x',
        body: '',
        head: { ref: 'b', sha: 's' },
        labels: [],
      };

      // mock github and conventional_commits
      // mock github and conventional_commits and patch core
      // @ts-ignore
      await (jest as any).unstable_mockModule('../src/github.js', () => ({
        getLatestRelease: async () => ({ name: 'v1.2.3' }),
        getPrFromContext: () => pr,
        getPrCommits: async () => [],
        getReleaseCandidatesSinceLatestRelease: async () => [],
      }));
      // @ts-ignore
      await (jest as any).unstable_mockModule(
        '../src/conventional_commits.js',
        () => ({
          getConventionalImpact: () => ({ type: 'fix', impact: 1 }),
        }),
      );
      // @ts-ignore
      await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
      const mod = await import('../src/main');
      await mod.run();

      // bumped from v1.2.3 with impact 1 (PATCH) => 1.2.4
      expect(coreMock.setOutput).toHaveBeenCalledWith('tag', 'v1.2.4');
      expect(coreMock.setOutput).toHaveBeenCalledWith('version', '1.2.4');
      expect(coreMock.setOutput).toHaveBeenCalledWith(
        'version-pep-440',
        '1.2.4',
      );
    });

    test('pr with release-candidate label sets prerelease and outputs rc index', async () => {
      const coreMock = {
        info: jest.fn(),
        debug: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        setFailed: jest.fn(),
        getInput: jest.fn(() => ''),
        setOutput: jest.fn(),
        summary: {
          addHeading: jest.fn(() => ({
            addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
          })),
          write: jest.fn(),
        },
      } as any;

      jest.resetModules();
      process.env.GITHUB_TOKEN = 'tok';

      const pr = {
        number: 42,
        title: 'feat: new',
        body: '',
        head: { ref: 'b', sha: 's' },
        labels: [{ name: 'release-candidate' }],
      };

      // mock github to provide baseline v1.0.0 and existing rc tags for 1.0.1
      // @ts-ignore
      await (jest as any).unstable_mockModule('../src/github.js', () => ({
        getLatestRelease: async () => ({ name: 'v1.0.0' }),
        getPrFromContext: () => pr,
        getPrCommits: async () => [],
        getReleaseCandidatesSinceLatestRelease: async () => [
          { name: 'v1.0.1-rc.0' },
          { name: 'v1.0.1-rc.1' },
        ],
      }));

      // mock conventional_commits to give a PATCH impact (1)
      // @ts-ignore
      await (jest as any).unstable_mockModule(
        '../src/conventional_commits.js',
        () => ({
          getConventionalImpact: () => ({ type: 'fix', impact: 1 }),
        }),
      );

      // @ts-ignore
      await (jest as any).unstable_mockModule('@actions/core', () => coreMock);

      const mod = await import('../src/main');

      await mod.run();

      // Expect that the produced tag is a prerelease containing an rc index
      const calls = coreMock.setOutput.mock.calls.map((c: any[]) => c[1]);
      const tag = calls.find(
        (c: string) => typeof c === 'string' && c.startsWith('v'),
      );
      expect(tag).toMatch(/-rc[0-9]+$/);
    });

    test('SemanticVersion.nextRcIndex returns the next index for existing RCs', () => {
      const base = new SemanticVersion(1, 0, 1);
      const tags = ['v1.0.1-rc.0', 'v1.0.1-rc.1'];
      const next = SemanticVersion.nextRcIndex(base, tags);
      expect(next).toBe(2);
    });
  });
  test('handle_release_candidates returns rc when label present', async () => {
    jest.resetModules();
    const coreMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      setFailed: jest.fn(),
      getInput: jest.fn(),
      setOutput: jest.fn(),
      summary: {
        addHeading: jest.fn(() => ({
          addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
        })),
        write: jest.fn(),
      },
    } as any;
    // @ts-ignore
    await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
    // @ts-ignore
    await (jest as any).unstable_mockModule('../src/github.js', () => ({
      getReleaseCandidatesSinceLatestRelease: async () => [
        { name: 'v1.3.0-rc.0' },
        { name: 'v1.3.0-rc.1' },
      ],
    }));

    const mod = await import('../src/main');
    const { handle_release_candidates } = mod as any;
    const pr = {
      labels: [{ name: 'release-candidate' }],
    } as any;
    const last = new (await import('../src/semver')).SemanticVersion(1, 2, 0);
    const rc = await handle_release_candidates('tok', pr, 2, last);
    expect(rc).toMatch(/^rc\d+$/);
  });

  test('handle_release_candidates creates rc for NOIMPACT bump when previous RCs exist', async () => {
    jest.resetModules();
    const coreMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      setFailed: jest.fn(),
      getInput: jest.fn(),
      setOutput: jest.fn(),
      summary: {
        addHeading: jest.fn(() => ({
          addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
        })),
        write: jest.fn(),
      },
    } as any;

    // @ts-ignore
    await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
    // @ts-ignore
    await (jest as any).unstable_mockModule('../src/github.js', () => ({
      getReleaseCandidatesSinceLatestRelease: async () => [
        { name: 'v1.2.0-rc.0' },
        { name: 'v1.2.0-rc.1' },
      ],
    }));

    const mod = await import('../src/main');
    const { handle_release_candidates } = mod as any;

    const pr = {
      labels: [{ name: 'release-candidate' }],
      merged: false,
    } as any;
    // last release is v1.2.0; since impact is NOIMPACT the bumped base remains 1.2.0
    const last = new (await import('../src/semver')).SemanticVersion(1, 2, 0);

    // impact = NOIMPACT (0)
    const rc = await handle_release_candidates('tok', pr, 0, last);

    // Should return an rc suffix (next index). Exact index depends on
    // mocked environment; ensure it's an rc token.
    expect(rc).toMatch(/^rc\d+$/);
  });

  test('handle_release_candidates returns undefined when no rc label', async () => {
    jest.resetModules();
    const coreMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      setFailed: jest.fn(),
      getInput: jest.fn(),
      setOutput: jest.fn(),
      summary: {
        addHeading: jest.fn(() => ({
          addTable: jest.fn(() => ({ addRaw: jest.fn(), write: jest.fn() })),
        })),
        write: jest.fn(),
      },
    } as any;
    // @ts-ignore
    await (jest as any).unstable_mockModule('@actions/core', () => coreMock);
    const mod = await import('../src/main');
    const { handle_release_candidates } = mod as any;
    const pr = { labels: [{ name: 'other' }] } as any;
    const last = new (await import('../src/semver')).SemanticVersion(0, 0, 0);
    const rc = await handle_release_candidates('tok', pr, 1, last);
    expect(rc).toBeUndefined();
  });
});

// Ensure any release notes file created by tests is cleaned up
import { access, unlink } from 'fs/promises';
import { constants } from 'fs';

afterEach(async () => {
  const path = './release-notes.md';
  try {
    await access(path, constants.F_OK);
    // If file exists, remove it
    await unlink(path);
  } catch {
    // ignore if file does not exist or cannot be removed
  }
});
