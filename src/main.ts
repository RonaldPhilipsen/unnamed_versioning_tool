import * as core from '@actions/core';
import * as gh from './github.js';
import * as git from './git.js';
import type { PullRequest } from './github.js';
import type { Commit, Tag, Release } from './git.js';
import { SemanticVersion } from './semver.js';
import { getConventionalImpact } from './conventional_commits.js';
import { Impact, ImpactResult, ParsedCommitInfo } from './types.js';
import { generateReleaseNotes } from './release_notes.js';
import { writeFile } from 'fs/promises';

export async function getImpactFromGithub(
  pr: PullRequest,
  commits: Commit[],
): Promise<ImpactResult> {
  const pr_impact = getConventionalImpact(pr);
  core.info(`Determined impact from Pull request: ${String(pr_impact)}`);

  const commit_impacts: ParsedCommitInfo[] = [];
  // Parse each commit title
  for (const commit of commits) {
    const commit_impact = getConventionalImpact(commit);
    core.debug(`Commit ${commit.sha} title: ${commit.title}`);
    core.debug(`Determined impact from commit: ${String(commit_impact)}`);
    if (commit_impact !== undefined) {
      commit_impacts.push(commit_impact);
    }
  }

  const max_commit_impact =
    commit_impacts.length > 0
      ? (Math.max(...commit_impacts.map((c) => c.impact)) as Impact)
      : undefined;
  core.info(`Maximum impact from commits: ${String(max_commit_impact)}`);

  let final_impact: ParsedCommitInfo | undefined = undefined;
  let warning: string | undefined = undefined;
  if (
    pr_impact !== undefined &&
    max_commit_impact !== undefined &&
    pr_impact.impact != max_commit_impact
  ) {
    warning = `Impact from PR title (${Impact[pr_impact.impact]}) differs from maximum commit impact (${Impact[max_commit_impact]}). Using PR title impact (${Impact[pr_impact.impact]}) for version bump.`;
    core.warning(
      `Impact from PR title (${Impact[pr_impact.impact]}) differs from maximum commit impact (${Impact[max_commit_impact]}).`,
    );
    core.warning(
      `Using PR title impact (${Impact[pr_impact.impact]}) for version bump.`,
    );
    final_impact = pr_impact;
  } else if (pr_impact !== undefined) {
    core.info(
      `Using PR title impact (${Impact[pr_impact.impact]}) for version bump.`,
    );
    final_impact = pr_impact;
  } else if (max_commit_impact !== undefined) {
    core.info(
      `Using maximum commit impact (${Impact[max_commit_impact]}) for version bump.`,
    );
    final_impact = commit_impacts.find((c) => c.impact === max_commit_impact);
  } else {
    core.error(
      `No conventional commit impacts found in PR title or commits; no version bump will be performed.`,
    );
    core.setFailed('No Impact determined.');
  }

  return {
    prImpact: pr_impact,
    commitImpacts: commit_impacts,
    maxCommitImpact: max_commit_impact,
    finalImpact: final_impact,
    warning,
  };
}

export async function handle_release_candidates(
  token: string | undefined,
  pr: PullRequest,
  impact: Impact,
  last_release_version: SemanticVersion,
) {
  if (token === undefined) {
    core.info('No GitHub token provided; skipping release-candidate handling.');
    return undefined;
  }
  let prerelease = undefined;
  const is_prerelease = pr.labels?.some(
    (label) => label.name.toLowerCase() === 'release-candidate',
  );
  if (pr.merged) {
    core.info('PR is merged; skipping release-candidate handling.');
    return undefined;
  }

  if (is_prerelease) {
    core.info('PR is marked as a release candidate.');
    // Determine the bumped base version (without prerelease) according to impact
    const bumped_base = last_release_version.bump(impact);
    // Fetch previous RCs for the bumped base version. We pass the bumped base
    // as the baseline so that RC tags targeting the bumped version are found
    // even if they were created before the latest release.
    const previous_release_candidates =
      await getReleaseCandidatesSinceLatestRelease(token, bumped_base);
    // Extract tag names and ask SemanticVersion to compute the next RC index
    const tagNames = previous_release_candidates.map((t: Tag) => t.name);
    const nextRc = SemanticVersion.nextRcIndex(bumped_base, tagNames);
    // create the prerelease string e.g. 'rc1' (if nextRc is 1) or 'rc0' if 0
    prerelease = `rc${nextRc}`;
  }
  return prerelease;
}

/**
 * Return all pull requests labelled as release-candidate that were merged since
 * the latest release. First attempts to get RC tags from local git, then falls back
 * to GitHub API. If no token is provided or an error occurs, returns an empty array.
 */
export async function getReleaseCandidatesSinceLatestRelease(
  token: string,
  baseline: SemanticVersion,
): Promise<Tag[]> {
  try {
    // First, try to get RC tags from local git
    const localResults = await git.getReleaseCandidates(baseline);

    if (localResults.length > 0) {
      // Convert to Tag format for backwards compatibility
      const localTags: Tag[] = localResults.map((result) => ({
        name: result.name,
      }));
      core.info(`Found ${localTags.length} RC tags from local git`);
      return localTags;
    }

    // Fallback to GitHub API if local git doesn't work or no token provided
    if (!token) {
      core.debug('No token provided and no local RC tags found');
      return [];
    }

    const githubResults = await gh.getReleaseCandidatesSinceLatestRelease(
      token,
      baseline,
    );

    // Convert to Tag format for backwards compatibility
    const githubTags: Tag[] = githubResults.map((result) => ({
      name: result.name,
    }));
    core.info(
      `Found ${githubTags.length} release-candidate entry(s) from GitHub API since latest release`,
    );
    return githubTags;
  } catch (err) {
    core.debug(`getReleaseCandidatesSinceLatestRelease failed: ${String(err)}`);
    return [];
  }
}

