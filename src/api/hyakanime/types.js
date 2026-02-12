// src/api/hyakanime/types.js

/**
 * @template T
 * @typedef {{ ok: true, data: T }} Ok
 */

/**
 * @typedef {{
 *   code: string,
 *   status?: number,
 *   message?: string,
 *   details?: any,
 * }} ApiError
 */

/**
 * @typedef {{ ok: false, error: ApiError }} Err
 */

/** @template T @typedef {Ok<T> | Err} Result */

/**
 * @typedef {"none"|"token"} AuthMode
 */
