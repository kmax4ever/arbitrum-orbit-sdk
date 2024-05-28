import { Chain, createPublicClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import {
  createRollupPrepareConfig,
  prepareChainConfig,
  createRollupPrepareTransactionRequest,
  createRollupPrepareTransactionReceipt,
} from '@arbitrum/orbit-sdk';
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

function getBlockExplorerUrl(chain: Chain) {
  return chain.blockExplorers?.default.url;
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

async function main() {
  // generate a random chain id
  const chainId = generateChainId();

  // create the chain config
  const chainConfig = prepareChainConfig({
    chainId,
    arbitrum: { InitialChainOwner: deployer.address, DataAvailabilityCommittee: true },
  });

  // prepare the transaction for deploying the core contracts

  const config = createRollupPrepareConfig({
    chainId: BigInt(chainId),
    owner: deployer.address,
    chainConfig,
  });

  // for amd64
  //wasmModuleRoot: '0xba5ff5ddc46b5c63fa02168819b8e236fa18b4b551f20eba378e3543477298bf';
  // for arm64
  //wasmModuleRoot: '0x1cc4dd8f036f93e37b6c9fa4edfbefaf19cf893558e9358ad41ccb3804684092';

  config.wasmModuleRoot = '0xda4e3ad5e7feacb817c21c8d0220da7650fe9051ece68a3f0b1c5d38bbb27b21';
  console.log({ config });
  const request = await createRollupPrepareTransactionRequest({
    params: {
      config,
      batchPoster,
      validators: [validator],
    },
    account: deployer.address,
    publicClient: parentChainPublicClient,
  });

  // sign and send the transaction
  const txHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(request),
  });

  // get the transaction receipt after waiting for the transaction to complete
  const txReceipt = createRollupPrepareTransactionReceipt(
    await parentChainPublicClient.waitForTransactionReceipt({ hash: txHash }),
  );

  const coreContracts = txReceipt.getCoreContracts();

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
    orbitDeployHash: txReceipt.transactionHash,
    batchPosterPrivateKey,
    validatorPrivateKey,
  });

  await writeFile(
    'orbitSetupScriptConfig.json',
    JSON.stringify({ ...obj, ...coreContracts, utils: coreContracts.validatorUtils }, null, 2),
  );

  console.log(`Deployed in ${getBlockExplorerUrl(parentChain)}/tx/${txReceipt.transactionHash}`);
}

main();
