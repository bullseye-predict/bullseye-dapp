# Solana Kit and Manifest boundary

## Decision

SOLZ uses `@solana/kit` for application-facing Solana RPC and address types. The pinned Manifest SDK and Dynamic wallet connector currently expose `@solana/web3.js` v1 classes, so legacy objects are confined to `packages/adapters/solana/manifest`.

This is an incremental migration, not a rewrite of the functioning Manifest flow.

## Boundary

```text
React prediction terminal
        |
        v
Manifest hybrid client
  - Kit RPC and Address validation
  - independent genesis-hash verification
        |
        v
Manifest compatibility adapter
  - web3.js Connection, PublicKey and Transaction
  - Manifest SDK and Dynamic wallet interop
        |
        v
Guarded Manifest and SOLZ prediction programs
```

React feature components must not import `@solana/web3.js` directly for Manifest operations. They use `createManifestHybridClient`; only the compatibility adapter may construct legacy `Connection` and `PublicKey` instances.

## Current scope

- Kit verifies the RPC genesis identity before a Manifest binding is accepted and provides the app-facing address representation.
- The Manifest SDK retains responsibility for its account decoding and instruction builders.
- Dynamic retains responsibility for browser-wallet signing until it offers a native Kit signer.
- Existing legacy transaction objects do not cross from the adapter into React features.

## Migration path

1. Use Kit for every new SOLZ-owned RPC read, codec and instruction builder.
2. Keep conversions in the Manifest adapter while the upstream SDK requires web3.js v1.
3. Replace individual Manifest SDK calls with Kit/Codama instruction builders only after parity tests cover the exact wire format and account ordering.
4. Remove the compatibility adapter once Manifest and the wallet connector expose native Kit interfaces.

## Non-goals

This boundary does not alter on-chain fees, program behavior or custody. Compute and rent savings are separate work: simulate transactions, request a tight compute limit, batch safe setup instructions, and reduce account creation where it is materially costly.
