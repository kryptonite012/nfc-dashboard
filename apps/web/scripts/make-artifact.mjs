/**
 * Turns the claude-mode Vite build (dist-claude/) into a claude.ai artifact page.
 * claude.ai wraps the published page in its own <html>/<head>/<body>, so the page
 * file holds only the title, stylesheets, the root element and the entry module;
 * the assets/ folder is published alongside it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', 'dist-claude');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');

const pick = (pattern) => [...html.matchAll(pattern)].map((match) => match[0]);
const title = '<title>VaultLedger</title>';
const styles = pick(/<link rel="stylesheet"[^>]*>/g);
const preloads = pick(/<link rel="modulepreload"[^>]*>/g);
const entry = pick(/<script type="module"[^>]*><\/script>/g);
if (entry.length !== 1) throw new Error('Expected exactly one entry module in index.html');

const page = [
  title,
  '<meta name="description" content="Securely record items and prices, and see what your collection is worth.">',
  ...styles,
  ...preloads,
  '<div id="root"></div>',
  '<noscript>VaultLedger needs JavaScript enabled to run.</noscript>',
  ...entry,
  '',
].join('\n');

writeFileSync(path.join(dist, 'vaultledger.html'), page);
process.stdout.write(`Wrote ${path.join(dist, 'vaultledger.html')}\n`);
