// Runnable usage example for \@firstprinciples/access-control.
//
// Run with: pnpm --filter examples-access-control start
//
// One policy, three consumers: the engine directly, a real Express server
// guarded by it, and a browser's view of it rendered through react-dom/server
// after a round trip through JSON. The point of the third part is that no
// rule is written twice — the client decides from the same bytes the server
// sent it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import express from 'express';
import { isErr } from '@firstprinciples/core';
import {
  createAccessControl,
  definePolicy,
  owns,
  parsePolicy,
  PermissionDeniedError,
  type Principal,
} from '@firstprinciples/access-control';
import { createExpressGuard, type PermissionGrant } from '@firstprinciples/access-control/express';
import { AccessControlProvider, Can } from '@firstprinciples/access-control/react';

// ---------------------------------------------------------------------------
// The policy. Plain data — this object is what gets shipped to the browser.
// ---------------------------------------------------------------------------

const policy = definePolicy({
  actions: ['read', 'update', 'delete'],
  subjects: ['post'],
  roles: { admin: ['author'], author: [] },
  rules: [
    { id: 'admins-do-anything', effect: 'allow', actions: '*', subjects: '*', roles: ['admin'] },
    { id: 'posts-are-public', effect: 'allow', actions: ['read'], subjects: ['post'] },
    {
      id: 'authors-edit-their-own',
      effect: 'allow',
      actions: ['update', 'delete'],
      subjects: ['post'],
      roles: ['author'],
      when: owns('authorId'),
    },
    {
      id: 'locked-posts-are-frozen',
      effect: 'deny',
      actions: ['update', 'delete'],
      subjects: ['post'],
      when: { path: 'resource.locked', op: 'eq', value: true },
    },
  ],
});

const ac = createAccessControl(policy);

const ada: Principal = { id: 'u-ada', roles: ['author'] };
const grace: Principal = { id: 'u-grace', roles: ['author'] };
const root: Principal = { id: 'u-root', roles: ['admin'] };

const posts = new Map([
  ['1', { id: '1', title: 'Notes on the Analytical Engine', authorId: 'u-ada', locked: false }],
  ['2', { id: '2', title: 'On compilers', authorId: 'u-grace', locked: false }],
  ['3', { id: '3', title: 'Frozen announcement', authorId: 'u-ada', locked: true }],
  ['4', { id: '4', title: 'Orphaned draft', authorId: null, locked: false }],
]);

const show = (label: string, allowed: boolean): void => {
  console.log(`  ${allowed ? '✓ allow' : '✗ deny '}  ${label}`);
};

// ---------------------------------------------------------------------------
// 1. The engine on its own.
// ---------------------------------------------------------------------------

console.log('\n1. The engine\n');

show('anyone reads a post', ac.for(null).can('read', 'post'));
show('ada updates her own post', ac.for(ada).can('update', 'post', { resource: posts.get('1') }));
show("ada updates grace's post", ac.for(ada).can('update', 'post', { resource: posts.get('2') }));
show('an admin updates any post', ac.for(root).can('update', 'post', { resource: posts.get('2') }));

console.log('\n   …and the cases that are easy to get wrong:\n');

// A deny outranks the admin wildcard. There is no priority field to tweak.
show(
  'an admin updates a LOCKED post',
  ac.for(root).can('update', 'post', { resource: posts.get('3') }),
);

// No resource in hand, so the lock rule cannot be ruled out.
show('ada updates "a post", with no post in hand', ac.for(ada).can('update', 'post'));

// authorId is null and the caller is anonymous. Two absent values must not
// compare equal — this is the ownership bug the engine exists to prevent.
show(
  'an anonymous caller updates an unowned post',
  ac.for(null).can('update', 'post', { resource: posts.get('4') }),
);

console.log('\n   explain() says why:\n');
console.log('  ', ac.for(ada).explain('update', 'post'));
console.log('  ', ac.for(root).explain('update', 'post', { resource: posts.get('3') }));

// ---------------------------------------------------------------------------
// 2. The same policy guarding a real Express server.
// ---------------------------------------------------------------------------

console.log('\n2. The same policy, guarding HTTP routes\n');

const app = express();

