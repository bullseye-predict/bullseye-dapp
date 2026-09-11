// SDK 0.2.46 publishes its declarations here, but package.json points at a
// nonexistent dist/types/src path. Re-export the actual declarations, not any.
declare module '@bonasa-tech/manifest-sdk' {
  export * from '@bonasa-tech/manifest-sdk/dist/types/client/ts/src/index'
}
