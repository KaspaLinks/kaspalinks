/**
 * Shared between the server route guard and the client pay-page UI, so
 * a single change in one place flows through to both. Kept in a tiny
 * standalone module on purpose — pulling this constant via lib/schemas
 * would drag the entire Zod + @kaspa-actions/kaspa (node:wasm) tree
 * into the client bundle, which Webpack refuses to chunk.
 *
 * 10 chars is the minimum supporter-note length for note-required
 * Actions. A single character would trivially bypass the gate; anything
 * above ~15 starts to annoy legitimate "Cat sketch" style commission
 * requests.
 */
export const MIN_REQUIRED_NOTE_LENGTH = 10;
