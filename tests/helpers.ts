// from packages
import {
  createServer,
  IncomingMessage,
  request,
  RequestOptions,
  ServerResponse,
} from 'http';
import { Writable } from 'stream';

export interface WaterfallEntry {
  actual?: {
    body: string;
    status: number;
  };
  expected?: number | {
    status: number;
    body: string;
  };
  path: string;
  method: string;
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
    return new Promise<{status: number; body: string}>((resolve) => request(
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
      method: e.method,
      path: e.path,
      port,
    })),
  );

  // Check responses
  for (const {expected, actual} of entries) {
    if ('number' === typeof expected)  {
      expect(actual.status).toBe(expected);
    } else if ('object' === typeof expected) {
      if ('string' === typeof expected.body) {
        expect(actual.body).toBe(expected.body);
      }

      if ('number' === typeof expected.status) {
        expect(actual.status).toBe(expected.status);
      }
    }
  }

  // Stop server
  await new Promise((resolve) => server.close(resolve));
}
