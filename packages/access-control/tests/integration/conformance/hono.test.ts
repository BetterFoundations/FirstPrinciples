import { createHonoServer } from './hono-server.js';
import { runGuardConformanceSuite } from './conformance-suite.js';

runGuardConformanceSuite('Hono', createHonoServer);
