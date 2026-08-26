import type { DecisionReason, Principal } from '../../src/index.js';

/**
 * The decision table.
 *
 * Every surface this package ships — the engine, all three server
 * guards, the React component and the React hook — is tested by running
 * **this** table, not a paraphrase of it. That is what makes "the same
 * rule set produces identical decisions on client and server" a checked
 * property rather than a claim: a divergence anywhere shows up as a
 * failure here, in whichever suite drifted.
 *
 * Each row states the expected `reason` as well as the expected answer,
 * so a case cannot start passing for the wrong cause — an ownership
 * grant quietly becoming a wildcard grant would still be `true`, and
 * would still fail this table.
 */
export interface DecisionCase {
  /** Shown in the test name. */
  readonly name: string;
  /** The caller. `null` is anonymous. */
  readonly principal: Principal | null;
  /** Not necessarily a declared action — some rows check that it is not. */
  readonly action: string;
  /** Not necessarily a declared subject — same. */
  readonly subject: string;
  /** The instance under `resource.*`, when the row supplies one. */
  readonly resource?: Record<string, unknown>;
  /** Ambient attributes under `env.*`, when the row supplies any. */
  readonly env?: Record<string, unknown>;
  /** The answer `can()` must give. */
  readonly allowed: boolean;
  /** The reason `explain()` must give. */
  readonly reason: DecisionReason;
  /** The rule `explain()` must credit, when a rule decided. */
  readonly ruleId?: string;
}

const anonymous = null;
const reader: Principal = { id: 'u-reader', roles: ['reader'] };
const author: Principal = { id: 'u-author', roles: ['author'] };
const editor: Principal = { id: 'u-editor', roles: ['editor'] };
const admin: Principal = { id: 'u-admin', roles: ['admin'] };
const suspendedAuthor: Principal = { id: 'u-author', roles: ['author', 'suspended'] };
/** An author the session forgot to give an id to. Ownership must not grant. */
const ghostAuthor: Principal = { roles: ['author'] };
/** The issuer says `Admin`; the policy declares `admin`. Drift must not grant. */
const driftedAdmin: Principal = { id: 'u-drift', roles: ['Admin'] };

const ownPost = { id: 'p1', authorId: 'u-author', locked: false };
const otherPost = { id: 'p2', authorId: 'u-other', locked: false };
const lockedPost = { id: 'p3', authorId: 'u-author', locked: true };
/** `authorId` explicitly null — the row exists, nobody owns it. */
const orphanPost = { id: 'p4', authorId: null, locked: false };
/** No `locked` field at all — the deny rule cannot be ruled out. */
const unlabelledPost = { id: 'p5', authorId: 'u-author' };
const ownComment = { id: 'c1', authorId: 'u-author' };
const otherComment = { id: 'c2', authorId: 'u-other' };
const ownUser = { id: 'u-author' };
const otherUser = { id: 'u-other' };

const live = { maintenance: false };
const maintenance = { maintenance: true };

