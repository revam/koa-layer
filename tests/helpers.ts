// from packages
import {
  createServer,
  IncomingHttpHeaders,
  IncomingMessage,
  request,
  RequestOptions,
  ServerResponse,
} from 'http';
import { Writable } from 'stream';

export interface WaterfallEntry {
  actual?: {
    body: string;
    headers: IncomingHttpHeaders;
    status: number;
  };
  expected: number | string | string[] | {
    status?: number;
    allow?: string | string[];
    body?: string;
  };
  path?: string;
  method?: string;
}

export async function waterfall(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  ...entries: WaterfallEntry[],
) {
  const server = createServer(handler);

  // Start server
  await new Promise((resolve) => server.listen(resolve));

  const {port} = server.address();

  function send(options: RequestOptions) {
    return new Promise<{status: number; body: string; headers: IncomingHttpHeaders}>((resolve) => request(
      {...options, port},
      (res) => {
        const buffers: Buffer[] = [];
        res.pipe(new Writable({
          async write(buffer: Buffer, encoding, next) {
            buffers.push(buffer);

            next();
          },
          final() {
            resolve({
              body: Buffer.concat(buffers).toString('utf8'),
              headers: res.headers,
              status: res.statusCode,
            });
          },
        }));
      }).end(),
    );
  }

  // Send requests
  await Promise.all(
    entries.map(async(e) => e.actual = await send({
      method: (e.method || 'GET').toUpperCase(),
      path: e.path || '/',
      port,
    })),
  );

  // Stop server
  await new Promise((resolve) => server.close(resolve));

  // Check responses
  for (const {expected, actual} of entries) {
    if ('number' === typeof expected)  {
      expect(actual.status).toBe(expected);
    } else if ('string' === typeof expected) {
      expect(actual.body).toBe(expected);
    } else if (expected instanceof Array) {
      expect(actual.headers).toHaveProperty('allow');
      if ('allow' in actual.headers) {
        const methods = actual.headers.allow instanceof Array ?
          actual.headers.allow :
          actual.headers.allow.split(',');

        expect(methods).toHaveLength(expected.length);

        if (methods.length === expected.length) {
          methods.forEach((method) => expect(expected).toContain(method));
        }
      }
    } else if ('object' === typeof expected) {
      if ('string' === typeof expected.body) {
        expect(actual.body).toBe(expected.body);
      }

      if ('number' === typeof expected.status) {
        expect(actual.status).toBe(expected.status);
      }

      if (expected.allow) {
        expect(actual.headers).toHaveProperty('allow');
        if ('allow' in actual.headers) {
          const methods = actual.headers.allow instanceof Array ?
            actual.headers.allow :
            actual.headers.allow.split(',');

          if (expected.allow instanceof Array) {
            expect(methods).toHaveLength(expected.allow.length);

            if (methods.length === expected.allow.length) {
              methods.forEach((method) => expect(expected.allow).toContain(method));
            }
          } else {
            expect(methods).toContain(expected.allow);
          }
        }
      }
    }
  }
}
