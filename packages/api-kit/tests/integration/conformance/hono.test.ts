import { createHonoServer } from './hono-server.js';
import { runConformanceSuite } from './conformance-suite.js';

runConformanceSuite('Hono', createHonoServer);
