import { createFastifyServer } from './fastify-server.js';
import { runConformanceSuite } from './conformance-suite.js';

runConformanceSuite('Fastify', createFastifyServer);
