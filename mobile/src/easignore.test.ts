import ignore from 'ignore';
import { describe, expect, it } from 'vitest';

import rules from '../../.easignore?raw';

// EAS uploads the repository with eas-cli's own copy (`makeShallowCopyAsync` in
// eas-cli/build/vcs/local.js): `fs.cp` asks the `ignore` package (5.3.0, pinned here to match
// eas-cli 27) about every path, directories without a trailing slash. A rule that only matched
// "mobile/" once dropped the whole app from the upload and the build failed in three seconds.
const upload = ignore().add('.git\nnode_modules\n').add(rules);

describe('.easignore', () => {
  it('uploads the app', () => {
    for (const path of [
      'mobile',
      'mobile/package.json',
      'mobile/package-lock.json',
      'mobile/app.json',
      'mobile/eas.json',
      'mobile/src',
      'mobile/src/app/_layout.tsx',
      'mobile/assets',
      'mobile/assets/images/icon.png',
    ]) {
      expect(upload.ignores(path), path).toBe(false);
    }
  });

  it('leaves the server checkout and local-only files behind', () => {
    for (const path of [
      'package.json',
      '.env',
      'prisma',
      'prisma/dev.db',
      '.data',
      'src',
      'docs',
      'mobile/node_modules',
      'mobile/.env.local',
      'mobile/.expo',
      'mobile/ios',
      'mobile/android',
      'mobile/AuthKey_ABC123.p8',
    ]) {
      expect(upload.ignores(path), path).toBe(true);
    }
  });
});
