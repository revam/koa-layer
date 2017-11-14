# koa-match

A small matching library for Koa built in typescript. Inspired by [`koa-router`](https://www.npmjs.com/package/koa-router).

## Installation

```sh
npm install --save koa-match
```

## Usage

```js
const Koa = require('koa');
const {match, Layer} = require('koa-match');

const app = new Koa;



// You can use the supplied matcher,

// All options are optional and can be used at the same time
app.use(match({
  path: '/route', // fed to 'path-to-regexp' module
  parse_options: {} // options for 'path-to-regexp' module
  method: 'get', // http method
  methods: ['get', 'post'],
  accept: 'html', // valid in accept header
  accepts: ['html', 'json', 'text/plain', 'images/*'],
  // when using the match function is it recommended to supply at least 1 handler
  handler: async (ctx, next) => {/* ... */} // handlers
  handlers: [/* some more hnadlers ... */]
}));



// or creating your own layers.

const layer = new Layer({
  /* pick and choose from above */
})

// it is possible to append handlers after creation
layer.use((ctx, next) => next());

// layer.param() makes it easier to get data
new Layer({path: 'users/:user'}).param('user', async(id, ctx) => await UserTable.getById(id));

// we store some data in ctx.state, as it may be useful when debugging
layer.use(async(ctx) => {
  // Most recent layer
  ctx.state.layer // -> ctx.state.layers[0]
  // All layers in an array
  ctx.state.layers = [{
    accepted: [{
      type, // string
      sub_type, // string
      full_type, // string
      quality, // number
      params, // Map<string, string>
      /* ... */ // some more meta-data
    }],
    params, // Map<string|number, any>
    layer, // Layer
  }];
  // Preffered content-type for response, only available when provided with 'accept' and/or 'accepts'.
  ctx.state.preffered // string
  // ALL parameters collected till we reached this layer.
  ctx.state.params // Map<string|number, any>
});

// supply the callback handler to koa
app.use(layer.callback());

```
