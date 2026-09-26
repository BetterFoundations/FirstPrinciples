/**
 * Re-export of the package's public entry point.
 *
 * The React suites import through here so their own `.tsx` files stay
 * free of deep relative paths, and so a symbol that stops being exported
 * from `src/index.ts` breaks them the same way it would break a
 * consumer.
 */
export * from '../../src/index.js';
export { isErr, isOk } from '@firstprinciples/core';
