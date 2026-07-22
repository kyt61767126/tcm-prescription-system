#!/usr/bin/env node
/**
 * patch-java-version.js
 *
 * Patches all Capacitor library build.gradle files in node_modules to use
 * JavaVersion.VERSION_17 instead of VERSION_21.
 *
 * This is needed because:
 * - Capacitor 8.x requires JDK 21 for compilation
 * - The system only has JDK 17 installed (with javac)
 * - The actual Capacitor source code is compatible with Java 17
 *
 * This script should be called before each Gradle build to ensure
 * the patch survives npm install (which restores original files).
 *
 * Usage: node patch-java-version.js [project-root]
 *   project-root: defaults to parent of tools/ directory
 */

const fs = require('fs');
const path = require('path');

const projectRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..');

const nodeModulesDir = path.join(projectRoot, 'node_modules');

if (!fs.existsSync(nodeModulesDir)) {
  console.log('[SKIP] node_modules not found, skipping Java version patch');
  process.exit(0);
}

// Patterns to search for build.gradle files with VERSION_21
const searchDirs = [
  path.join(nodeModulesDir, '@capacitor'),
  path.join(nodeModulesDir, '@capacitor-community'),
];

let patched = 0;
let scanned = 0;

function findAndPatchBuildGradle(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findAndPatchBuildGradle(fullPath);
    } else if (entry.name === 'build.gradle') {
      scanned++;
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('JavaVersion.VERSION_21')) {
          const newContent = content.replace(
            /JavaVersion\.VERSION_21/g,
            'JavaVersion.VERSION_17'
          );
          fs.writeFileSync(fullPath, newContent, 'utf8');
          console.log(`  [OK] Patched: ${path.relative(projectRoot, fullPath)}`);
          patched++;
        }
      } catch (e) {
        console.log(`  [WARN] Cannot read: ${fullPath} - ${e.message}`);
      }
    }
  }
}

console.log('[patch-java-version] Scanning Capacitor libraries for VERSION_21...');

for (const dir of searchDirs) {
  findAndPatchBuildGradle(dir);
}

console.log(`[patch-java-version] Scanned ${scanned} build.gradle files, patched ${patched}`);
process.exit(0);
