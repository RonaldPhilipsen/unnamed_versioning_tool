import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { LRUCache, filterRCTagsByBaseline } from './utils.js';
import * as git from './git.js';
import { SemanticVersion } from './semver.js';
import type { Commit } from './git.js';

/**
 * Minimal Pull Request interface capturing commonly-used fields.
 * This intentionally doesn't replicate the full GitHub API shape — add fields as needed.
 */
export type PullRequest = {
  number: number;
  title: string;
  body: string;
  head: {
    ref: string;
    sha: string;
    repo: { full_name?: string };
  };
  base?: {
    ref: string;
    sha: string;
    repo: { full_name?: string };
  };
  labels: Array<{ name: string }>;
  draft: boolean;
  merged: boolean;
  merge_commit_sha: string | null;
  [k: string]: unknown;
};

// Small helper to centralize payload->PR extraction logic.
// We keep the cast narrow and local to avoid wide `any` usage while
// keeping the extraction logic concise.
function extractPullRequestFromPayload(ev: unknown): PullRequest | undefined {
  const payload = ev as
    | { event?: { pull_request?: PullRequest }; pull_request?: PullRequest }
    | undefined;
  return payload?.event?.pull_request ?? payload?.pull_request;
}

/**
 * Return the whole Pull Request object from the Actions context when available.
 */
export function getPrFromContext(): PullRequest | undefined {
  const ctx = github.context;
  return extractPullRequestFromPayload(ctx.payload as unknown);
}

function getOctokitAndRepo(token: string) {
  const octokit = github.getOctokit(token);
  const ctx = github.context;
  const owner = ctx.repo.owner;
  const repo = ctx.repo.repo;
  return { octokit, owner, repo };
}

// Module-level cache keyed by owner/repo and operation. Tests can mock this by
// mocking the './utils' import.
const GH_CACHE = new LRUCache<Promise<unknown>>();

// Small helper to parse an Octokit commit entry into our Commit type.
function parseCommit(c: unknown): Commit {
  const cc = c as { sha?: string; commit?: { message?: string } };
  const msg = cc.commit?.message ?? '';
  const title = msg ? msg.split('\n')[0] : '';
  const body = msg ? msg.split('\n').slice(1).join('\n').trim() : undefined;
  return { sha: cc.sha!, title, body };
}

/**
 * Read a pull request title from the Actions context.
 * Checks common payload locations and returns undefined when not found.
 */
export function getPrTitleFromContext(): string | undefined {
  // Reuse getPrFromContext to avoid duplicating payload parsing logic
  const pr = getPrFromContext();
  return pr?.title;
}

/**
 * List commits for the current pull request using the Actions context.
 * First attempts to get commits from local git, then falls back to GitHub API.
 * If token is provided it will be used to construct an Octokit instance.
 */
export async function getPrCommits(token: string): Promise<Commit[]> {
  try {
    // Try to obtain a PullRequest object from context first; fall back to ref parsing
    const pr = getPrFromContext();
    let pull_number: number | undefined = pr?.number;
    const ctx = github.context;
    if (!pull_number && ctx.ref) {
      const m = ctx.ref.match(/^refs\/pull\/(\d+)\/(?:merge|head)$/);
      if (m) pull_number = Number(m[1]);
    }

    // Try to get commits from local git first if we have PR info
    if (pr?.base?.sha && pr?.head?.sha) {
      core.debug(
        `Attempting to get PR commits from local git: ${pr.base.sha}..${pr.head.sha}`,
      );
      const localCommits = await git.getCommits(pr.base.sha, pr.head.sha);
      if (localCommits.length > 0) {
        return localCommits;
      }
    }

    // Alternative: try using branch names if available
    if (pr?.base?.ref && pr?.head?.ref) {
      core.debug(
        `Attempting to get PR commits from local git using branches: ${pr.base.ref}..${pr.head.ref}`,
      );
      const localCommits = await git.getCommits(pr.base.ref, pr.head.ref);
      if (localCommits.length > 0) {
        return localCommits;
      }
    }

    // Fallback to GitHub API
    if (!pull_number) {
      core.debug(
        'No pull request number found in context; cannot list commits',
      );
      return [];
    }
    const { octokit, owner, repo } = getOctokitAndRepo(token);
    const cacheKey = `prCommits:${owner}/${repo}:${pull_number}`;
    let p = GH_CACHE.get(cacheKey) as Promise<Commit[]> | undefined;
    if (!p) {
      let raw: Promise<Commit[]>;
      try {
        const call = octokit.rest.pulls.listCommits({
          owner,
          repo,
          pull_number,
        });
        raw = Promise.resolve(call).then((res) => {
          return res.data.map((c) => parseCommit(c));
        });
      } catch (err) {
        core.debug(
          `getPrCommits: synchronous GitHub API listCommits threw: ${String(err)}`,
        );
        return [];
      }
      const wrapped = raw.catch((err) => {
        GH_CACHE.delete(cacheKey);
        core.debug(
          `getPrCommits: GitHub API listCommits failed: ${String(err)}`,
        );
        return [] as Commit[];
      });
      p = wrapped;
      GH_CACHE.set(cacheKey, p as unknown as Promise<unknown>);
      p.finally(() => GH_CACHE.delete(cacheKey));
    }
    const commits = await p;
    core.info(`Found ${commits.length} commits in PR`);
    return commits;
  } catch (err) {
    core.debug(`getPrCommits failed: ${String(err)}`);
    return [];
  }
}

/**
 * Return the most recent tag name for the repository in the Actions context using GitHub API.
 * Returns undefined if the API call fails.
 */
