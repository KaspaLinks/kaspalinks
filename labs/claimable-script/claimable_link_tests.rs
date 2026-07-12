// ClaimableLink lab tests — executes the compiled contract against the real
// kaspa-txscript engine (rusty-kaspa v2.0.1, the Toccata mainnet release).
//
// Usage: copy this file to `silverscript-lang/tests/claimable_link_tests.rs`
// and `claimable_link.sil` to `silverscript-lang/tests/examples/` inside the
// pinned kaspanet/silverscript checkout, then:
//
//   cargo test -p silverscript-lang --test claimable_link_tests
//
// See labs/claimable-script/README.md and docs/claimable-links-lab.md.

use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::hashing::sighash::calc_schnorr_signature_hash;
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::mass::units::SigopCount;
use kaspa_consensus_core::tx::{
    MutableTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine};
use rand::{RngCore, thread_rng};
use secp256k1::{Keypair, Secp256k1, SecretKey};
use std::fs;

use silverscript_lang::compiler::{CompileOptions, compile_contract};

/// Expiry used across the tests. `tx.time` compiles against the transaction
/// lock_time, so the refund path unlocks once lock_time >= REFUND_AFTER.
const REFUND_AFTER: i64 = 500_000_000;

const INPUT_VALUE: u64 = 100_000_000; // 1 KAS
const OUTPUT_VALUE: u64 = 99_000_000; // minus a dummy fee

fn load_example_source(name: &str) -> String {
    let path = format!("{}/tests/examples/{name}", env!("CARGO_MANIFEST_DIR"));
    fs::read_to_string(&path).unwrap_or_else(|err| panic!("failed to read {path}: {err}"))
}

fn random_keypair() -> Keypair {
    let secp = Secp256k1::new();
    let mut rng = thread_rng();
    let mut sk_bytes = [0u8; 32];
    loop {
        rng.fill_bytes(&mut sk_bytes);
        if let Ok(secret_key) = SecretKey::from_slice(&sk_bytes) {
            return Keypair::from_secret_key(&secp, &secret_key);
        }
    }
}

/// Compiles ClaimableLink, builds a 1-in/1-out spend of the contract UTXO,
/// signs the sighash with `signer`, and executes the chosen entrypoint on the
/// real script engine. `tamper_outputs_after_signing` modifies the outputs
/// after the signature is produced — the mempool front-run scenario. Signing
/// and execution deliberately use separate SigHashReusedValues instances so
/// the engine recomputes the sighash exactly like a validating node.
fn run_with_keys(
    entrypoint: &str,
    link: &Keypair,
    refund: &Keypair,
    signer: &Keypair,
    lock_time: u64,
    tamper_outputs_after_signing: bool,
) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let source = load_example_source("claimable_link.sil");

    let link_pk = link.x_only_public_key().0.serialize();
    let refund_pk = refund.x_only_public_key().0.serialize();
    let constructor_args = vec![link_pk.to_vec().into(), refund_pk.to_vec().into(), REFUND_AFTER.into()];
    let compiled = compile_contract(&source, &constructor_args, CompileOptions::default()).expect("compile succeeds");

    let input = TransactionInput {
        previous_outpoint: TransactionOutpoint { transaction_id: TransactionId::from_bytes([7u8; 32]), index: 0 },
        signature_script: vec![],
        sequence: 0,
        compute_commit: SigopCount(1).into(),
    };
    let output = TransactionOutput {
        value: OUTPUT_VALUE,
        script_public_key: ScriptPublicKey::new(0, compiled.script.clone().into()),
        covenant: None,
    };

    let tx = Transaction::new(1, vec![input], vec![output], lock_time, Default::default(), 0, vec![]);
    let utxo_entry =
        UtxoEntry::new(INPUT_VALUE, ScriptPublicKey::new(0, compiled.script.clone().into()), 0, tx.is_coinbase(), None);
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo_entry.clone()]);

    let signing_reused = SigHashReusedValuesUnsync::new();
    let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &signing_reused);
    let msg = secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).unwrap();
    let sig = signer.sign_schnorr(msg);
    let mut signature = Vec::new();
    signature.extend_from_slice(sig.as_ref().as_slice());
    signature.push(SIG_HASH_ALL.to_u8());

    let sigscript = compiled.build_sig_script(entrypoint, vec![signature.into()]).expect("sigscript builds");
    tx.tx.inputs[0].signature_script = sigscript;

    if tamper_outputs_after_signing {
        tx.tx.outputs[0].value -= 1_000_000;
    }

    let executing_reused = SigHashReusedValuesUnsync::new();
    let tx = tx.as_verifiable();
    let sig_cache = Cache::new(10_000);
    let mut vm = TxScriptEngine::from_transaction_input(
        &tx,
        &tx.inputs()[0],
        0,
        &utxo_entry,
        EngineCtx::new(&sig_cache).with_reused(&executing_reused),
        EngineFlags { covenants_enabled: true, ..Default::default() },
    );

    vm.execute()
}

#[test]
fn claim_with_link_key_signature_passes() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_with_keys("claim", &link, &refund, &link, 0, false);
    assert!(result.is_ok(), "claim with link key failed: {}", result.unwrap_err());
}

#[test]
fn claim_with_unrelated_key_fails() {
    let link = random_keypair();
    let refund = random_keypair();
    let attacker = random_keypair();
    let result = run_with_keys("claim", &link, &refund, &attacker, 0, false);
    assert!(result.is_err(), "claim with an unrelated key must fail");
}

#[test]
fn refund_after_expiry_passes() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_with_keys("refund", &link, &refund, &refund, REFUND_AFTER as u64, false);
    assert!(result.is_ok(), "refund after expiry failed: {}", result.unwrap_err());
}

#[test]
fn refund_before_expiry_fails() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_with_keys("refund", &link, &refund, &refund, (REFUND_AFTER as u64) - 1, false);
    assert!(result.is_err(), "refund before expiry must fail");
}

#[test]
fn refund_key_cannot_use_claim_path() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_with_keys("claim", &link, &refund, &refund, 0, false);
    assert!(result.is_err(), "refund key must not satisfy the claim path");
}

#[test]
fn claim_signature_does_not_survive_output_tampering() {
    // Mempool front-run scenario: reuse a valid claim signature on a
    // transaction whose outputs were modified afterwards.
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_with_keys("claim", &link, &refund, &link, 0, true);
    assert!(result.is_err(), "a tampered-output claim must invalidate the signature");
}
