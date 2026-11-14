import { describe, expect, it } from 'vitest';

import template from 'expo-sharing/plugin/template-files/ios/ShareIntoViewController.swift?raw';
import source from '../plugins/share-statements.js?raw';

// The config plugin that lets the share extension pass a bank statement on as a file
// (plugins/share-statements.js), against the expo-sharing template this app is built from. The
// plugin is CommonJS, as Expo loads it, so it is run here as Node would run it, with the build's
// file and config helpers left out: only its Swift change is under test.
function loadPlugin(): { patchShareController: (swift: string) => string } {
  const module = { exports: {} as Record<string, unknown> };
  const stubs: Record<string, unknown> = { 'node:fs': {}, 'node:path': {}, 'expo/config-plugins': { withDangerousMod: () => undefined } };
  new Function('module', 'exports', 'require', source)(module, module.exports, (id: string) => stubs[id]);
  return module.exports as never;
}

const { patchShareController } = loadPlugin();

describe('the share extension', () => {
  it('keeps a statement as a file, ahead of the branch that would read it as text', () => {
    const patched = patchShareController(template);
    const statement = patched.indexOf('UTType.commaSeparatedText.identifier');
    const text = patched.indexOf('provider.hasItemConformingToTypeIdentifier(UTType.text.identifier)');
    expect(statement).toBeGreaterThan(0);
    expect(statement).toBeLessThan(text);
    expect(patched.slice(statement, text)).toContain('"com.intuit.ofx"');
    expect(patched.slice(statement, text)).toContain('return await handleFile(provider, type: .file, utType: .data)');
    // A second prebuild over the same file changes nothing.
    expect(patchShareController(patched)).toBe(patched);
  });

  it('stops the build when a new template has no place for it', () => {
    expect(() => patchShareController(template.replace('UTType.text.identifier) {', 'UTType.plainText.identifier) {'))).toThrow(/ANCHOR/);
  });
});
