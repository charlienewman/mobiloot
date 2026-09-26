// Type-only: the `buffer` npm package's typings predate TS 5.9's generic Uint8Array and
// clash with @solana/web3.js. At runtime the npm package is used; its API matches Node's.
export { Buffer } from 'node:buffer'
