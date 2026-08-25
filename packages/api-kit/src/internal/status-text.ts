/**
 * RFC 7807 `title` is meant to stay constant across every occurrence of a
 * given problem *type*, unlike `detail` (which is occurrence-specific). The
 * HTTP status reason phrase is the one piece of information that is always
 * available, always stable, and never leaks anything about the specific
 * failure — so it is what {@link toProblemDetails} (`../problem-details.ts`)
 * uses for `title`, leaving `detail` to carry the error's own message.
 *
 * Covers the statuses `@firstprinciples/core`'s built-in error classes use
 * by default, plus the common REST-API statuses a hand-rolled `AppError`
 * is likely to set explicitly.
 */
const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

/**
 * The HTTP reason phrase for `status`, or a generic `Error <status>` for
 * one outside the table above — never `undefined`, since RFC 7807 requires
 * `title` to be present.
 */
export function statusText(status: number): string {
  // `status` is a numeric HTTP status code, never a caller-controlled
  // object key — there is no injection sink.
  // eslint-disable-next-line security/detect-object-injection
  return STATUS_TEXT[status] ?? `Error ${status}`;
}
