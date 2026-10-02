/*
 * Starts `next dev` with the stale OPENAI_API_KEY from the Windows user environment removed for this
 * one process, so the working key in .env.local is used instead (Next gives the process environment
 * precedence over .env.local, so the bad key otherwise wins and the AI routes — plan, covers — get 401).
 *
 *   node --use-system-ca tools/dev-clean-env.mjs
 *
 * Not needed once that Windows variable is removed.
 */
delete process.env.OPENAI_API_KEY;
process.argv.splice(2, 0, 'dev');
await import('../node_modules/next/dist/bin/next');
