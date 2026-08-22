import pino from 'pino';
import type { LogEntry, Transport } from './types.js';

/**
 * The default Node transport: writes already-redacted entries through pino.
 * Pino only ever sees the post-redaction fields — it never has a chance to
 * serialize a raw secret, since redaction happens upstream of every
 * transport, this one included.
 */
export function createPinoTransport(name: string | undefined): Transport {
  const instance = pino({ ...(name === undefined ? {} : { name }), base: null, timestamp: false });
  return {
    name: 'pino',
    write(entry: LogEntry) {
      const bindings = entry.correlationId
        ? { ...entry.fields, correlationId: entry.correlationId }
        : entry.fields;
      instance[entry.level]({ ...bindings, time: entry.time }, entry.msg);
    },
  };
}
