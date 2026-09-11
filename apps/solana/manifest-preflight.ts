import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Connection, PublicKey } from '@solana/web3.js'
import { unpackMint } from '@solana/spl-token'
import { TOKEN_PROGRAM_ID } from '../../packages/adapters/solana/wire'

// Public configuration only. This command never reads a signer or sends a transaction.
const file = process.argv[2]
if (!file) throw new Error('Usage: bun apps/solana/manifest-preflight.ts <public-deployment.json>')
const config = JSON.parse(await readFile(resolve(file), 'utf8'))
const root = resolve(import.meta.dir, '../..')
const artifacts = resolve(root, 'programs/manifest_guard/target/artifacts')
const build = JSON.parse(await readFile(resolve(artifacts, 'build.json'), 'utf8'))
const requireValue = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const prediction = new PublicKey(config.predictionProgram), manifest = new PublicKey(config.manifestProgram)
requireValue(prediction.toBase58() === build.predictionProgram && manifest.toBase58() === build.manifestProgram, 'Program IDs differ from the compiled guard')
requireValue(Number.isInteger(config.takerFeeBps) && config.takerFeeBps >= 1 && config.takerFeeBps <= 10000, 'Explicit takerFeeBps is required')
const recipient = new PublicKey(config.feeRecipient), collateral = new PublicKey(config.collateralMint)
requireValue(config.genesisHash && config.rpcUrl, 'Explicit RPC and genesisHash are required')
const binary = await readFile(resolve(artifacts, 'manifest.so'))
requireValue(createHash('sha256').update(binary).digest('hex') === build.binarySha256, 'Manifest binary differs from build metadata')
const predictionBinary = await readFile(resolve(root, 'programs/prediction_market_pinocchio/target/deploy/prediction_market_pinocchio.so'))
const connection = new Connection(config.rpcUrl, 'finalized')
requireValue(await connection.getGenesisHash() === config.genesisHash, 'RPC genesis mismatch')
const mintAccount = await connection.getAccountInfo(collateral, 'finalized')
requireValue(mintAccount, 'Configured collateral mint is missing')
const mint = unpackMint(collateral, mintAccount, TOKEN_PROGRAM_ID)
requireValue(mint.decimals === 6 && mint.isInitialized, 'Expected initialized six-decimal classic SPL collateral')
const programs = await connection.getMultipleAccountsInfo([prediction, manifest], 'finalized')
const rent = await Promise.all([predictionBinary.length + 45, binary.length + 45].map(size => connection.getMinimumBalanceForRentExemption(size)))
console.log(JSON.stringify({
  genesisHash: config.genesisHash,
  predictionProgram: prediction.toBase58(), manifestProgram: manifest.toBase58(),
  collateralMint: collateral.toBase58(), feeRecipient: recipient.toBase58(), takerFeeBps: config.takerFeeBps,
  binaries: { predictionSha256: createHash('sha256').update(predictionBinary).digest('hex'), manifestSha256: build.binarySha256 },
  executableProgramsPresent: programs.map(p => p?.executable ?? false),
  programDataRentLamports: { prediction: rent[0], manifest: rent[1] },
  rentEstimateExcludes: ['Program accounts', 'Temporary deployment buffers', 'Transaction and priority fees', 'Market accounts and maker liquidity'],
  productionReady: false,
  remaining: ['Review both customized binaries', 'Verify deployed program bytes and upgrade authorities', 'Wallet/API/indexer acceptance', 'Fund maker liquidity'],
}, null, 2))
