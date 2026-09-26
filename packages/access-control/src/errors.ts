import { ForbiddenError } from '@firstprinciples/core';
import type { Decision, DecisionReason } from './decision.js';

/**
 * The error `assertCan` throws.
 *
 * @remarks
 * A subclass of `core`'s `ForbiddenError`, so it keeps a `kind` of
 * `'ForbiddenError'` and an `httpStatus` of 403, and is caught by
 * anything already handling that taxonomy slot — `api-kit`'s error handler maps
 * it to an RFC 7807 problem-details response with no wiring at all —
 * while `name` and `instanceof` still identify it precisely.
 *
 * **What it deliberately does not carry to the client.** `core`
 * documents `details` as client-visible, and `api-kit` puts `message`
 * and `code` on the wire too. So `details` holds only the action and
 * subject the caller already named in its own request. The
 * {@link Decision.reason} and the id of the deciding rule are instance
 * fields and are *not* serialized by `toJSON()`: which rule denied you,
 * and whether it denied you outright or because a resource could not be
 * loaded, is policy shape, and policy shape is not owed to whoever was
 * just refused. Log `error.reason` server-side; ship `error.toJSON()`.
 *
 * @example
 * ```ts
 * try {
 *   permissions.assertCan('delete', 'post', { resource: post });
 * } catch (error) {
 *   if (error instanceof PermissionDeniedError) {
 *     logger.warn({ reason: error.reason, ruleId: error.ruleId }, 'denied');
 *   }
 *   throw error;
 * }
 * ```
 *
 * @public
 */
export class PermissionDeniedError extends ForbiddenError {
  /**
   * Inherited from `ForbiddenError` unchanged — to anything switching on
   * the taxonomy this *is* a forbidden error. Its own identity is
   * `name`.
   */
  declare readonly kind: 'ForbiddenError';

  /** The action that was refused. */
  readonly action: string;
  /** The subject it was refused on. */
  readonly subject: string;
  /** Why. Server-side only — never serialized. See the class remarks. */
  readonly reason: DecisionReason;
  /** The `id` of the rule that decided, if it had one. Server-side only. */
  readonly ruleId: string | undefined;

  /**
   * @param decision - The denial, straight from the engine. Passing an
   * allowed decision is a programming error and is not checked for —
   * `assertCan` is the only intended caller.
   */
  constructor(decision: Decision) {
    super(`Permission denied: '${decision.action}' on '${decision.subject}'.`, {
      code: 'PERMISSION_DENIED',
      details: { action: decision.action, subject: decision.subject },
    });
    this.name = 'PermissionDeniedError';
    this.action = decision.action;
    this.subject = decision.subject;
    this.reason = decision.reason;
    this.ruleId = decision.ruleId;
  }
}
