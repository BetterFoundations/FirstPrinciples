import { createExpressServer } from './express-server.js';
import { runGuardConformanceSuite } from './conformance-suite.js';

runGuardConformanceSuite('Express', createExpressServer);
