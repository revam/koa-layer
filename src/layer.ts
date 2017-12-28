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
import * as isIterable from 'is-iterable';
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
  conditional?: (ctx: Context) => Promise<boolean>|boolean;
}

export class Layer {
  public readonly path: string;
  private regexp: RegExp;
  public keys: convert.Key[];
  public methods: Set<string>;
  public accepts: Set<string>;
  public stack: Middleware[];
  private conditional?: (ctx: Context) => Promise<boolean>|boolean;

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

      else if (isIterable(options.methods)) {
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

      else if (isIterable(options.accepts)) {
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

      else if (isIterable(options.handlers)) {
        for (const handler of options.handlers) {
          if ('function' === typeof handler) {
            this.stack.push(handler)
          }
        }
      }

      // Conditional execution
      if ('function' === typeof options.conditional) {
        this.conditional = options.conditional;
      }
    }

    // Add head if GET is present, disregarding if previous added.
    if (this.methods.has('GET')) {
      this.methods.add('HEAD');
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
    // no path configured
    if (!this.path) {
      return true;
    }

    const params = new Map<string|number, any>();

    if (!path) {
      return false;
    }

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
      params.set(this.keys[i++].name.toString(), capture? safeDecodeURIComponent(capture) : capture)
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

  param<T>(param: string, handler: ParameterMiddleware<T>): this {
    if ('string' !== typeof param) {
      throw 'invalid param';
    }

    const stack = this.stack;
    const keys = this.keys;
    const index = keys.findIndex(k => param === k.name);

    type PMiddleware = Middleware & {param?: string};

    if (~index) {
      const middleware = async function(ctx, next) {
        const u = await handler(ctx.state.params[param], ctx);

        if (undefined !== u) {
          ctx.state.params[param] = u;
        }

        return next();
      } as PMiddleware;
      middleware.param = param;

      // iterate through the stack to figure out where to place the handler
      for (const [insert, handler] of this.stack.entries()) {
        // parameter setters are always first, so when we find a handler w/o a param property, stop there
        // with other setters, we look for any parameter further back in the stack, to insert it before them
        if (!(handler as PMiddleware).param || keys.findIndex(k => (handler as PMiddleware).param  === k.name) > index) {
          stack.splice(insert, 0, middleware);
          break;
        }

      }
    }

    return this;
  }

  use(handle: Middleware): this {
    if ('function' === typeof handle && handle.length > 0 && handle.length < 3) {
      this.stack.push(handle);
    }

    return this;
  }

  callback(): Middleware {
    return async(ctx, next) => {
      if (this.conditional && !(await this.conditional(ctx))) {
        return next();
      }

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
        // add getter for last layer
        Reflect.defineProperty(ctx.state, 'layer', {
          configurable: false,
          enumerable: false,
          get() {
            return ctx.state.layers[ctx.state.layers.length - 1];
          }
        });
      }

      // set preffered response MIME
      if (accepted instanceof Array) {
        ctx.state.preffered = accepted[0];
      // Or empty if not set
      } else if ('string' !== typeof ctx.state.preffered) {
        ctx.state.preffered = '';
      }

      ctx.state.layers.push({
        params,
        accepted,
        layer: this,
      } as ContextStateLayerEntry);

      if ('object' !== typeof ctx.params) {
        ctx.params = {};
      }

      if (params instanceof Map) {
        for (const [k, v] of params) {
          ctx.params[k] = v;
        }
      }

      return compose(this.stack)(ctx, next);
    }
  }
}

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