export async function getLatestTag(token: string): Promise<string | undefined> {
  try {
    const { octokit, owner, repo } = getOctokitAndRepo(token);
    const cacheKey = `latestTag:${owner}/${repo}`;
    let p = GH_CACHE.get(cacheKey) as Promise<string | undefined> | undefined;
    if (!p) {
      const raw = Promise.resolve()
        .then(() => octokit.rest.repos.listTags({ owner, repo, per_page: 1 }))
        .then((res) => {
          return (res.data && res.data[0] && res.data[0].name) || undefined;
        });
      const wrapped = raw.catch((err) => {
        GH_CACHE.delete(cacheKey);
        core.debug(`getLatestTag: GitHub API listTags failed: ${String(err)}`);
        return undefined as string | undefined;
      });
      p = wrapped;
      GH_CACHE.set(cacheKey, p as unknown as Promise<unknown>);
      p.finally(() => GH_CACHE.delete(cacheKey));
    }
    return p;
  } catch (err) {
    core.debug(`getLatestTag failed: ${String(err)}`);
    return undefined;
  }
}

/**
 * Return the latest release object for the repository in the Actions context.
 * Gets release info from GitHub API.
 */
export async function getLatestRelease(
  token: string,
): Promise<Release | undefined> {
  try {
    const { octokit, owner, repo } = getOctokitAndRepo(token);
    const cacheKey = `latestRelease:${owner}/${repo}`;
    let p = GH_CACHE.get(cacheKey) as Promise<Release | undefined> | undefined;
    if (!p) {
      const raw = Promise.resolve()
        .then(() => octokit.rest.repos.getLatestRelease({ owner, repo }))
        .then((res) => {
          return res && res.data ? (res.data as Release) : undefined;
        });
      const wrapped = raw.catch((err) => {
        GH_CACHE.delete(cacheKey);
        core.debug(
          `getLatestRelease: GitHub API getLatestRelease failed: ${String(err)}`,
        );
        return undefined as Release | undefined;
      });
      p = wrapped;
      GH_CACHE.set(cacheKey, p as unknown as Promise<unknown>);
      p.finally(() => GH_CACHE.delete(cacheKey));
    }
    return p;
  } catch (err) {
    core.debug(`getLatestRelease failed: ${String(err)}`);
    return undefined;
  }
}

/**
 * Downloads a file from the GitHub repository.
 * First checks if the file exists locally, then tries git, finally falls back to GitHub API.
 *
 * @param token GitHub token for API access
 * @param filePath Path to the file in the repository (e.g., 'path/to/file.md')
 * @param ref Optional git reference (commit, branch, tag) to fetch file from
 * @returns The file contents as a string, or undefined if file not found
 */
export async function getFileContent(
  token: string,
  filePath: string,
  ref?: string,
): Promise<string | undefined> {
  try {
    if (!ref) {
      try {
        await access(filePath, constants.F_OK);
        core.info(`Found file locally: ${filePath}`);
        const content = await readFile(filePath, 'utf8');
        return content;
      } catch {
        // File doesn't exist locally, continue to git method
        core.debug(`File not found locally: ${filePath}`);
      }
    }

    if (!token) {
      core.warning(
        `No token provided and file not found locally or in git: ${filePath}`,
      );
      return undefined;
    }

    core.info(
      `File not found in git, attempting to download from GitHub: ${filePath}`,
    );
    const { octokit, owner, repo } = getOctokitAndRepo(token);

    const apiParams: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
    } = {
      owner,
      repo,
      path: filePath,
    };
    if (ref) {
      apiParams.ref = ref;
    }

    const response = await octokit.rest.repos.getContent(apiParams);

    // GitHub API returns base64 encoded content for files
    if (
      'content' in response.data &&
      typeof response.data.content === 'string'
    ) {
      const content = Buffer.from(response.data.content, 'base64').toString(
        'utf8',
      );
      core.info(`Successfully downloaded file from GitHub: ${filePath}`);
      return content;
    } else {
      core.warning(
        `File ${filePath} is not a regular file or content not available`,
      );
      return undefined;
    }
  } catch (err) {
    core.warning(`Failed to get file content for ${filePath}: ${String(err)}`);
    return undefined;
  }
}

/**
 * Get all RC (Release Candidate) tags since a baseline version using GitHub API.
 * This function fetches RC tags from GitHub repository tags only.
 */
export async function getReleaseCandidates(
  token: string,
  baseline: SemanticVersion,
): Promise<Array<{ name: string }>> {
  try {
    if (!token) {
      core.debug('No token provided for GitHub API');
      return [];
    }

    const ctx = github.context;
    const owner = ctx.repo.owner;
    const repo = ctx.repo.repo;
    const octokit = github.getOctokit(token);

    // Fetch only repository tags (not releases)
    const per_page = 100;
    const allTags: Array<{ name: string }> = [];

    // Fetch tag names (paged)
    let page = 1;
    while (true) {
      const res = await octokit.rest.repos.listTags({
        owner,
        repo,
        per_page,
        page,
      });
      if (!res || !Array.isArray(res.data) || res.data.length === 0) break;
      for (const t of res.data) {
        if (t.name) {
          allTags.push({ name: t.name });
        }
      }
      if (res.data.length < per_page) break;
      page += 1;
    }

    // Use shared filtering logic
    const results = filterRCTagsByBaseline(allTags, baseline);

    core.info(
      `Found ${results.length} release-candidate tag(s) from GitHub API since latest release`,
    );
    return results;
  } catch (err) {
    core.debug(`getReleaseCandidatesSinceLatestRelease failed: ${String(err)}`);
    return [];
  }
}
