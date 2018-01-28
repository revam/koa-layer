// from packages
import * as koa from 'koa';
// from library
import { Layer } from '../src';
import { waterfall } from './helpers';

/**
 * Test app 1
 *
 *  UPPERCASE  -> method
 *  have GET?  -> also HEAD
 * 'in quotes' -> response
 *
 *                    R <- entry point
 *                    |
 *          DELETE -> L
 *                   / \
 *      'delete' -> O   * <- middleware
 *                      |
 *                      |    GET,POST,PUT +
 *                      L <- path.length > 1
 *                     / \
 *                    /   L <- PUT
 *                   |   / \
 *        GET,POST + -> L   O <- 'put'
 *   path.length > 2 | / \
 *                   |/   L <- POST
 *                   |   / \
 *                    \ /   O <- 'post'
 *                     |
 *                     O <- 'get'
 */
function create_test_app_1(methods: koa.Middleware, middleware?: koa.Middleware[]) {
  const app = new koa();

  if (middleware && middleware.length) {
    middleware.forEach((m) => app.use(m));
  }

  app.use(Layer.match({
    handler: async(ctx) => {
      ctx.body = 'delete';
    },
    method: 'delete',
  }));

  app.use(methods);

  app.use(Layer.match({
    handlers: [
      Layer.match({
        handler: async(ctx) => {
          ctx.body = 'put';
        },
        method: 'put',
      }),
      Layer.match({
        conditional(ctx) { return ctx.method !== 'GET' || ctx.path.length > 2; },
        handler: Layer.match({
          handler: (ctx) => {
            ctx.body = 'post';
          },
          method: 'post',
        }),
        methods: ['get', 'post'],
      }),
    ],
    methods: ['get' , 'put', 'post'],
    conditional(ctx) { return ctx.method !== 'GET' || ctx.path.length > 1; },
  }));

  app.use(Layer.match({
    handler: async(ctx) => {
      ctx.body = 'get';
    },
    method: 'get',
  }));

  return app;
}

/**
 * Test app 2
 *
 *  UPPERCASE  -> method
 *  have GET?  -> also HEAD
 * 'in quotes' -> response
 *
 * (If we accept GET, we also accept HEAD)
 *
 *               R <- entry point
 *               |
 *               L <- DELETE
 *              / \
 *   DELETE -> O   L <- GET,POST
 *                / \
 *               |   * <- middleware
 *               |   |
 *               |   L <- POST
 *                \ / \
 *          GET -> O   O <- POST
 */
function create_test_app_2(methods: koa.Middleware, middleware?: koa.Middleware[]) {
  const app = new koa();

  if (middleware && middleware.length) {
    middleware.forEach((m) => app.use(m));
  }

  app.use(Layer.match({
    handler: async(ctx) => {
      ctx.body = 'delete';
    },
    method: 'delete',
  }));

  app.use(Layer.match({
    handlers: [
      methods,
      Layer.match({
        handler: (ctx) => {
          ctx.body = 'post';
        },
        method: 'post',
      }),
    ],
    methods: ['get', 'post'],
  }));

  app.use(Layer.match({
    handler(ctx, next) {
      ctx.body = 'get';

      return next();
    },
    method: 'get',
  }));

  return app;
}

/**
 *             _ <- entry point
 *             |
 *             *
 *             L <- POST,PUT,DELETE
 *             |\
 *             | L <- POST,PUT
 *             | |\
 *             | | |
 *             | |/
 *             | L <- POST
 *             | |\
 *        PUT -> L O <- Not implemented
 *      GET    |/ \
 *   DELETE -> O   O <- 'put'
 */
function create_test_app_3(methods: koa.Middleware, middleware?: koa.Middleware[]) {
  const app = new koa();

  if (middleware && middleware.length) {
    middleware.forEach((m) => app.use(m));
  }

  app.use(methods);

  app.use(Layer.match({
    handlers: [
      Layer.match({
        handler: (ctx, next) => next(),
        methods: ['post', 'put'],
      }),
      // Not implemented
      Layer.match({
        handler(ctx) { /**/ },
        method: 'post',
      }),
      // Implemented
      Layer.match({
        handler(ctx) { ctx.body = 'put'; },
        method: 'put',
      }),
    ],
    methods: ['post', 'put', 'delete'],
  }));

  app.use(Layer.match({
    conditional(ctx) { return ctx.path !== '/not-found'; },
    handler(ctx) { ctx.status = 200; },
    methods: ['get', 'delete'],
  }));

  return app;
}

