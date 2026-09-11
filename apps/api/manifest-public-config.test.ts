import { expect, test } from 'bun:test'
import { publicVenueConfig } from './public-config'
test('Manifest discovery exposes explicit deployments and questions without server secrets', () => {
  const result = publicVenueConfig({ family:'SOLANA',venue:'SOLANA',chainId:'devnet-genesis',programId:'prediction',networkDomain:'09'.repeat(32),collateralToken:'USDC-mint',collateralDecimals:6,collateralSymbol:'USDC',matchingEngine:'MANIFEST',manifestProgramId:'guarded-manifest',publicRpcUrl:'https://example.com/rpc',rpcUrl:'https://private.example/key',relayerSecret:'private',markets:{question:{matchId:'0x'+'01'.repeat(32),label:'Match winner',outcomes:[{id:0,label:'YES'},{id:1,label:'NO'}]}} })
  expect(result.matchingEngine).toBe('MANIFEST')
  expect(result.manifestMarkets?.[0]?.outcomes).toEqual(['YES','NO'])
  expect(result.manifestMarkets?.[0]?.address).toBe('question')
  expect(JSON.stringify(result)).not.toContain('private')
})