export const decisionTable: readonly DecisionCase[] = [
  // --- public reads, including for callers with no identity at all ---
  {
    name: 'anonymous reads a post',
    principal: anonymous,
    action: 'read',
    subject: 'post',
    allowed: true,
    reason: 'allowed',
    ruleId: 'anyone-reads-posts',
  },
  {
    name: 'anonymous reads a comment',
    principal: anonymous,
    action: 'read',
    subject: 'comment',
    allowed: true,
    reason: 'allowed',
    ruleId: 'anyone-reads-comments',
  },
  {
    name: 'a role the policy never declared still gets the public read',
    principal: driftedAdmin,
    action: 'read',
    subject: 'post',
    allowed: true,
    reason: 'allowed',
    ruleId: 'anyone-reads-posts',
  },

  // --- self-service: an ownership rule with no roles on it ---
  {
    name: 'an author reads their own account',
    principal: author,
    action: 'read',
    subject: 'user',
    resource: ownUser,
    allowed: true,
    reason: 'allowed',
    ruleId: 'anyone-manages-their-own-account',
  },
  {
    name: 'an author updates their own account',
    principal: author,
    action: 'update',
    subject: 'user',
    resource: ownUser,
    allowed: true,
    reason: 'allowed',
    ruleId: 'anyone-manages-their-own-account',
  },
  {
    name: 'an author cannot read someone else’s account',
    principal: author,
    action: 'read',
    subject: 'user',
    resource: otherUser,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'a principal with no id cannot own an account',
    principal: ghostAuthor,
    action: 'read',
    subject: 'user',
    resource: ownUser,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an anonymous caller cannot own an account',
    principal: anonymous,
    action: 'read',
    subject: 'user',
    resource: ownUser,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'asking about an account with no account in hand denies',
    principal: author,
    action: 'read',
    subject: 'user',
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an admin reads an account without one in hand, via the wildcard grant',
    principal: admin,
    action: 'read',
    subject: 'user',
    allowed: true,
    reason: 'allowed',
    ruleId: 'admin-everything',
  },

  // --- role-gated creation ---
  {
    name: 'an author creates a post',
    principal: author,
    action: 'create',
    subject: 'post',
    allowed: true,
    reason: 'allowed',
    ruleId: 'authors-create-posts',
  },
  {
    name: 'a reader cannot create a post',
    principal: reader,
    action: 'create',
    subject: 'post',
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an anonymous caller cannot create a post',
    principal: anonymous,
    action: 'create',
    subject: 'post',
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'a mis-cased admin role grants nothing',
    principal: driftedAdmin,
    action: 'create',
    subject: 'post',
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an admin creates a post through the wildcard grant',
    principal: admin,
    action: 'create',
    subject: 'post',
    allowed: true,
    reason: 'allowed',
    ruleId: 'admin-everything',
  },
  {
    name: 'a suspended author is denied outright',
    principal: suspendedAuthor,
    action: 'create',
    subject: 'post',
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'suspended-accounts-write-nothing',
  },

  // --- ownership on update ---
  {
    name: 'an author updates their own post',
    principal: author,
    action: 'update',
    subject: 'post',
    resource: ownPost,
    allowed: true,
    reason: 'allowed',
    ruleId: 'authors-edit-own-posts',
  },
  {
    name: 'an author cannot update someone else’s post',
    principal: author,
    action: 'update',
    subject: 'post',
    resource: otherPost,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an author cannot update a post with a null author',
    principal: author,
    action: 'update',
    subject: 'post',
    resource: orphanPost,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'a principal with no id cannot own a post with no author',
    principal: ghostAuthor,
    action: 'update',
    subject: 'post',
    resource: orphanPost,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an anonymous caller cannot update a post they were handed',
    principal: anonymous,
    action: 'update',
    subject: 'post',
    resource: ownPost,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'updating with no post in hand cannot rule out the lock, so it denies',
    principal: author,
    action: 'update',
    subject: 'post',
    allowed: false,
    reason: 'unresolved_deny',
    ruleId: 'locked-posts-are-frozen',
  },
  {
    name: 'a post with no lock field cannot rule out the lock either',
    principal: author,
    action: 'update',
    subject: 'post',
    resource: unlabelledPost,
    allowed: false,
    reason: 'unresolved_deny',
    ruleId: 'locked-posts-are-frozen',
  },
  {
    name: 'a lock outranks an author’s ownership',
    principal: author,
    action: 'update',
    subject: 'post',
    resource: lockedPost,
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'locked-posts-are-frozen',
  },
  {
    name: 'a lock outranks the admin wildcard grant',
    principal: admin,
    action: 'update',
    subject: 'post',
    resource: lockedPost,
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'locked-posts-are-frozen',
  },
  {
    name: 'an admin updates an unlocked post they do not own',
    principal: admin,
    action: 'update',
    subject: 'post',
    resource: otherPost,
    allowed: true,
    reason: 'allowed',
    ruleId: 'admin-everything',
  },
  {
    name: 'a suspended author cannot update even their own post',
    principal: suspendedAuthor,
    action: 'update',
    subject: 'post',
    resource: ownPost,
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'suspended-accounts-write-nothing',
  },

  // --- deletion, where an env-conditioned deny also applies ---
  {
    name: 'deleting without the ambient state the policy asks about denies',
    principal: author,
    action: 'delete',
    subject: 'post',
    resource: ownPost,
    allowed: false,
    reason: 'unresolved_deny',
    ruleId: 'no-deletions-during-maintenance',
  },
  {
    name: 'an author deletes their own post outside maintenance',
    principal: author,
    action: 'delete',
    subject: 'post',
    resource: ownPost,
    env: live,
    allowed: true,
    reason: 'allowed',
    ruleId: 'authors-edit-own-posts',
  },
  {
    name: 'maintenance denies the same deletion',
    principal: author,
    action: 'delete',
    subject: 'post',
    resource: ownPost,
    env: maintenance,
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'no-deletions-during-maintenance',
  },
  {
    name: 'an admin deletes an unlocked post outside maintenance',
    principal: admin,
    action: 'delete',
    subject: 'post',
    resource: ownPost,
    env: live,
    allowed: true,
    reason: 'allowed',
    ruleId: 'admin-everything',
  },
  {
    name: 'a lock outranks the admin grant on deletion too',
    principal: admin,
    action: 'delete',
    subject: 'post',
    resource: lockedPost,
    env: live,
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'locked-posts-are-frozen',
  },
  {
    name: 'an author deletes their own comment',
    principal: author,
    action: 'delete',
    subject: 'comment',
    resource: ownComment,
    env: live,
    allowed: true,
    reason: 'allowed',
    ruleId: 'authors-delete-own-comments',
  },
  {
    name: 'an author cannot delete someone else’s comment',
    principal: author,
    action: 'delete',
    subject: 'comment',
    resource: otherComment,
    env: live,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'deleting a comment without the ambient state denies',
    principal: author,
    action: 'delete',
    subject: 'comment',
    resource: ownComment,
    allowed: false,
    reason: 'unresolved_deny',
    ruleId: 'no-deletions-during-maintenance',
  },

  // --- inherited roles ---
  {
    name: 'an editor publishes',
    principal: editor,
    action: 'publish',
    subject: 'post',
    resource: ownPost,
    allowed: true,
    reason: 'allowed',
    ruleId: 'editors-publish',
  },
  {
    name: 'an author does not inherit the editor’s publish right',
    principal: author,
    action: 'publish',
    subject: 'post',
    resource: ownPost,
    allowed: false,
    reason: 'no_matching_rule',
  },
  {
    name: 'an editor inherits the author’s ownership right',
    principal: editor,
    action: 'update',
    subject: 'post',
    resource: { id: 'p6', authorId: 'u-editor', locked: false },
    allowed: true,
    reason: 'allowed',
    ruleId: 'authors-edit-own-posts',
  },
  {
    name: 'an admin inherits transitively, two levels down',
    principal: admin,
    action: 'publish',
    subject: 'post',
    resource: ownPost,
    allowed: true,
    reason: 'allowed',
    ruleId: 'admin-everything',
  },
  {
    name: 'a lock still outranks an editor’s publish right',
    principal: editor,
    action: 'publish',
    subject: 'post',
    resource: lockedPost,
    allowed: false,
    reason: 'explicit_deny',
    ruleId: 'locked-posts-are-frozen',
  },
  {
    name: 'an editor moderates comments',
    principal: editor,
    action: 'moderate',
    subject: 'comment',
    allowed: true,
    reason: 'allowed',
    ruleId: 'editors-moderate',
  },
  {
    name: 'an author does not moderate comments',
    principal: author,
    action: 'moderate',
    subject: 'comment',
    allowed: false,
    reason: 'no_matching_rule',
  },

  // --- the universe is closed ---
  {
    name: 'an admin cannot take an action the policy never declared',
    principal: admin,
    action: 'frobnicate',
    subject: 'post',
    allowed: false,
    reason: 'unknown_action',
  },
  {
    name: 'an admin cannot act on a subject the policy never declared',
    principal: admin,
    action: 'read',
    subject: 'wizzbang',
    allowed: false,
    reason: 'unknown_subject',
  },
  {
    name: 'an anonymous caller cannot either',
    principal: anonymous,
    action: 'frobnicate',
    subject: 'wizzbang',
    allowed: false,
    reason: 'unknown_action',
  },
];
