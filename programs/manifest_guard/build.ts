import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const value = (name: string) => { const i = args.indexOf(name); if (i < 0 || !args[i+1]) throw new Error(`${name} is required (public key only)`); return new PublicKey(args[i+1]!).toBase58() }
const prediction = value('--prediction-program'); const manifest = value('--manifest-program')
if (manifest === 'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms' || manifest === prediction) throw new Error('Use a separate customized Manifest deployment ID')
const upstream = JSON.parse(await readFile(resolve(here, 'upstream.json'), 'utf8'))
const output = resolve(here, 'target/artifacts')
await mkdir(output, { recursive: true })
async function run(command: string[], cwd = here) {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: resolve(here, 'target/cargo') } })
  if (await child.exited !== 0) throw new Error(`Build command failed: ${command[0]}`)
}
// A fresh source directory avoids resetting or modifying a user's checkout.
const source = resolve(here, `target/source-${Date.now()}`)
await run(['git', 'clone', '--no-checkout', upstream.repository, source])
await run(['git', 'checkout', '--detach', upstream.commit], source)
await copyFile(resolve(here, 'guard.rs'), resolve(source, 'programs/manifest/src/solz_guard.rs'))
const guardFile = resolve(source, 'programs/manifest/src/solz_guard.rs')
await writeFile(guardFile, (await readFile(guardFile, 'utf8')).replace('SOLZ_PREDICTION_PROGRAM_ID', prediction))
const libFile = resolve(source, 'programs/manifest/src/lib.rs')
let lib = await readFile(libFile, 'utf8')
lib = lib.replace('declare_id!("MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms");', `declare_id!("${manifest}");\nmod solz_guard;\npub use solz_guard::process as process_instruction;`)
lib = lib.replace('pub fn process_instruction(', 'pub fn process_core(')
lib = lib.replace('pinocchio::program_entrypoint!', 'pinocchio::entrypoint!')
lib = lib.replace(/security_txt! \{[\s\S]*?\n\}/, 'security_txt! { name: "SOLZ customized Manifest", project_url: "", contacts: "", policy: "Custom guard changes require independent review", preferred_languages: "en", source_code: "", auditors: "" }')
await writeFile(libFile, lib)
const marketFile = resolve(source, 'programs/manifest/src/state/market.rs')
const market = await readFile(marketFile, 'utf8')
const original = 'fixed.quote_volume = fixed.quote_volume.wrapping_add(total_quote_atoms_traded);'
if (market.split(original).length !== 2) throw new Error('Pinned fee-counter integration point changed')
await writeFile(marketFile, market.replace(original, 'fixed.quote_volume = fixed.quote_volume.checked_add(total_quote_atoms_traded).map_err(|_| ProgramError::ArithmeticOverflow)?;'))
await run(['cargo', 'build-sbf', '--manifest-path', resolve(source, 'programs/manifest/Cargo.toml'), '--tools-version', upstream.toolsVersion, '--sbf-out-dir', output])
const binary = await readFile(resolve(output, 'manifest.so'))
await writeFile(resolve(output, 'build.json'), JSON.stringify({ ...upstream, predictionProgram: prediction, manifestProgram: manifest, binarySha256: createHash('sha256').update(binary).digest('hex'), guardSha256: createHash('sha256').update(await readFile(guardFile)).digest('hex'), source, productionApproved: false }, null, 2) + '\n')
console.log(`Customized Manifest built: ${output}`)
