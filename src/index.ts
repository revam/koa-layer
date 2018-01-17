/**
 * src/index.ts
 *
 * Inspired by [koa-router](https://www.npmjs.com/package/koa-router)
 *
 * Copyright (c) 2015 Alexander C. Mingoia
 * Copyright (c) 2017-2018 Mikal Stordal <mikalstordal@gmail.com>
 * MIT Licensed
 */

// from packages
import * as isIterable from 'is-iterable';
import { Context, Middleware } from 'koa';
import * as compose from 'koa-compose';
import { lookup } from 'mime-types';
import * as convert from 'path-to-regexp';
// from library
import { accepts, ParsedHeader } from './accepts';

declare module "koa" {
  interface Context {
    params: {
      [param: string]: any;
    };
  }
}

export { MatchingFlag, ParsedHeader } from './accepts';

export type ParameterMiddleware<T = any> = (param_value: string, ctx: Context) => Promise<T | undefined>;

export interface ContextStateLayerEntry {
  accepted?: ParsedHeader[];
  done: boolean;
  layer: Layer;
  match: boolean;
  params?: Map<string | number, any>;
}

export interface LayerOptions {
  path?: string;
  parse_options?: convert.RegExpOptions;
  method?: string;
  methods?: string | Iterable<string> | IterableIterator<string>;
  accept?: string;
  accepts?: string | Iterable<string> | IterableIterator<string>;
  handler?: Middleware;
  handlers?: Middleware | Iterable<Middleware> | IterableIterator<Middleware>;
  conditional?(ctx: Context): Promise<boolean> | boolean;
}

export class Layer {
  public readonly path: string;
  private regexp: RegExp;
  public keys: convert.Key[];
  public methods: Set<string>;
  public accepts: Set<string>;
  public stack: Middleware[];
  private conditional?: (ctx: Context) => Promise<boolean> | boolean;

  public readonly no_params: boolean;
  public readonly single_star: boolean;

  constructor(options?: LayerOptions) {
    this.keys = [];
    this.stack = [];
    this.methods = new Set();
    this.accepts = new Set();

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
      } else if (isIterable(options.methods)) {
        for (const method of options.methods) {
          if ('string' === typeof method) {
            this.methods.add(method.toUpperCase());
          }
        }
      }

      // Content types accepted
      const accept_canidates: string[] = [];
      if ('string' === typeof options.accept) {
        accept_canidates.push(options.accept);
      }

      if ('string' === typeof options.accepts) {
        accept_canidates.push(options.accepts);
      } else if (isIterable(options.accepts)) {
        for (const accept of options.accepts) {
          if ('string' === typeof accept) {
            accept_canidates.push(accept);
          }
        }
      }

      for (const accepted of accept_canidates
        .map((t) => !t.includes('/') ? lookup(t) : t)
        .filter((t) => 'string' === typeof t) as string[]) {
        this.accepts.add(accepted);
      }

      // Handlers
      if ('function' === typeof options.handler) {
        this.stack.push(options.handler);
      }

      if ('function' === typeof options.handlers) {
        this.stack.push(options.handlers);
      } else if (isIterable(options.handlers)) {
        for (const handler of options.handlers) {
          if ('function' === typeof handler) {
            this.stack.push(handler);
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
        throw new Error(
          `${Array.from(this.methods).toString()}, '${this.path}': middleware must be a funciton, not type '${type}'`);
      }
    }

    // Booleans
    this.single_star = '*' === this.path;
    this.no_params = !this.single_star && !this.keys.length;
  }

  private match(path: string): Map<string | number, any> {
    const params = new Map<string | number, any>();

    // no path configured
    if (!this.path) {
      return params;
    }

    if (!path) {
      return;
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
      return;
    }

    // fast match for any path *not* containing any params
    if (this.no_params) {
      return params;
    }

    const captures = this.regexp.exec(path).slice(1);

    let i = 0;
    for (const capture of captures) {
      params.set(this.keys[i++].name.toString(), capture ? safeDecodeURIComponent(capture) : capture);
    }

    return params;
  }

  private method(method: string) {
    return !this.methods.size || this.methods.has(method);
  }

  private accept(header: string): ParsedHeader[] {
    if (!header) {
      return;
    }

    if (!this.accepts.size) {
      return [];
    }

    return accepts(header, this.accepts);
  }

