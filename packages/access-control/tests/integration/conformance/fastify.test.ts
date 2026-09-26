import { createFastifyServer } from './fastify-server.js';
import { runGuardConformanceSuite } from './conformance-suite.js';

runGuardConformanceSuite('Fastify', createFastifyServer);