export async function write_job_summary(
  impactRes: ImpactResult,
  impact: Impact,
  last_release_version: SemanticVersion,
  new_version: SemanticVersion,
  release_notes: string,
) {
  try {
    const prImpactStr =
      impactRes.prImpact !== undefined
        ? Impact[impactRes.prImpact.impact]
        : 'none';
    const commitImpactsStr =
      impactRes.commitImpacts && impactRes.commitImpacts.length > 0
        ? impactRes.commitImpacts.map((i) => Impact[i.impact]).join(', ')
        : 'none';
    const finalImpactStr = impact !== undefined ? Impact[impact] : 'none';

    core.summary.addHeading('semVersie summary', 2).addTable([
      ['Item', 'Value'],
      ['Previous', last_release_version.toString()],
      ['New', `${new_version.toString()}`],
      ['PEP 440', new_version.as_pep_440()],
      ['PR impact', prImpactStr],
      ['Commit impacts', commitImpactsStr],
      ['Final impact', finalImpactStr],
    ]);

    if (impactRes.warning) {
      core.summary.addRaw(`\n⚠️ **Warning:** ${impactRes.warning}`);
    }

    core.summary
      .addHeading('Release Notes', 3)
      .addCodeBlock(release_notes, 'markdown');

    await core.summary.write();
    core.info('Wrote job summary via core.summary');
  } catch (err) {
    core.debug(`Failed to write job summary via core.summary: ${String(err)}`);
  }
}

export async function run() {
  try {
    const token = process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN;

    const release_notes_format_input = core.getInput('release-notes-format', {
      required: false,
      trimWhitespace: true,
    });

    let release_notes_format = '%S'; // Default format

    if (
      release_notes_format_input &&
      release_notes_format_input.trim() !== ''
    ) {
      core.info(
        `Attempting to load release notes format from: ${release_notes_format_input}`,
      );

      let formatContent: string | undefined = undefined;
      if (token) {
        formatContent = await gh.getFileContent(
          token,
          release_notes_format_input,
        );
      } else {
        formatContent = await git.getFileContent(release_notes_format_input);
      }
      if (formatContent !== undefined) {
        release_notes_format = formatContent;
        core.info(
          `Successfully loaded release notes format from ${release_notes_format_input}`,
        );
      } else {
        core.warning(
          `Could not load release notes format from ${release_notes_format_input}, using default format`,
        );
      }
    }

    let release: Release | undefined = undefined;
    if (token) {
      release = await gh.getLatestRelease(token);
    } else {
      release = await git.getLatestRelease();
    }

    let last_release_version: SemanticVersion | undefined;
    if (release != undefined) {
      core.info('Previous release found.');
      const releaseName = release.name ?? release.tag_name ?? '';
      last_release_version = SemanticVersion.parse(releaseName);
    } else {
      core.info('No Previous release found, assuming this is v0.0.0.');
      last_release_version = new SemanticVersion(0, 0, 0);
    }

    if (last_release_version === undefined) {
      core.setFailed('Could not parse latest release version.');
      return;
    }

    core.info('Resolving pull request title...');
    const pr = gh.getPrFromContext();
    if (!pr) {
      core.setFailed('Could not find pull request in context.');
      return;
    }
    core.info(`Found PR #${pr.number} title: ${pr.title}`);

    const commits = await gh.getPrCommits(token);
    const impactRes = await getImpactFromGithub(pr, commits);
    if (
      !impactRes ||
      impactRes == undefined ||
      impactRes.finalImpact == undefined
    ) {
      core.info('No impact determined; skipping version bump.');
      return;
    }
    const impact = impactRes.finalImpact.impact;
    // Compute the bumped base version first so we can reason about prereleases
    const bumped_base_version = last_release_version.bump(impact);

    const prerelease = await handle_release_candidates(
      token,
      pr,
      impact,
      last_release_version,
    );
    const build_metadata = core.getInput('build-metadata');

    const new_version = new SemanticVersion(
      bumped_base_version.major,
      bumped_base_version.minor,
      bumped_base_version.patch,
      prerelease,
      build_metadata,
    );

    core.info(
      `Bumping version from ${last_release_version.toString()} to ${new_version.toString()}`,
    );

    core.info(`Final determined impact: ${String(impact)}`);
    const generated_release_notes = generateReleaseNotes(commits);
    const release_notes = release_notes_format.replace(
      '<INSERT_RELEASE_NOTES_HERE>',
      generated_release_notes,
    );
    const filePath = './release-notes.md';
    await writeFile(filePath, release_notes, 'utf8');
    core.info(`Wrote release notes to ${filePath}`);

    core.setOutput(
      'release',
      (pr.merged && impact !== Impact.NOIMPACT) || prerelease !== undefined,
    );

    if (release_notes.length < 10000) {
      core.setOutput('release-notes', release_notes);
    } else {
      core.error(
        `Release notes length (${release_notes.length}) exceeds 10,000 characters, Refusing to populate output. 
        Consider using the 'release-notes-file' output for large release notes.`,
      );
    }

    core.setOutput('release-notes-file', filePath);
    core.setOutput('prerelease', prerelease !== undefined);
    core.setOutput('tag', new_version.as_tag());
    core.setOutput('version', new_version.toString());
    core.setOutput('version-pep-440', new_version.as_pep_440());

    await write_job_summary(
      impactRes,
      impact,
      last_release_version,
      new_version,
      release_notes,
    );
  } catch (err) {
    core.setFailed(String(err));
  }
}
