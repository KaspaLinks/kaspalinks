# Kaspa Helpers

The helper package uses Kaspa WASM SDK validation and integer-safe amount utilities.

## Included

- Kaspa WASM SDK address validation
- KAS to sompi conversion
- Sompi to KAS formatting
- Conservative payment URI building
- QR payload helper
- BigInt JSON serialization helpers

## Address Validation

The current validator uses the vendored `rusty-kaspa v2.0.1` `kaspa-wasm` `Address` parser, which validates the address payload and checksum.

Toccata-specific SDK capability checks live in `packages/kaspa/src/toccata.ts`; see [`toccata-sdk.md`](./toccata-sdk.md).

It accepts only addresses that:

- parse successfully as Kaspa addresses
- understand the SDK-supported `kaspa` and `kaspatest` prefixes
- contain no whitespace

The helper package still understands `mainnet` and `testnet` addresses so legacy fixtures and lower-level tooling can be parsed safely. The hosted Kaspa Links product currently creates only `mainnet` Actions. `kaspasim` and `kaspadev` are not accepted by the app even if SDK support changes later.

## Amount Conversion

`1 KAS = 100,000,000 sompi`.

The helpers use string parsing and `BigInt` arithmetic. They reject zero, negative values, scientific notation, non-numeric values, and more than 8 decimal places.

## Payment URIs and QR Payloads

Payment URI helpers include the recipient address and append only safely converted/encoded query parameters.

No private data, signing, transaction broadcasting, or node integration is implemented in these helpers. Optional indexer detection lives in the app/indexer layer, not in URI or QR generation.
