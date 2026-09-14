import {Keypair,Connection} from '@solana/web3.js'
import {ManifestAdapter} from './packages/adapters/solana/manifest/adapter'
import {buildComplementaryMatch,complementaryMatch} from './packages/adapters/solana/manifest/matching'
const k=()=>Keypair.generate().publicKey, owner=k(), collateral=k(),question=k(),program=k(),recipient=k()
const adapter=new ManifestAdapter(new Connection('http://localhost:1'),{genesisHash:'local',predictionProgram:k(),manifestProgram:program,collateralMint:collateral})
adapter.validate=async()=>({}) as never;adapter.readBook=async()=>({}) as never
const b=(outcome:0|1)=>({question,program,venue:k(),mint:k(),collateral,recipient,bps:30,outcome})
const tx=await buildComplementaryMatch(adapter,owner,b(0),b(1),complementaryMatch([{price:880000n,quantity:1000000n}],[{price:600000n,quantity:1000000n}],1000000n,30,30)!)
tx.feePayer=owner;tx.recentBlockhash=k().toBase58();console.log(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length)
