import { createPublicClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { createRollupPrepareConfig, prepareChainConfig, createRollup } from '@arbitrum/orbit-sdk';
import { sanitizePrivateKey, generateChainId } from '@arbitrum/orbit-sdk/utils';
import { config } from 'dotenv';
import { writeFile } from 'fs/promises';
config();

function withFallbackPrivateKey(privateKey: string | undefined): `0x${string}` {
  if (typeof privateKey === 'undefined' || privateKey === '') {
    return generatePrivateKey();
  }

  return sanitizePrivateKey(privateKey);
}

if (typeof process.env.DEPLOYER_PRIVATE_KEY === 'undefined') {
  throw new Error(`Please provide the "DEPLOYER_PRIVATE_KEY" environment variable`);
}

// load or generate a random batch poster account
const batchPosterPrivateKey = withFallbackPrivateKey(process.env.BATCH_POSTER_PRIVATE_KEY);
const batchPoster = privateKeyToAccount(batchPosterPrivateKey).address;

// load or generate a random validator account
const validatorPrivateKey = withFallbackPrivateKey(process.env.VALIDATOR_PRIVATE_KEY);
const validator = privateKeyToAccount(validatorPrivateKey).address;

// set the parent chain and create a public client for it
const parentChain = arbitrumSepolia;
const parentChainPublicClient = createPublicClient({ chain: parentChain, transport: http() });

// load the deployer account
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));
parentChainPublicClient.account = deployer as any;
async function main() {
  // generate a random chain id
  const chainId = generateChainId();
  console.log({ chainId });

  const createRollupConfig = createRollupPrepareConfig({
    chainId: BigInt(chainId),
    owner: deployer.address,
    chainConfig: prepareChainConfig({
      chainId,
      arbitrum: {
        InitialChainOwner: deployer.address,
        DataAvailabilityCommittee: true,
        InitialArbOSVersion: 11,
      },
    }),
  });
  parentChainPublicClient.account = deployer as any;
  createRollupConfig.wasmModuleRoot =
    '0xda4e3ad5e7feacb817c21c8d0220da7650fe9051ece68a3f0b1c5d38bbb27b21';

  console.log(`wasm`, createRollupConfig.wasmModuleRoot);

  try {
    const rs = await createRollup({
      params: {
        config: createRollupConfig,
        batchPoster,
        validators: [validator],
      },
      account: deployer,
      parentChainPublicClient,
    });
    // console.log({ rs });
    const { coreContracts, transactionReceipt } = rs;

    console.log('xxx txhash', transactionReceipt.transactionHash);

    const obj = {
      'minL2BaseFee': 100000000,
      'chainOwner': deployer.address,
      'networkFeeReceiver': deployer.address,
      'infrastructureFeeCollector': deployer.address,
      'parent-chain-node-url': parentChain.rpcUrls.public.http[0],
      'parentChainId': parentChain.id,
      'chainName': 'GOATL222',
      batchPoster,
      chainId,
      'staker': validator,
    };

    console.log({
      orbitDeployHash: transactionReceipt.transactionHash,
      batchPosterPrivateKey,
      validatorPrivateKey,
      wasmModuleRoot: createRollupConfig.wasmModuleRoot,
    });

    await writeFile(
      'orbitSetupScriptConfig.json',
      JSON.stringify({ ...obj, ...coreContracts, utils: coreContracts.validatorUtils }, null, 2),
    );
  } catch (error) {
    console.error(`Rollup creation failed with error: ${error}`);
  }
}

main();
