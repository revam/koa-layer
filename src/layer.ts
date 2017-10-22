/**
 * [source](https://github.com/alexmingoia/koa-router/blob/5.x/lib/layer.js)
 *
 * Copyright (c) 2015 Alexander C. Mingoia
 * MIT Licensed
 */

/**
 * src/layer.ts
 *
 * Inspired by [koa-router](https://www.npmjs.com/package/koa-router)
 *
 * Copyright (c) 2017 Mikal Stordal <mikalstordal@gmail.com>
 * MIT Licensed
 */

'use strict';

import * as compose from 'koa-compose';
import * as convert from 'path-to-regexp';
import {lookup} from 'mime-types';
import {accepts, preffered, ParsedHeader} from './accepts';

import {Middleware, Context} from 'koa';

export interface ParameterMiddleware<T = any> {
  (param_value: string, ctx: Context): Promise<T|undefined>;
}

export interface ContextStateLayerEntry {
  params: true|Map<string|number, any>;
  accepted: true|ParsedHeader[]
  layer: Layer
}

export interface LayerOptions {
  path?: string;
  parse_options?: convert.ParseOptions;
  method?: string;
  methods?: string|Iterable<string>|IterableIterator<string>;
  accept?: string;
  accepts?: string|Iterable<string>|IterableIterator<string>;
  handler?: Middleware;
  handlers?: Middleware|Iterable<Middleware>|IterableIterator<Middleware>;
}

export class Layer {
  public readonly path: string;
  private regexp: RegExp;
  public keys: convert.Key[];
  public methods: Set<string>;
  public accepts: Set<string>;
  public stack: Middleware[];

  public readonly no_params: boolean;
  public readonly single_star: boolean;

  constructor(options?: LayerOptions) {
    this.keys = [];
    this.stack = [];
    this.methods = new Set;
    this.accepts = new Set;

    if ('object' === typeof options) {
      // Path and RegExp
      if ('string' === typeof options.path) {
        this.path = options.path;

        // add slash when not present
        if ('/' !== this.path[0] && '*' !== this.path[0]) {
          this.path = `/${this.path}`;
        }

        let popts;
        if ('object' === typeof options.parse_options) {
          popts = options.parse_options;
        }

        this.regexp = convert(this.path, this.keys, popts);
      }

      // HTTP methods accepted
      if ('string' === typeof options.method) {
        this.methods.add(options.method.toUpperCase());
      }

      if ('string' === typeof options.methods) {
        this.methods.add(options.methods.toUpperCase());
      }

      else if ('object' === typeof options.methods && Reflect.has(options.methods, Symbol.iterator)) {
        for (const method of options.methods) {
          if ('string' === typeof method) {
            this.methods.add(method.toUpperCase())
          }
        }
      }

      // Content types accepted
      const accepts: string[] = [];
      if ('string' === typeof options.accept) {
        accepts.push(options.accept);
      }

      if ('string' === typeof options.accepts) {
        accepts.push(options.accepts);
      }

      else if ('object' === typeof options.accepts && Reflect.has(options.accepts, Symbol.iterator)) {
        for (const accept of options.accepts) {
          if ('string' === typeof accept) {
            accepts.push(accept)
          }
        }
      }

      for (const accepted of accepts.map(t => !t.includes('/')? lookup(t):t).filter(t => 'string' === typeof t) as string[]) {
        this.accepts.add(accepted);
      }

      // Handlers
      if ('function' === typeof options.handler) {
        this.stack.push(options.handler);
      }

      if ('function' === typeof options.handlers) {
        this.stack.push(options.handlers);
      }

      else if ('object' === typeof options.handlers && Reflect.has(options.handlers, Symbol.iterator)) {
        for (const handler of options.handlers) {
          if ('function' === typeof handler) {
            this.stack.push(handler)
          }
        }
      }
    }

    for (const fn of this.stack) {
      const type = typeof fn;

      if ('function' !== type) {
        throw new Error(`${Array.from(this.methods).toString()}, '${this.path}': middleware must be a funciton, not type '${type}'`);
      }
    }

    // Booleans
    this.single_star = '*' === this.path;
    this.no_params = !this.single_star && !this.keys.length;
  }

