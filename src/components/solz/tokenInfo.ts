/** Public token identity already used by the SOLZ live wallet adapter. */
export const SOLZ_TOKEN_MINT = 'soLZV1owGUPERxCUNivWUUadNwwNzdtXMU5Wq13BYfV'

export type TokenIdentity = {
  network: string
  contractAddress?: string
  explorerUrl?: string
}

export type ArenaTokenConfig = { coola: TokenIdentity; solz: TokenIdentity }
