/**
 * negotiator
 * Copyright(c) 2012 Isaac Z. Schlueter
 * Copyright(c) 2014 Federico Romero
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * accepts.ts
 *
 * Inspired by [negotiator](https://www.npmjs.com/package/negotiator).
 *
 * Copyright (c) 2017 Mikal Stordal <mikalstordal@gmail.com>
 * MIT Licensed
 */

'use strict';

export enum MatchingFlag {
  NONE,
  PARAMS,
  SUBTYPE,
  TYPE,
}

export interface ParsedHeader {
  type: string;
  sub_type: string;
  full_type: string;
  quality: number;
  params: Map<string, string>;
  flags: MatchingFlag;
  index: number;
  other_index?: number;
}

const matchSingleRegex = /^([\w-+*]+)\/([\w-+*]+)$/;
export function accepts(header: string, provided?: Iterable<string>|IterableIterator<string>): ParsedHeader[] {
  const accepted = Array.from(parseHeader(header));

  if ('object' === typeof provided && Reflect.has(provided, Symbol.iterator)) {
    let i = 0;
    // Parse item and get priority
    return Array.from(iterableMap(provided, p => priority(parseItem(matchSingleRegex.exec(p.trim()), i++, 0), accepted)))
      .filter(isQuality)
      .sort(compareSpecs);
  }

  return accepted
    .filter(isQuality)
    .sort(compareSpecs);
}

export function preffered(header: string, provided?: Iterable<string>|IterableIterator<string>): string|false {
  const filtered = accepts(header, provided);
  return filtered.length? filtered[0].full_type : false;
}

const matchMultiRegex = /(?=\s*)([\w-+*]+)\/([\w-+*]+)\s*(?:;([^]*?))?(?=,\s*[\w-+*]+\/|$)/g;
function* parseHeader(header: string): IterableIterator<ParsedHeader> {
  let match: RegExpExecArray;
  let i = 0;
  do {
    match = matchMultiRegex.exec(header);
    if (match) {
      yield parseItem(match, i++);
    }
  }
  while (match);
}

function parseItem([,type, sub_type, param_string]: string[], index: number, quality: number = 1): ParsedHeader {
  const full_type = `${type}/${sub_type}`;
  const params = splitParameters(param_string);

  if (params.has('q')) {
    quality = parseFloat(params.get('q'));
    params.delete('q');
  }

  return {
    type,
    sub_type,
    full_type,
    quality,
    params,
    flags: 0,
    index
  }
}

function priority(item: ParsedHeader, ref: ParsedHeader[]): ParsedHeader {
  item.other_index = -1;

  for (const accepted of ref) {
    let flag = flagItem(item, accepted);

    // We have a flag
    if (undefined !== flag
    // Check if this covers more flags
    && (item.flags - flag
    // Check if accepted quality is higher than provided quality
    ||  item.quality - accepted.quality
    // Check if index
    ||  item.other_index - accepted.index) < 0) {
      // Update flag
      item.flags = flag;
      // Update quality
      item.quality = accepted.quality;
      // Update index
      item.other_index = accepted.index;
    }
  }

  return item;
}

function flagItem(item: ParsedHeader, ref: ParsedHeader): MatchingFlag {
  let flag = MatchingFlag.NONE;
  if (ref.type.toLowerCase() == item.type.toLowerCase()) {
    flag |= MatchingFlag.TYPE;
  }

  else if (ref.type != '*') {
    return;
  }

  if (ref.sub_type.toLowerCase() == item.sub_type.toLowerCase()) {
    flag |= MatchingFlag.SUBTYPE;
  }

  else if (ref.sub_type != '*') {
    return;
  }

  if (ref.params.size) {
    if (iterableEvery(ref.params, ([k, v]) => v == '*' || v.toLowerCase() == (item.params[k]||'').toLowerCase())) {
      flag |= MatchingFlag.PARAMS;
    }

    else {
      return;
    }
  }

  return flag;
}

const splitRegex = /^([^=]+)=("?)([^]*?)("?)$/;
function splitParameters(params_string?: string): Map<string, string> {
  const params = new Map;

  // No parameters provided
  if ('string' !== typeof params_string) {
    return params;
  }

  let i = 0;
  const param_array: string[] = [];

  for (const param_part of params_string.split(';')) {
    // Even number of quotes
    const match = param_part.match('"');
    if (!match || match.length % 2 === 0) {
      param_array[i++] = param_part;
    }
    // Odd number of quots
    else {
      param_array[i] += `;${param_part}`;
    }
  }

  // Read params
  for (const param of param_array) {
    const [,key, q1, value, q2] = splitRegex.exec(param.trim());

    if (!key) {
      continue;
    }

    params.set(key.toLowerCase(), q1==q2? value : q1+value+q2+'');
  }

  return params;
}

function isQuality(parsed: ParsedHeader): boolean {
  return parsed.quality > 0;
}

function compareSpecs(a: ParsedHeader, b: ParsedHeader): number {
  return (b.quality - a.quality) || (b.flags - a.flags) || (a.other_index - b.other_index) || (a.index - b.index) || 0;
}

/**
 * Test `fn` on every value of `iterable`.
 *
 * @param iterable iterable
 * @param fn result tested as a truthy value.
 * @param thisArg `this` for `fn`.
 */
function iterableEvery<T, U = any>(
  iterable: Iterable<T> | IterableIterator<T>,
  fn: (v: T) => boolean,
  thisArg?: U,
): boolean {
  for (const value of iterable) {
    if (!fn.call(thisArg, value)) {
      return false;
    }
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
function* iterableMap<T, U, V = any>(
  iterable: Iterable<T> | IterableIterator<T>,
  fn: (v: T) => U,
  thisArg?: V,
): IterableIterator<U> {
  for (const value of iterable) {
    yield fn.call(thisArg, value);
  }
}
