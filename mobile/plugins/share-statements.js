/**
 * Lets the share sheet hand Finances a bank statement (CSV, OFX or QFX) as well as a receipt, so
 * a statement saved in Files or attached to an email can be imported from the phone.
 *
 * expo-sharing's share extension (`ShareIntoViewController.swift`, copied from its template when
 * the app is built) would read a CSV as text to paste, because CSV is a kind of text, and drop it
 * when the file does not arrive as a string. This adds a branch ahead of that one that keeps a
 * statement as a file, as the extension keeps a PDF. app.json does the rest: its activation rule
 * offers Finances for the three types, and `UTImportedTypeDeclarations` tells iOS what an .ofx or
 * .qfx file is, which it does not know by itself.
 *
 * Listed before "expo-sharing" in app.json on purpose: mods run last-added first, so this one runs
 * after expo-sharing has written the file. It stops the build if the template has changed so that
 * the branch cannot be placed, rather than ship a share sheet that quietly drops statements.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

/** The share extension's folder, as expo-sharing names it (`EXPO_SHARE_EXTENSION_TARGET_NAME`). */
const EXTENSION_FOLDER = 'expo-sharing-extension';

const MARKER = '// Finances: a bank statement is a file to import, not text to paste.';

/** The template's text branch, which the statement branch goes in front of. */
const ANCHOR = '    if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {\n';

const BRANCH = `    ${MARKER}
    if provider.hasItemConformingToTypeIdentifier(UTType.commaSeparatedText.identifier) ||
    provider.hasItemConformingToTypeIdentifier("com.intuit.ofx") ||
    provider.hasItemConformingToTypeIdentifier("com.intuit.qfx") {
      return await handleFile(provider, type: .file, utType: .data)
    }

`;

/** The share extension's Swift with the statement branch in place. Throws when it cannot be placed. */
function patchShareController(swift) {
  if (swift.includes(MARKER)) return swift;
  const at = swift.indexOf(ANCHOR);
  if (at === -1 || swift.indexOf(ANCHOR, at + 1) !== -1) {
    throw new Error(
      'plugins/share-statements.js: expo-sharing\'s ShareIntoViewController.swift no longer has one text branch to ' +
        'place the bank statement branch before. Check the new template and update ANCHOR.',
    );
  }
  return swift.slice(0, at) + BRANCH + swift.slice(at);
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withShareStatements = (config) =>
  withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const file = path.join(modConfig.modRequest.platformProjectRoot, EXTENSION_FOLDER, 'ShareIntoViewController.swift');
      if (!fs.existsSync(file)) {
        throw new Error(
          `plugins/share-statements.js: ${file} is missing. It must be listed before "expo-sharing" in app.json, ` +
            'so that it runs after expo-sharing has written the share extension.',
        );
      }
      fs.writeFileSync(file, patchShareController(fs.readFileSync(file, 'utf8')));
      return modConfig;
    },
  ]);

module.exports = withShareStatements;
module.exports.patchShareController = patchShareController;
