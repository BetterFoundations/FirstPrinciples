import { definePolicy, owns } from '../../src/index.js';

/**
 * The one policy every surface in this package is tested against.
 *
 * It is deliberately not minimal. It carries a wildcard admin grant, a
 * role hierarchy, two ownership rules, a conditional deny that outranks
 * the admin grant, a role-targeted deny, an `env`-conditioned deny, and
 * a public rule that anonymous callers satisfy — because the
 * interactions between those are where a permission engine goes wrong,
 * and a fixture that only exercises one at a time cannot catch them.
 */
export const sharedPolicy = definePolicy({
  actions: ['read', 'create', 'update', 'delete', 'publish', 'moderate'],
  subjects: ['post', 'comment', 'user'],
  roles: {
    admin: ['editor'],
    editor: ['author'],
    author: [],
    reader: [],
    suspended: [],
  },
  rules: [
    {
      id: 'admin-everything',
      description: 'Admins may do anything the policy declares.',
      effect: 'allow',
      actions: '*',
      subjects: '*',
      roles: ['admin'],
    },
    {
      id: 'anyone-reads-posts',
      description: 'Posts are public, anonymous callers included.',
      effect: 'allow',
      actions: ['read'],
      subjects: ['post'],
    },
    {
      id: 'anyone-reads-comments',
      effect: 'allow',
      actions: ['read'],
      subjects: ['comment'],
    },
    {
      id: 'authors-create-posts',
      effect: 'allow',
      actions: ['create'],
      subjects: ['post'],
      roles: ['author'],
    },
    {
      id: 'authors-edit-own-posts',
      effect: 'allow',
      actions: ['update', 'delete'],
      subjects: ['post'],
      roles: ['author'],
      when: owns('authorId'),
    },
    {
      id: 'authors-delete-own-comments',
      effect: 'allow',
      actions: ['delete'],
      subjects: ['comment'],
      roles: ['author'],
      when: owns('authorId'),
    },
    {
      id: 'editors-publish',
      effect: 'allow',
      actions: ['publish'],
      subjects: ['post'],
      roles: ['editor'],
    },
    {
      id: 'editors-moderate',
      effect: 'allow',
      actions: ['moderate'],
      subjects: ['comment'],
      roles: ['editor'],
    },
    {
      id: 'anyone-manages-their-own-account',
      effect: 'allow',
      actions: ['read', 'update'],
      subjects: ['user'],
      when: { path: 'resource.id', op: 'eq', ref: 'principal.id' },
    },
    {
      id: 'locked-posts-are-frozen',
      description: 'Outranks the admin grant: a lock is a lock.',
      effect: 'deny',
      actions: ['update', 'delete', 'publish'],
      subjects: ['post'],
      when: { path: 'resource.locked', op: 'eq', value: true },
    },
    {
      id: 'suspended-accounts-write-nothing',
      effect: 'deny',
      actions: ['create', 'update', 'delete', 'publish', 'moderate'],
      subjects: '*',
      roles: ['suspended'],
    },
    {
      id: 'no-deletions-during-maintenance',
      effect: 'deny',
      actions: ['delete'],
      subjects: '*',
      when: { path: 'env.maintenance', op: 'eq', value: true },
    },
  ],
});