// The caller comes from a header here; in a real app it comes from whatever
// your authentication middleware attached to the request.
const principals: Record<string, Principal> = { ada, grace, root };

// The reason and the deciding rule never reach the client — this hook is
// where a server records them. Collected here so the output below can show
// each denial next to the response it produced.
let lastDenial = '';
const requirePermission = createExpressGuard(ac, {
  getPrincipal: (req) => principals[String(req.header('x-user') ?? '')] ?? null,
  onDeny: ({ decision }) => {
    lastDenial = `reason=${decision.reason} rule=${decision.ruleId ?? '-'}`;
  },
});

app.patch(
  '/posts/:id',
  requirePermission('update', 'post', { getResource: (req) => posts.get(req.params.id) }),
  (_req, res) => {
    // The guard already loaded the post to check ownership — reuse it.
    const { resource } = res.locals['permission'] as PermissionGrant;
    res.json({ updated: (resource as { id: string }).id });
  },
);

// Express recognizes error-handling middleware by arity — a function
// declaring exactly 4 parameters — so `_next` must stay declared even though
// this handler is always the end of the chain. The disable has to sit on the
// line immediately above the parameter list, hence the named const.
const errorHandler: express.ErrorRequestHandler =
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (error, _req, res, _next) => {
    if (error instanceof PermissionDeniedError) {
      // toJSON() carries the action and subject only. The reason and the rule
      // that decided stay server-side, on the error instance.
      res.status(error.httpStatus).json(error.toJSON());
      return;
    }
    res.status(500).json({ code: 'INTERNAL_ERROR' });
  };

app.use(errorHandler);

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address() as { port: number };

const attempt = async (user: string, postId: string, note: string): Promise<void> => {
  lastDenial = '';
  const response = await fetch(`http://127.0.0.1:${port}/posts/${postId}`, {
    method: 'PATCH',
    headers: { 'x-user': user },
  });
  await response.json();
  const label = `PATCH /posts/${postId} as ${user}`.padEnd(28);
  console.log(`  ${response.status}  ${label}${note}`);
  if (lastDenial !== '') console.log(`       server-side only: ${lastDenial}`);
};

await attempt('ada', '1', 'her own, unlocked');
await attempt('ada', '2', "someone else's");
await attempt('root', '3', 'admin, but the post is locked');
await attempt('nobody', '1', 'anonymous');
await attempt('ada', '999', 'no such post — 403, not 404');

console.log('\n  The 403 bodies carry only the action and subject the caller already named:');
console.log('  {"code":"PERMISSION_DENIED","details":{"action":"update","subject":"post"}, …}');

server.close();

// ---------------------------------------------------------------------------
// 3. The browser's view — same policy, sent as JSON.
// ---------------------------------------------------------------------------

console.log('\n3. The browser, from the same bytes\n');

const overTheWire = JSON.stringify(policy);
console.log(`   the server sends ${overTheWire.length} bytes of JSON\n`);

const parsed = parsePolicy(JSON.parse(overTheWire));
if (isErr(parsed)) throw parsed.error;

// createAccessControl refuses an unvalidated policy, so the round trip has to
// go back through parsePolicy — the brand deliberately does not survive JSON.
const clientAc = createAccessControl(parsed.value);

const renderToolbar = (principal: Principal | null, post: unknown): string =>
  renderToStaticMarkup(
    createElement(
      AccessControlProvider,
      { accessControl: clientAc, principal },
      createElement(
        Can,
        { action: 'update', subject: 'post', resource: post as object },
        createElement('button', null, 'Edit'),
      ),
      createElement(
        Can,
        { action: 'delete', subject: 'post', resource: post as object },
        createElement('button', null, 'Delete'),
      ),
    ),
  );

console.log(`   ada,   post 1: ${renderToolbar(ada, posts.get('1')) || '(no buttons)'}`);
console.log(`   grace, post 1: ${renderToolbar(grace, posts.get('1')) || '(no buttons)'}`);
console.log(`   root,  post 3: ${renderToolbar(root, posts.get('3')) || '(no buttons)'}`);
console.log('\n   Grace sees no buttons, and the server would refuse her anyway.');
console.log('   Root sees none on the locked post, for the same reason the API');
console.log('   returned 403 above — one rule, decided twice, identically.\n');
