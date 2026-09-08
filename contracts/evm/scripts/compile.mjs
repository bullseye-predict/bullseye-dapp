import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function compile({ write = true, test = false } = {}) {
  const sources = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'artifacts', 'abi'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith('.sol') && (test || !absolute.includes(`${path.sep}test${path.sep}`))) {
        sources[path.relative(root, absolute).split(path.sep).join('/')] = { content: fs.readFileSync(absolute, 'utf8') };
      }
    }
  };
  walk(root);
  const input = {
    language: 'Solidity', sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      // Portable baseline: no Cancun-only opcodes; deployment chains must support Shanghai.
      evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import(importPath) {
      const absolute = path.resolve(root, 'node_modules', importPath);
      if (!absolute.startsWith(`${path.join(root, 'node_modules')}${path.sep}`)) return { error: 'Invalid import path' };
      try { return { contents: fs.readFileSync(absolute, 'utf8') }; }
      catch { return { error: `Cannot import ${importPath}` }; }
    },
  }));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  for (const warning of output.errors ?? []) console.warn(warning.formattedMessage);
  const artifacts = {};
  for (const [source, contracts] of Object.entries(output.contracts)) {
    if (!sources[source]) continue;
    for (const [name, contract] of Object.entries(contracts)) {
      if (!contract.evm.bytecode.object) continue;
      const artifact = {
        contractName: name, sourceName: source, compiler: solc.version(), evmVersion: 'shanghai',
        abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
        deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
      };
      if (artifact.deployedBytecode.length / 2 - 1 > 24_576) throw new Error(`${name} exceeds EIP-170 runtime size`);
      if (artifact.bytecode.length / 2 - 1 > 49_152) throw new Error(`${name} exceeds EIP-3860 initcode size`);
      artifacts[name] = artifact;
      if (write) {
        fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
        fs.mkdirSync(path.join(root, 'abi'), { recursive: true });
        fs.writeFileSync(path.join(root, 'artifacts', `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
        if (!source.startsWith('test/')) fs.writeFileSync(path.join(root, 'abi', `${name}.json`), `${JSON.stringify(contract.abi, null, 2)}\n`);
      }
    }
  }
  return artifacts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifacts = compile();
  for (const artifact of Object.values(artifacts)) {
    console.log(`${artifact.contractName}: compiled, runtime ${artifact.deployedBytecode.length / 2 - 1} bytes`);
  }
}
