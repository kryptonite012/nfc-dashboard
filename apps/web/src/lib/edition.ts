/**
 * VaultLedger ships in two editions built from the same code:
 *  - "server": talks to the Express + PostgreSQL API (self-hosted).
 *  - "claude": published on claude.ai, where sign-in is the viewer's Claude account and each
 *    person's records live in their own private storage space (see lib/local/).
 */
export const IS_CLAUDE_EDITION = import.meta.env.VITE_EDITION === 'claude';