describe('Layer.method_not_allowed', () => {

  it('check default routes for test case 1', async(done) => {
    const app1 = create_test_app_1(Layer.check());

    await waterfall(
      app1.callback(),
      {
        expected: {
          body: 'get',
          status: 200,
        },
      },
      {
        expected: {
          body: '',
          status: 200,
        },
        method: 'head',
      },
      {
        expected: 'delete',
        method: 'delete',
      },
      {
        expected: 'get',
        path: '/1',
      },
      {
        expected: '',
        method: 'head',
        path: '/1',
      },
      {
        expected: 'put',
        method: 'put',
      },
      {
        expected: 'get',
        path: '/12',
      },
      {
        expected: 'post',
        method: 'post',
      },
    );

    done();
  });

  it('check default routes for test case 2', async(done) => {
    const app2 = create_test_app_2(Layer.check());

    await waterfall(
      app2.callback(),
      {
        expected: {
          body: 'get',
          status: 200,
        },
        method: 'GET',
      },
      {
        expected: {
          body: 'delete',
          status: 200,
        },
        method: 'DELETE',
      },
      {
        expected: {
          body: 'post',
          status: 200,
        },
        method: 'post',
      },
      {
        expected: {
          body: 'get',
          status: 200,
        },
        method: 'get',
      },
    );

    done();
  });

  it('should support 405 Method Not Allowed', async(done) => {
    const app1 = create_test_app_1(Layer.check());
    const app3 = create_test_app_3(Layer.check());

    await waterfall(
      app1.callback(),
      {
        expected: {
          allow: [
            'DELETE',
            'GET',
            'HEAD',
            'POST',
            'PUT',
            'OPTIONS',
          ],
          body: 'Method Not Allowed',
          status: 405,
        },
        method: 'patch',
      },
    );

    await waterfall(
      app3.callback(),
      {
        expected: {
          allow: [
            'DELETE',
            'GET',
            'HEAD',
            'POST',
            'PUT',
            'OPTIONS',
          ],
          body: 'Method Not Allowed',
          status: 405,
        },
        method: 'patch',
      },
    );

    done();
  });

  it('should support 501 Not Implemented', async(done) => {
    /**
     *    _ <- entry point
     *    |
     *    * <- middleware
     *    |
     *    L <- layer
     *    |
     *    O <- not implemented
     */
    const app = new koa();

    app.use(Layer.check());

    app.use(Layer.match({
      handler: async(ctx) => expect(ctx.path).toBe('/123'),
    }));

    await waterfall(
      app.callback(),
      {
        expected: {
          // Default allowed methods
          allow: [
            'OPTIONS',
            'GET',
            'HEAD',
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
          ],
          body: 'Not Implemented',
          status: 501,
        },
        path: '/123',
      },
    );

    await waterfall(
      create_test_app_3(Layer.check()).callback(),
      {
        expected: 200,
        method: 'get',
      },
      {
        expected: 200,
        method: 'delete',
      },
      {
        expected: 501,
        method: 'post',
      },
      {
        expected: 200,
        method: 'put',
      },
      {
        expected: 404,
        path: '/not-found',
      },
    );
    done();
  });

  it('should respond to OPTIONS', async(done) => {
    const app1 = create_test_app_1(Layer.check());
    const app2 = create_test_app_2(Layer.check());
    const app3 = create_test_app_3(Layer.check());

    // Test case 1 uses middleware in top chain.
    await waterfall(
      app1.callback(),
      {
        expected: {
          allow: [
            'DELETE',
            'GET',
            'HEAD',
            'POST',
            'PUT',
            'OPTIONS',
          ],
          body: '',
          status: 200,
        },
        method: 'OPTIONS',
      },
    );

    // Test case 2 uses middleware in a layer.
    await waterfall(
      app2.callback(),
      {
        expected: 404,
        method: 'OPTIONS',
      },
    );

    // Test case 2 uses middleware in a layer.
    await waterfall(
      app3.callback(),
      {
        expected: {
          allow: [
            'OPTIONS',
            'POST',
            'PUT',
            'DELETE',
            'GET',
            'HEAD',
          ],
          body: '',
          status: 200,
        },
        method: 'OPTIONS',
      },
    );

    done();
  });
});
