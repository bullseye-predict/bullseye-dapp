import type { EIP1193Provider } from 'viem'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'

/** Preserve Dynamic's selected wallet, including embedded wallets without window.ethereum. */
export async function dynamicEvmProvider(source: DynamicEvmWalletPort, chainId: string): Promise<Pick<EIP1193Provider, 'request'>> {
  const client = await source.getWalletClient(chainId)
  const accounts = await client.getAddresses()
  if (accounts[0]?.toLowerCase() !== source.address.toLowerCase()) throw new Error('Dynamic wallet changed. Connect again.')
  return {
    request: async args => {
      // Dynamic already owns authentication; do not open a second wallet chooser.
      if (args.method === 'eth_requestAccounts') return await client.getAddresses() as never
      return await client.request(args as never) as never
    },
  }
}
