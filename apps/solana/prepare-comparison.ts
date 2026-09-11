import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_PROGRAM_ID } from '../../packages/adapters/solana/external-comparison'
import { CP_AMM_PROGRAM_ID } from '@meteora-ag/cp-amm-sdk'

// Read-only downloads of public bytecode. The demo creates fresh local keys and
// test collateral; it never sends a transaction to the remote RPC.
const args = process.argv.slice(2)
if (!args.includes('--local-demo')) throw new Error('Use bun run demo:solana:comparison --local-demo')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const directory = resolve(root, 'programs/prediction_market_pinocchio/target/comparison')
await mkdir(directory, { recursive: true })
async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Failed: ${command[0]} ${command[1]}`)
}
await run(['bun', 'run', 'build:solana:comparison'])
const remoteRpc = 'https://api.mainnet-beta.solana.com'
await run(['solana', 'program', 'dump', '--url', remoteRpc, MANIFEST_PROGRAM_ID.toBase58(), resolve(directory, 'manifest.so')])
await run(['solana', 'program', 'dump', '--url', remoteRpc, CP_AMM_PROGRAM_ID.toBase58(), resolve(directory, 'meteora.so')])
await run(['bun', 'run', 'apps/solana/comparison.ts', ...args, '--artifacts', directory])
