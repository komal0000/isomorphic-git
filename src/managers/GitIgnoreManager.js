import '../typedefs.js'

import ignore from 'ignore'

import { basename } from '../utils/basename.js'
import { join } from '../utils/join.js'

// I'm putting this in a Manager because I reckon it could benefit
// from a LOT of caching.
export class GitIgnoreManager {
  /**
   * Determines whether a given file is ignored based on `.gitignore` rules and exclusion files.
   *
   * @param {Object} args
   * @param {FSClient} args.fs - A file system implementation.
   * @param {string} args.dir - The working directory.
   * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
   * @param {string} args.filepath - The path of the file to check.
   * @returns {Promise<boolean>} - `true` if the file is ignored, `false` otherwise.
   */
  static async isIgnored({ fs, dir, gitdir = join(dir, '.git'), filepath }) {
    // ALWAYS ignore ".git" folders.
    if (basename(filepath) === '.git') return true
    // '.' is not a valid gitignore entry, so '.' is never ignored
    if (filepath === '.') return false
    // Check and load exclusion rules from project exclude file (.git/info/exclude)
    let excludes = ''
    const excludesFile = join(gitdir, 'info', 'exclude')
    if (await fs.exists(excludesFile)) {
      excludes = await fs.read(excludesFile, 'utf8')
    }
    // Walk down the path one directory at a time, like git does. Each step
    // loads the .gitignore of the folder being entered, then checks the path so
    // far against every .gitignore loaded so far, so deeper files can negate
    // rules from shallower ones.
    const pieces = filepath.split('/').filter(Boolean)
    const matchers = []
    for (let i = 0; i < pieces.length; i++) {
      const folder = pieces.slice(0, i).join('/')
      const ign = ignore()
      // The patterns in .git/info/exclude are relative to the working directory,
      // so only the root .gitignore matcher can use them.
      if (i === 0) ign.add(excludes)
      ign.add(await fs.read(join(dir, folder, '.gitignore'), 'utf8'))
      matchers.push(ign)
      const isParentDir = i < pieces.length - 1
      // Directories need a trailing slash to match patterns like `build/`.
      const suffix = isParentDir || filepath.endsWith('/') ? '/' : ''
      let ignoredStatus = false
      for (const [j, m] of matchers.entries()) {
        const relpath = pieces.slice(j, i + 1).join('/') + suffix
        // If the path is currently ignored, test for UNignoring.
        if (ignoredStatus) {
          ignoredStatus = !m.test(relpath).unignored
        } else {
          ignoredStatus = m.test(relpath).ignored
        }
      }
      // If a parent directory is excluded, we are done.
      // "It is not possible to re-include a file if a parent directory of that file is excluded. Git doesn’t list excluded directories for performance reasons, so any patterns on contained files have no effect, no matter where they are defined."
      // source: https://git-scm.com/docs/gitignore
      if (isParentDir && ignoredStatus) return true
      if (!isParentDir) return ignoredStatus
    }
    return false
  }
}
