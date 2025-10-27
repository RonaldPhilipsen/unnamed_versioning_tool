import * as core from '@actions/core';

export enum Impact {
  NOIMPACT, // Don't release a new version, keep current version
  PATCH, // Increment patch version ( 0.0.X+1 )
  MINOR, // Increment minor version ( 0.X+1.0 )
  MAJOR, // Increment major version ( X+1.0.0 )
}

export class SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  buildmetadata?: string;

  constructor(
    major: number,
    minor: number,
    patch: number,
    prerelease: string | undefined = undefined,
    buildmetadata: string | undefined = undefined,
  ) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.prerelease = prerelease;
    this.buildmetadata = buildmetadata;

    const prerelease_re =
      /^(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*$/;
    if (prerelease && !prerelease.match(prerelease_re)) {
      core.error(`Invalid prerelease format: ${prerelease}`);
      throw new Error(`Invalid prerelease format: ${prerelease}`);
    }
    const buildmetadata_re = /^[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*$/;
    if (buildmetadata && !buildmetadata.match(buildmetadata_re)) {
      core.error(`Invalid build metadata format: ${buildmetadata}`);
      throw new Error(`Invalid build metadata format: ${buildmetadata}`);
    }
  }

  toString(): string {
    let s = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease) s += `-${this.prerelease}`;
    if (this.buildmetadata) s += `+${this.buildmetadata}`;
    return s;
  }

  as_tag(): string {
    return `v${this.toString()}`;
  }

  as_pep_440(): string {
    let s = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease) {
      // Convert prerelease to PEP 440 format
      const pep440_prerelease = this.prerelease
        .replace(/-/g, '.')
        .replace(/([a-zA-Z]+)(\d*)/g, (_, p1, p2) => {
          const mapping: { [key: string]: string } = {
            alpha: 'a',
            beta: 'b',
            rc: 'rc',
          };
          return mapping[p1] ? mapping[p1] + p2 : p1 + p2;
        });
      s += `${pep440_prerelease}`;
    }
    if (this.buildmetadata) {
      // PEP 440 uses .postN for build metadata
      core.info(
        `PEP 440 does not support build metadata; no build metadata will be provided.`,
      );
    }
    return s;
  }

  bump(
    impact: Impact,
    prerelease: string | undefined = undefined,
    buildmetadata: string | undefined = undefined,
  ): SemanticVersion {
    switch (impact) {
      case Impact.MAJOR:
        return new SemanticVersion(
          this.major + 1,
          0,
          0,
          prerelease,
          buildmetadata,
        );
      case Impact.MINOR:
        return new SemanticVersion(
          this.major,
          this.minor + 1,
          0,
          prerelease,
          buildmetadata,
        );
      case Impact.PATCH:
        return new SemanticVersion(
          this.major,
          this.minor,
          this.patch + 1,
          prerelease,
          buildmetadata,
        );
      case Impact.NOIMPACT:
      default:
        return new SemanticVersion(
          this.major,
          this.minor,
          this.patch,
          prerelease,
          buildmetadata,
        );
    }
  }

  /**
   * Compare prerelease versions according to semver specification.
   * Returns 1 if a > b, -1 if a < b, 0 if equal.
   * Handles cases where one or both prerelease strings may be undefined.
   */
  static comparePrerelease(
    a: string | undefined,
    b: string | undefined,
  ): number {
    if (!a && !b) return 0;
    if (!a) return 1; // release > prerelease
    if (!b) return -1; // prerelease < release

    const aParts = a.split('.');
    const bParts = b.split('.');
    const maxLen = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLen; i++) {
      const ap = aParts[i];
      const bp = bParts[i];

      if (ap === undefined) return -1;
      if (bp === undefined) return 1;

      const isANumeric = /^[0-9]+$/.test(ap);
      const isBNumeric = /^[0-9]+$/.test(bp);

      if (isANumeric && isBNumeric) {
        const diff = Number(ap) - Number(bp);
        if (diff !== 0) return Math.sign(diff);
      } else if (isANumeric !== isBNumeric) {
        return isANumeric ? -1 : 1; // numeric < non-numeric
      } else {
        const diff = ap.localeCompare(bp);
        if (diff !== 0) return Math.sign(diff);
      }
    }
    return 0;
  }

  /**
   * Compare two SemanticVersion instances.
   * Returns 1 if a > b, -1 if a < b, 0 if equal.
   * This follows semver precedence for major/minor/patch and treats
   * a version without prerelease as greater than one with a prerelease
   * for the same major.minor.patch.
   */
  static compare(a: SemanticVersion, b: SemanticVersion): number {
    // Compare major.minor.patch using simple subtraction with sign normalization
    const majorDiff = a.major - b.major;
    if (majorDiff !== 0) return Math.sign(majorDiff);

    const minorDiff = a.minor - b.minor;
    if (minorDiff !== 0) return Math.sign(minorDiff);

    const patchDiff = a.patch - b.patch;
    if (patchDiff !== 0) return Math.sign(patchDiff);

    // At this point major/minor/patch are equal — consider prerelease
    return this.comparePrerelease(a.prerelease, b.prerelease);
  }

  compareTo(other: SemanticVersion): number {
    return SemanticVersion.compare(this, other);
  }

  static parse(version: string): SemanticVersion | undefined {
    const semver =
      /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<buildmetadata>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

    const match = version.match(semver);
    if (!match || !match.groups) {
      core.info(`Version string "${version}" is not valid SemVer format.`);
      return undefined;
    }
    const major = parseInt(match.groups.major, 10);
    const minor = parseInt(match.groups.minor ?? '0', 10);
    const patch = parseInt(match.groups.patch ?? '0', 10);
    const prerelease = match.groups.prerelease;
    const buildmetadata = match.groups.buildmetadata;
    const v = new SemanticVersion(major, minor, patch);
    if (prerelease) v.prerelease = prerelease;
    if (buildmetadata) v.buildmetadata = buildmetadata;
    return v;
  }

  /**
   * Given a target base version and an array of tag names (strings), find the
   * maximum 'rc' index present for tags that match the same major.minor.patch
   * and return the next index (max + 1). If none found, returns 0.
   *
   * Tags may include a leading 'v' and various prerelease separators (e.g.
   * 'rc0', 'rc.1', 'rc-2'). Only the first numeric component after 'rc' is
   * considered.
   */
  static nextRcIndex(base: SemanticVersion, tagNames: string[]): number {
    let maxRc = -1;
    for (const name of tagNames) {
      const parsed = SemanticVersion.parse(name);
      if (!parsed) continue;
      if (
        parsed.major === base.major &&
        parsed.minor === base.minor &&
        parsed.patch === base.patch &&
        parsed.prerelease
      ) {
        // Examine dot/dash/underscore separated identifiers and only
        // accept strict rc forms:
        //  - bare 'rc' => treated as 0
        //  - 'rc<digits>' or 'rc.<digits>' or 'rc-<digits>' etc. => numeric index
        // Ignore non-numeric suffixes like 'rcX' or 'rc.beta'.
        const parts = parsed.prerelease.split(/[.\-_]/);
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          // Strict single-token form like 'rc123'
          const mInline = part.match(/^rc([0-9]+)$/i);
          if (mInline) {
            const n = Number(mInline[1]);
            if (!isNaN(n) && n > maxRc) maxRc = n;
            continue;
          }

          // Exact 'rc' token: accept as 0 only if followed by a numeric token or
          // if it's the only rc-related token (i.e., not followed by non-numeric)
          if (/^rc$/i.test(part)) {
            const next = parts[i + 1];
            if (next === undefined) {
              if (0 > maxRc) maxRc = 0;
            } else if (/^[0-9]+$/.test(next)) {
              const n = Number(next);
              if (!isNaN(n) && n > maxRc) maxRc = n;
            }
            // If next token exists but is non-numeric (e.g., 'beta'), ignore.
          }
        }
      }
    }
    return maxRc + 1;
  }
}
