#!/usr/bin/env node
// Sends the return of a Kaspa Links claim link without Kaspa Links.
//
// A claim link with automatic return can, after its claim window, only pay the
// wallet address committed when it was created. The return needs no key, so a
// "return file" (Download return file on the link page) holds everything: the
// prepared transaction plus the public values it was built from. This script
// checks that the file pays what it says, then submits it through public Kaspa
// nodes once the claim window is over.
//
//   node tools/claimable-return/send-return.mjs <return-file.json>          (check only)
//   node tools/claimable-return/send-return.mjs <return-file.json> --send   (submit)
//   ... --node wss://your-node:17110   use a node of your choice instead of the
//                                     public resolver
//
// Needs Node.js 22 or newer and a checkout of github.com/KaspaLinks/kaspalinks
// (it uses the official Kaspa WASM SDK in vendor/kaspa-wasm-v2.0.1).
// See docs/claimable-return-without-kaspa-links.md.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const FORMAT = "kaspa-links/claimable-return@1";
const SOMPI_PER_KAS = 100_000_000n;
const CONNECT_TIMEOUT_MS = 30_000;

const require = createRequire(import.meta.url);
const kaspa = require("../../vendor/kaspa-wasm-v2.0.1/kaspa.js");

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function kas(sompi) {
  const value = BigInt(sompi);
  const fraction = (value % SOMPI_PER_KAS).toString().padStart(8, "0").replace(/0+$/, "");
  return `${value / SOMPI_PER_KAS}${fraction ? `.${fraction}` : ""} KAS`;
}

function parseArgs(argv) {
  const args = { file: null, node: null, send: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--send") args.send = true;
    else if (value === "--node") args.node = argv[++index] ?? fail("--node needs a URL.");
    else if (!args.file) args.file = value;
    else fail(`Unexpected argument: ${value}`);
  }
  if (!args.file) fail("Usage: node send-return.mjs <return-file.json> [--send] [--node <url>]");
  return args;
}

/** Everything the file claims must follow from the transaction itself. */
function verifyFile(file) {
  if (file.format !== FORMAT) fail(`Not a Kaspa Links return file (format ${file.format}).`);
  if (file.network !== "mainnet") fail(`Unsupported network: ${file.network}.`);

  const transaction = kaspa.Transaction.deserializeFromSafeJSON(file.transactionSafeJson);
  // Recompute the id from the content; the stored one could be stale.
  if (transaction.finalize().toString() !== file.expectedTransactionId) {
    fail("The transaction does not match its id. The file was changed or is damaged.");
  }

  const fundingScript = kaspa.payToScriptHashScript(file.redeemScriptHex);
  const fundingAddress = kaspa.addressFromScriptPublicKey(fundingScript, "mainnet")?.toString();
  if (fundingAddress !== file.fundingAddress) {
    fail("The contract script does not belong to the funding address in the file.");
  }

  const inputs = transaction.inputs;
  if (inputs.length !== 1) fail("A return spends exactly one funding output.");
  const outpoint = inputs[0].previousOutpoint;
  if (
    outpoint.transactionId !== file.fundingOutpoint.transactionId ||
    outpoint.index !== file.fundingOutpoint.index
  ) {
    fail("The transaction spends a different output than the file describes.");
  }

  const outputs = transaction.outputs;
  if (outputs.length !== 1) fail("A return pays exactly one output.");
  const returnScript = kaspa.payToAddressScript(file.returnAddress).script;
  if (outputs[0].scriptPublicKey.script !== returnScript) {
    fail("The transaction does not pay the return address in the file.");
  }
  // The address must be the one committed in the contract that holds the KAS.
  if (!file.redeemScriptHex.toLowerCase().includes(returnScript.toLowerCase())) {
    fail("The return address is not the one committed in the link's contract.");
  }
  if (outputs[0].value !== BigInt(file.returnSompi)) {
    fail("The transaction pays a different amount than the file describes.");
  }
  if (transaction.lockTime !== BigInt(file.returnAfterDaaScore)) {
    fail("The transaction lock time differs from the claim window in the file.");
  }
  return transaction;
}

async function connect(nodeUrl) {
  const rpc = new kaspa.RpcClient(
    nodeUrl
      ? { networkId: "mainnet", url: nodeUrl }
      : { networkId: "mainnet", resolver: new kaspa.Resolver() },
  );
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timed out")), CONNECT_TIMEOUT_MS),
  );
  await Promise.race([rpc.connect(), timeout]).catch((error) =>
    fail(`Could not reach a Kaspa node (${error.message}). Try again or pass --node <url>.`),
  );
  return rpc;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let file;
  try {
    file = JSON.parse(readFileSync(args.file, "utf8"));
  } catch (error) {
    fail(`Could not read ${args.file}: ${error.message}`);
  }

  const transaction = verifyFile(file);
  console.log("Return file checked:");
  console.log(`  pays           ${kas(file.returnSompi)} to ${file.returnAddress}`);
  console.log(`  network fee    ${kas(file.feeSompi)}`);
  console.log(`  from           ${file.fundingAddress}`);
  console.log(`  transaction    ${file.expectedTransactionId}`);
  console.log("  Make sure the address above is your own wallet.\n");

  const rpc = await connect(args.node);
  try {
    const { virtualDaaScore } = await rpc.getBlockDagInfo();
    const opensAt = BigInt(file.returnAfterDaaScore);
    if (virtualDaaScore < opensAt) {
      const minutes = Number((opensAt - virtualDaaScore) / 10n / 60n);
      console.log(
        `The claim window is still open: the return is possible in about ${minutes} min.`,
      );
      return;
    }

    const { entries } = await rpc.getUtxosByAddresses([file.fundingAddress]);
    const stillLocked = entries.some(
      (entry) =>
        entry.outpoint.transactionId === file.fundingOutpoint.transactionId &&
        entry.outpoint.index === file.fundingOutpoint.index,
    );
    if (!stillLocked) {
      console.log("Nothing to return: this output was already claimed or returned.");
      return;
    }

    if (!args.send) {
      console.log("Ready. Run again with --send to submit the return.");
      return;
    }
    const submitted = await rpc.submitTransaction({ allowOrphan: false, transaction });
    const id = submitted.transactionId || transaction.id;
    console.log(`✓ Return submitted: ${id}`);
    console.log(`  https://kaspa.stream/transactions/${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already (accepted|in the mempool)|already spent|orphan/i.test(message)) {
      console.log(`The node did not accept it as new: ${message}`);
      console.log("It may already be in the mempool, or the output was spent a moment ago.");
      return;
    }
    fail(`The node rejected the return: ${message}`);
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}

await main();
process.exit(0);
