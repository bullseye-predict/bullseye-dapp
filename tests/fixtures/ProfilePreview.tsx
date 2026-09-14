import {useState} from 'react'
import {SolanaProfile} from '../../src/components/portfolio/SolanaProfile'
import {bootstrap,owner,questions,sol,venue} from './profile'
import '../../src/styles/home.css'
import '../../src/components/portfolio/portfolio.css'
export default function ProfilePreview(){const [self,setSelf]=useState(true);return <><div style={{padding:12,background:'#252a35',color:'white',fontFamily:'sans-serif'}}>Local deterministic test fixture · <button onClick={()=>setSelf(!self)}>{self?'View public profile':'View own profile'}</button></div><SolanaProfile apiUrl="" bootstrap={bootstrap} owner={owner} venue={venue} isSelf={self} questions={questions} sol={sol} retry={0} onRefresh={()=>{}}/></>}
