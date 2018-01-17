// from packages
import * as koa from 'koa';
// from library
import { Layer } from '../src';
import { waterfall } from './helpers';

/**
 * Test case 1
 *
 * If we accepts GET, we also accepts HEAD.
 *
 *               R <- Entry point
 *               |
 *     DELETE -> L
 *              / \
 *   DELETE -> O   * <- Our middleware
 *                 |
 *                 L <- GET,POST,PUT
 *                / \
 *               /   L <- PUT
 *              |   / \
 *     GET,POST -> L   O <- PUT
 *              | / \
 *              |/   L <- POST
 *              |   / \
 *               \ /   O <- POST
 *                |
 *                O <- GET
 */
function create_test_app_1() {
  const app = new koa();

  app.use(Layer.match({
    handler: async(ctx) => {
      ctx.body = 'endpoint 1';
    },
    method: 'DELETE',
    path: 'endpoint1',
  }));

  app.use(Layer.method_not_allowed);

  app.use(Layer.match({
    handlers: [
      Layer.match({
        conditional: (ctx) => ctx.params.path === '+1',
        handler: async(ctx) => {
          ctx.body = 'endpoint 2';
        },
        method: 'put',
      }),
      Layer.match({
        conditional: (ctx) => ctx.params.path,
        handler: Layer.match({
          conditional: (ctx) => ctx.params.path === '+3',
          handler: (ctx) => {
            ctx.body = 'endpoint 3';
          },
          method: 'post',
        }),
        methods: ['get', 'post'],
      }),
    ],
    methods: ['get' , 'put', 'post'],
    path: 'endpoint2/:path(.*)?',
  }));

  app.use(async(ctx) => {
    ctx.body = 'default route';
  });

  return app;
}

/**
 * Test case 2
 *
 *     R <- Entry point
 *     |
 *     L
 *    / \
 *   O   L <- Layers
 *      / \
 *     /   L
 *    |   / \
 *    |  L   * <- Our middleware
 *    | / \   \
 *    |/   L   O <- Endpoints
 *    |   / \
 *     \ /   O
 *      O
 */
function create_test_app_2() {
  const app = new koa();

  return app;
}

/**
 * Test case 3
 *
 *     R <- Entry point
 *     |
 *     * <- Our middleware
 *     |
 *     L
 *    / \
 *   O   L <- Layers
 *      / \
 *     /   L
 *    |   / \
 *    |  L   O <- Endpoints
 *    | / \
 *    |/   L
 *    |   / \
 *     \ /   O
 *      O
 */
function create_test_app_3() {
  const app = new koa();

  return app;
}

describe('Layer.method_not_allowed', () => {
  const app1 = create_test_app_1();

  // Valid routes
  it('should ignore get/head requests', async(done) => {
    await waterfall(
      app1.callback(),
      {
        expected: {
          body: 'default route',
          status: 200,
        },
        method: 'GET',
        path: '/',
      },
      {
        expected: {
          body: 'endpoint 1',
          status: 200,
        },
        method: 'DELETE',
        path: '/endpoint1',
      },
      {
        expected: {
          body: 'default route',
          status: 200,
        },
        method: 'GET',
        path: '/endpoint2',
      },
      {
        expected: {
          body: 'endpoint 2',
          status: 200,
        },
        method: 'PUT',
        path: '/endpoint2/+1',
      },
      {
        expected: {
          body: 'default route',
          status: 200,
        },
        method: 'GET',
        path: '/endpoint2/+2',
      },
      {
        expected: {
          body: 'endpoint 3',
          status: 200,
        },
        method: 'POST',
        path: '/endpoint4/+3',
      },
    );

    done();
  }, 300000);
});