  private match(path: string): boolean|Map<string|number, any> {
    if (!path) {
      return false;
    }

    // no path configured
    if (!this.path) {
      return true;
    }

    const params = new Map<string|number, any>();

    if ('/' !== path[0]) {
      path = `/${path}`;
    }

    // fast match for '*' (everything matches)
    if (this.single_star) {
      params.set(0, safeDecodeURIComponent(path));

      return params;
    }

    if (!this.regexp.test(path)) {
      return false;
    }

    // fast match for any path *not* containing any params
    if (this.no_params) {
      return true;
    }

    const captures = this.regexp.exec(path).slice(1);

    let i = 0;
    for (const capture of captures) {
      params.set(this.keys[i++].name, capture? safeDecodeURIComponent(capture) : capture)
    }

    return params;
  }

  private method(method: string) {
    return !this.methods.size || this.methods.has(method);
  }

  private accept(header: string): boolean|ParsedHeader[] {
    if (!header) {
      return false;
    }

    if (!this.accepts.size) {
      return true;
    }

    const filtered = accepts(header, this.accepts);
    return filtered.length? filtered : false;
  }

  url(...params: any[]) {
    const url = this.path.replace('\(\.\*\)', '');
    const to_path = convert.compile(url);

    let data: object = {};
    if (params.length === 1) {
      if (params[0] instanceof Array) {
        params = params[0];
      }

      else if ('object' === typeof params[0]) {
        data = params[0];

        if (Reflect.ownKeys(data).length !== this.keys.length) {
          throw `missing params from provided object`;
        }

        params.length = 0;
      }
    }

    if (params instanceof Array && params.length) {
      const tokens = convert.parse(url);

      if (params.length !== tokens.length) {
        throw `not enough params provided; a differance of ${params.length-tokens.length}.`;
      }

      for (const token of tokens as convert.Key[])
      if (token.name) {
        data[token.name] = params.shift();
      }
    }

    return to_path(data);
  }

  param<T>(param: string, handler: ParameterMiddleware<T>): this {
    if ('string' !== typeof param) {
      throw 'invalid param';
    }

    const stack = this.stack;
    const keys = this.keys;
    const index = keys.findIndex(k => param === k.name);

    if (~index) {
      const middleware = async function(ctx, next) {
        const u = await handler(ctx.state.params[param], ctx);

        if (undefined !== u) {
          ctx.state.params[param] = u;
        }

        await next();
      } as Middleware;
    }

    return this;
  }

  use(handle: Middleware): this {
    if ('function' === typeof handle) {
      this.stack.push(handle);
    }

    return this;
  }

  callback(): Middleware {
    return (ctx, next) => {
      // Sorted by resources used when testing
      if (!this.method(ctx.method)) {
        return next();
      }

      const params = this.match(ctx.path);
      if (!params) {
        return next();
      }

      const accepted = this.accept(ctx.headers['accept']);
      if (!accepted) {
        return next();
      }

      if (!(ctx.state.layers instanceof Array)) {
        ctx.state.layers = [] as ContextStateLayerEntry[];
        Reflect.defineProperty(ctx.state, 'layer', {
          configurable: false,
          enumerable: false,
          get() {
            return ctx.state.layers[0];
          }
        })
      }

      ctx.state.layers.push({
        params,
        accepted,
        layer: this,
      } as ContextStateLayerEntry);

      if (!(ctx.state.params instanceof Map)) {
        ctx.state.params = new Map<string|number, any>();
      }

      if (params instanceof Map) {
        for (const [k, v] of params) {
          ctx.state.params.set(k, v);
        }
      }

      return compose(this.stack)(ctx, next);
    }
  }
}
export default Layer;

export function match(options?: LayerOptions) {
  return new Layer(options).callback();
}

/**
 * Safe decodeURIComponent, won't throw any error.
 * If `decodeURIComponent` error happen, just return the original value.
 *
 * @param component URL decode original string
 * @private
 */
function safeDecodeURIComponent(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}