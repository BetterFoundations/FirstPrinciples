import type { Principal } from '../../../src/index.js';

/**
 * The fixed route contract every adapter's conformance server
 * implements, so the shared suite can drive all three identically.
 *
 * The `/case/N` routes come from the shared decision table; everything
 * here is the failure-path contract around them.
 */

/** The caller for every non-table route. */
export const routePrincipal: Principal = { id: 'u-author', roles: ['author'] };

/** A post this principal owns and may edit — used by `/stash`. */
export const stashResource = { id: 'p1', authorId: 'u-author', locked: false };

/** Thrown by `/throws-principal`'s `getPrincipal`. */
export const principalFailure = new Error('principal lookup exploded');

/** Thrown by `/throws-resource`'s `getResource`. */
export const resourceFailure = new Error('resource lookup exploded');
