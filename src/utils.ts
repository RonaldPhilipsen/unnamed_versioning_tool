import { SemanticVersion } from './semver.js';

// Lightweight LRU cache used by various modules. Stores arbitrary values.
export class LRUCache<V> {
  private map: Map<string, V>;

  constructor() {
    this.map = new Map();
  }

  get(key: string): V | undefined {
    // Retrieve value without refreshing order when the stored value is
    // explicitly `undefined`. Tests expect that storing `undefined` does
    // not refresh the LRU ordering.
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key) as V | undefined;
    if (v === undefined) return undefined;
    // Move to the back to mark as most-recently used
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    // If key exists, delete first so insertion order is updated
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

/**
 * Filter RC tags based on baseline version comparison.
 * This is a shared utility function used by both local git and GitHub API functions.
 */
export function filterRCTagsByBaseline(
  tags: Array<{ name: string }>,
  baseline: SemanticVersion,
): Array<{ name: string }> {
  const results: Array<{ name: string }> = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const name = tag.name;
    if (!name) continue;
    if (seen.has(name)) continue;

    const parsed = SemanticVersion.parse(name);
    if (!parsed) continue;
    if (!parsed.prerelease) continue;
    if (!parsed.prerelease.toLowerCase().includes('rc')) continue;

    const cmp = SemanticVersion.compare(parsed, baseline);
    if (cmp <= 0) {
      if (
        parsed.major === baseline.major &&
        parsed.minor === baseline.minor &&
        parsed.patch === baseline.patch
      ) {
        // allow RC targeting same base version even if cmp < 0
      } else {
        continue; // skip older
      }
    }

    seen.add(name);
    results.push({ name });
  }

  return results;
}

export default LRUCache;