  public param<T>(param: string, handler: ParameterMiddleware<T>): this {
    if ('string' !== typeof param) {
      throw new Error('invalid param');
    }

    const stack = this.stack;
    const keys = this.keys;
    const index = keys.findIndex((k) => param === k.name);

    type PMiddleware = Middleware & {param?: string};

    if (~index) {
      const middleware = (async(ctx, next) => {
        const u = await handler(ctx.state.params[param], ctx);

        if (undefined !== u) {
          ctx.state.params[param] = u;
        }

        return next();
      }) as PMiddleware;
      middleware.param = param;

      // iterate through the stack to figure out where to place the handler
      for (const [insert, handle] of this.stack.entries()) {
        // parameter setters are always first, so when we find a handler w/o a param property, stop there
        // with other setters, we look for any parameter further back in the stack, to insert it before them
        if (
          !(handle as PMiddleware).param ||
          keys.findIndex((k) => (handle as PMiddleware).param  === k.name) > index
        ) {
          stack.splice(insert, 0, middleware);
          break;
        }

      }
    }

    return this;
  }

  public use(handle: Middleware);
  public use(...handles: Middleware[]);
  public use(...handles: Middleware[]) {
    if (handles.every((handle) => 'function' === typeof handle && handle.length > 0 && handle.length < 3)) {
      this.stack.push(...handles);
    }

    return this;
  }

  public callback(): Middleware {
    return async(ctx, next) => {
      if (!(ctx.state.layers instanceof Array)) {
        ctx.state.layers = [];

        // Most recent layer
        Reflect.defineProperty(ctx.state, 'layer', {
          configurable: false,
          enumerable: false,
          get() {
            if (ctx.state.layers.length) {
              return ctx.state.layers[ctx.state.layers.length - 1];
            }
          },
        });

        // Most recent preferred mime type
        Reflect.defineProperty(ctx.state, 'preferred', {
          configurable: false,
          enumerable: false,
          get() {
            for (let index = ctx.state.layers.length - 1; index >= 0; index--) {
              const state = ctx.state.layers[index] as ContextStateLayerEntry;

              if (state.accepted && (state.accepted as ParsedHeader[]).length) {
                return (state.accepted as ParsedHeader[])[0];
              }
            }
          },
        });
      }

      const layers = ctx.state.layers as ContextStateLayerEntry[];

      function skip(opts: {accepted?: ParsedHeader[]; params?: Map<string | number, any>} = {}) {
        layers.push({
          done: true,
          layer: this,
          match: false,
          ...opts,
        });

        return next();
      }

      if ('object' !== typeof ctx.params) {
        ctx.params = {};
      }

      if (this.conditional && !(await this.conditional(ctx))) {
        return skip();
      }

      if (!this.method(ctx.method)) {
        return skip();
      }

      const params = this.match(ctx.path);
      if (!params) {
        return skip();
      }

      const accepted = this.accept(ctx.headers.accept);
      if (!accepted) {
        return skip({params});
      }

      // Store index
      const index = layers.push({
        accepted,
        done: false,
        layer: this,
        match: true,
        params,
      }) - 1;

      if (params instanceof Map && params.size) {
        for (const [k, v] of params) {
          ctx.params[k] = v;
        }
      }

      return compose(this.stack)(ctx, () => {
        layers[index].done = true;

        return next();
      });
    };
  }

  public static match(options?: LayerOptions) {
    return new Layer(options).callback();
  }

  public static async method_not_allowed(ctx: Context, next: () => Promise<any>): Promise<any> {
    await next();

    const layers = ctx.state.layers as ContextStateLayerEntry[];

    let allowed = true;
    for (const {layer, done, match} of layers) {
      // Skip inactive matched layers.
      if (match && done) {
        continue;
      }

      if (!layer.method(ctx.method)) {
        allowed = false;
        break;
      }
    }

    // Skip the rest.
    if (ctx.headerSent || allowed) {
      return;
    }

    ctx.status = 405;
    ctx.body = `Method '${ctx.method}' not allowed.`;
  }
}

export function match(options?: LayerOptions) {
  return Layer.match(options);
}

/**
 * Safe decodeURIComponent, won't throw any error.
 * If `decodeURIComponent` error happen, just return the original value.
 *
 * @param component URL decode original string
 */
function safeDecodeURIComponent(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}
