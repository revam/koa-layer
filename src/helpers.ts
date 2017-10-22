/**
 * src/helpers.ts
 *
 * Copyright (c) 2017 Mikal Stordal <mikalstordal@gmail.com>
 * MIT Licensed
 */

/**
 * Test `fn` on every value of `iterable`.
 *
 * @param iterable iterable
 * @param fn result tested as a truthy value.
 * @param thisArg `this` for `fn`.
 */
export function iterableEvery<T, U = any>(iterable: Iterable<T>|IterableIterator<T>, fn: (v: T) => boolean, thisArg?: U): boolean {
  for (const value of iterable) {
    if (!fn.call(thisArg, value)) return false;
  }

  return true;
}

/**
 * Applies `fn` to convert input (`T`) to output (`U`) on call to `next()`.
 * Returns an new iterator.
 *
 * @param iterable iterable
 * @param fn convert input to output
 * @param thisArg `this` for `fn`.
 */
export function* iterableMap<T, U, V = any>(iterable: Iterable<T>|IterableIterator<T>, fn: (v: T) => U, thisArg?: V): IterableIterator<U> {
  for (const value of iterable) {
    yield fn.call(thisArg, value);
  }
}