import * as core from '@actions/core';
import { spawn } from 'child_process';
import { SemanticVersion } from './semver.js';
import { filterRCTagsByBaseline } from './utils.js';

export type Commit = { sha: string; title: string; body?: string };

export type Tag = {
  name: string;
  commit: string;
  author: string;
  date: Date;
  content: string;
};

/**
 * Check if we're in a test environment
 */
function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.JEST_WORKER_ID !== undefined ||
    typeof (globalThis as { jest?: unknown }).jest !== 'undefined'
  );
}

/**
 * Execute a git command and return the output
 */
async function execGitCommand(args: string[]): Promise<string | null> {
  try {
    // Skip git commands in test environment to avoid interfering with mocks
    if (isTestEnvironment()) {
      core.debug('Skipping git command in test environment');
      return null;
    }

    return new Promise((resolve, reject) => {
      const git = spawn('git', args, { cwd: process.cwd() });
      let stdout = '';
      let stderr = '';

      git.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      git.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          core.debug(`Git command failed with code ${code}: ${stderr}`);
          resolve(null);
        }
      });

      git.on('error', (error) => {
        core.debug(`Git command error: ${error.message}`);
        reject(error);
      });
    });
  } catch (error) {
    core.debug(`execGitCommand failed: ${String(error)}`);
    return null;
  }
}

/**
 * Get the latest tag from local git repository
 */
export async function getLatestTag(): Promise<Tag | null> {
  try {
    // Get all tags and return the first one (most recent due to sorting)
    const allTags = await getTags();
    if (allTags.length > 0) {
      const latestTag = allTags[0];
      core.info(`Found latest tag from local git: ${latestTag.name}`);
      return latestTag;
    }

    core.debug('No tags found in local git repository');
    return null;
  } catch (error) {
    core.debug(`getLatestTag failed: ${String(error)}`);
    return null;
  }
}

/**
 * Get commits between two refs using git
 */
export async function getCommits(
  baseRef: string,
  headRef: string,
): Promise<Commit[]> {
  try {
    // Get commit hashes and messages between base and head
    const result = await execGitCommand([
      'log',
      '--pretty=format:%H|||%s|||%b',
      '--no-merges',
      `${baseRef}..${headRef}`,
    ]);

    if (!result) {
      return [];
    }

    const commits: Commit[] = [];
    const commitLines = result
      .split('\n')
      .filter((line) => line.trim().length > 0);

    for (const line of commitLines) {
      const parts = line.split('|||');
      if (parts.length >= 2) {
        const sha = parts[0].trim();
        const title = parts[1].trim();
        const body = parts.length > 2 ? parts[2].trim() : undefined;

        commits.push({
          sha,
          title,
          body: body && body.length > 0 ? body : undefined,
        });
      }
    }

    core.info(
      `Found ${commits.length} commits from local git between ${baseRef} and ${headRef}`,
    );
    return commits;
  } catch (error) {
    core.debug(`getCommits failed: ${String(error)}`);
    return [];
  }
}

/**
 * Get all tags from local git repository with commit info
 */
async function getTags(): Promise<Tag[]> {
  try {
    // Get all git tags (both annotated and lightweight) with their commit hashes, author info, date, and content
    const result = await execGitCommand([
      'for-each-ref',
      '--sort=-version:refname',
      '--format=%(refname:short)|||%(objectname)|||%(authorname)|||%(authordate:iso)|||%(contents)',
      'refs/tags',
    ]);

    if (!result) {
      return [];
    }

    const tags: Tag[] = [];
    const tagLines = result
      .split('\n')
      .filter((line) => line.trim().length > 0);

    for (const line of tagLines) {
      const parts = line.split('|||');
      if (parts.length >= 5) {
        const name = parts[0].trim();
        const commit = parts[1].trim();
        const author = parts[2].trim();
        const dateStr = parts[3].trim();
        const content = parts[4] ? parts[4].trim() : '';

        // Parse the ISO date string
        const date = new Date(dateStr);

        tags.push({
          name,
          commit,
          author,
          date,
          content,
        });
      }
    }

    core.info(`Found ${tags.length} tags from local git`);
    return tags;
  } catch (error) {
    core.debug(`getTags failed: ${String(error)}`);
    return [];
  }
}

/**
 * Get file content from a specific commit or branch
 */
export async function getFileContent(
  filePath: string,
  ref?: string,
): Promise<string | null> {
  try {
    const args = ref
      ? ['show', `${ref}:${filePath}`]
      : ['show', `HEAD:${filePath}`];
    const result = await execGitCommand(args);

    if (result !== null) {
      core.info(
        `Retrieved file ${filePath} from git${ref ? ` at ref ${ref}` : ''}`,
      );
      return result;
    }

    core.debug(
      `File ${filePath} not found in git${ref ? ` at ref ${ref}` : ''}`,
    );
    return null;
  } catch (error) {
    core.debug(`getFileContent failed: ${String(error)}`);
    return null;
  }
}

/**
 * Get all RC (Release Candidate) tags since a baseline version using git.
 * This function filters RC tags from git repository based on version comparison.
 */
export async function getReleaseCandidates(
  baseline: SemanticVersion,
): Promise<Array<{ name: string }>> {
  try {
    const allTags = await getTags();
    const localRCs = allTags.filter((tag) => {
      return tag.name.toLowerCase().includes('rc');
    });

    if (localRCs.length === 0) {
      core.debug('No RC tags found in local git repository');
      return [];
    }

    core.info(`Found ${localRCs.length} RC tags from git`);

    // Filter local RCs based on baseline using shared utility
    const results = filterRCTagsByBaseline(
      localRCs.map((tag) => ({ name: tag.name })),
      baseline,
    );
    core.info(`Found ${results.length} RC tags from local git since baseline`);
    return results;
  } catch (error) {
    core.debug(`getReleaseCandidates failed: ${String(error)}`);
    return [];
  }
}
