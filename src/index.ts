/**
 * src/index.ts
 *
 * Copyright (c) 2017 Mikal Stordal <mikalstordal@gmail.com>
 * MiT Licensed
 */

declare module "koa" {
  interface Context {
    params: {
      [param: string]: any
    }
  }
}

export { accepts, preffered } from './accepts';
export { Layer, match } from './layer';