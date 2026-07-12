// UI ScriptBuilder claimable-link tests.
//
// Usage: copy this file to
// `silverscript-lang/silverscript-lang/tests/claimable_ui_scriptbuilder_tests.rs`
// inside the pinned kaspanet/silverscript checkout, then:
//
//   cargo test -p silverscript-lang --test claimable_ui_scriptbuilder_tests
//
// This harness verifies the hand-built ScriptBuilder contract used by
// `/toccata-lab`, not the Silverscript-compiled `claimable_link.sil` contract.
// It deliberately pins the byte layout against the web fixture and then runs
// claim/refund paths through the real rusty-kaspa v2.0.1 TxScriptEngine.

use kaspa_consensus_core::hashing::sighash::calc_schnorr_signature_hash;
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    MutableTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput,
    TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::{
    pay_to_script_hash_script, pay_to_script_hash_signature_script_with_flags, EngineCtx,
    EngineFlags, TxScriptEngine,
};
use rand::{thread_rng, RngCore};
use secp256k1::{Keypair, Secp256k1, SecretKey};

const OP_FALSE: u8 = 0x00;
const OP_TRUE: u8 = 0x51;
const OP_IF: u8 = 0x63;
const OP_ELSE: u8 = 0x67;
const OP_ENDIF: u8 = 0x68;
const OP_VERIFY: u8 = 0x69;
const OP_GREATER_THAN_OR_EQUAL: u8 = 0xa2;
const OP_CHECK_SIG: u8 = 0xac;
const OP_TX_LOCK_TIME: u8 = 0xb5;

const REFUND_AFTER: i64 = 500_000_000;
const INPUT_VALUE: u64 = 25_000_000; // 0.25 KAS
const OUTPUT_VALUE: u64 = 24_800_000; // 0.25 KAS minus the lab default fee
const COMPUTE_BUDGET: u16 = 11;

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

fn build_ui_redeem_script(link_pk: &[u8], refund_pk: &[u8], refund_after: i64) -> Vec<u8> {
    assert_eq!(link_pk.len(), 32, "link key must be x-only");
    assert_eq!(refund_pk.len(), 32, "refund key must be x-only");
    let mut script = Vec::new();
    script.push(OP_IF);
    push_data(&mut script, link_pk);
    script.push(OP_CHECK_SIG);
    script.push(OP_ELSE);
    script.push(OP_TX_LOCK_TIME);
    push_script_number(&mut script, refund_after);
    script.push(OP_GREATER_THAN_OR_EQUAL);
    script.push(OP_VERIFY);
    push_data(&mut script, refund_pk);
    script.push(OP_CHECK_SIG);
    script.push(OP_ENDIF);
    script
}

fn run_ui_script(
    mode: &str,
    link: &Keypair,
    refund: &Keypair,
    signer: &Keypair,
    lock_time: u64,
    tamper_outputs_after_signing: bool,
) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let link_pk = link.x_only_public_key().0.serialize();
    let refund_pk = refund.x_only_public_key().0.serialize();
    let redeem_script = build_ui_redeem_script(&link_pk, &refund_pk, REFUND_AFTER);
    let funding_spk = pay_to_script_hash_script(&redeem_script);

    let input = TransactionInput::new_with_compute_budget(
        TransactionOutpoint {
            transaction_id: TransactionId::from_bytes([9u8; 32]),
            index: 0,
        },
        vec![],
        0,
        COMPUTE_BUDGET,
    );
    let output = TransactionOutput {
        value: OUTPUT_VALUE,
        script_public_key: ScriptPublicKey::new(0, vec![OP_TRUE].into()),
        covenant: None,
    };
    let tx = Transaction::new(1, vec![input], vec![output], lock_time, Default::default(), 0, vec![]);
    let utxo_entry = UtxoEntry::new(INPUT_VALUE, funding_spk.clone(), 0, false, None);
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo_entry.clone()]);

    let signing_reused = SigHashReusedValuesUnsync::new();
    let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &signing_reused);
    let msg = secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).unwrap();
    let sig = signer.sign_schnorr(msg);
    let mut signature = Vec::new();
    signature.extend_from_slice(sig.as_ref().as_slice());
    signature.push(SIG_HASH_ALL.to_u8());

    let flags = EngineFlags {
        covenants_enabled: true,
        ..Default::default()
    };
    let mut inner = Vec::new();
    push_data(&mut inner, &signature);
    inner.push(match mode {
        "claim" => OP_TRUE,
        "refund" => OP_FALSE,
        other => panic!("unknown mode {other}"),
    });
    let sigscript =
        pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags).expect("p2sh sigscript builds");
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
        flags,
    );

    vm.execute()
}

fn push_data(script: &mut Vec<u8>, data: &[u8]) {
    assert!(data.len() <= 75, "small data push only");
    script.push(data.len() as u8);
    script.extend_from_slice(data);
}

fn push_script_number(script: &mut Vec<u8>, value: i64) {
    assert!(value >= 0, "lab lock time is non-negative");
    let mut remaining = value as u64;
    let mut bytes = Vec::new();
    while remaining > 0 {
        bytes.push((remaining & 0xff) as u8);
        remaining >>= 8;
    }
    if bytes.is_empty() {
        script.push(OP_FALSE);
        return;
    }
    if bytes.last().is_some_and(|byte| byte & 0x80 != 0) {
        bytes.push(0);
    }
    push_data(script, &bytes);
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn from_hex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

#[test]
fn ui_scriptbuilder_bytes_match_web_fixture() {
    let link_pk = from_hex("bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72");
    let refund_pk = from_hex("1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c");
    let script = build_ui_redeem_script(&link_pk, &refund_pk, 123_456_789);

    assert_eq!(
        to_hex(&script),
        "6320bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72ac67b50415cd5b07a269201730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8cac68",
    );
}

#[test]
fn ui_claim_with_link_key_signature_passes() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("claim", &link, &refund, &link, 0, false);
    assert!(result.is_ok(), "claim with link key failed: {}", result.unwrap_err());
}

#[test]
fn ui_claim_with_unrelated_key_fails() {
    let link = random_keypair();
    let refund = random_keypair();
    let attacker = random_keypair();
    let result = run_ui_script("claim", &link, &refund, &attacker, 0, false);
    assert!(result.is_err(), "claim with an unrelated key must fail");
}

#[test]
fn ui_claim_branch_still_passes_after_refund_lock() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("claim", &link, &refund, &link, REFUND_AFTER as u64, false);
    assert!(
        result.is_ok(),
        "current v1 script has no hard on-chain claim cutoff: {}",
        result.unwrap_err()
    );
}

#[test]
fn ui_refund_after_expiry_passes() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("refund", &link, &refund, &refund, REFUND_AFTER as u64, false);
    assert!(result.is_ok(), "refund after expiry failed: {}", result.unwrap_err());
}

#[test]
fn ui_refund_before_expiry_fails() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("refund", &link, &refund, &refund, (REFUND_AFTER as u64) - 1, false);
    assert!(result.is_err(), "refund before expiry must fail");
}

#[test]
fn ui_refund_key_cannot_use_claim_path() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("claim", &link, &refund, &refund, 0, false);
    assert!(result.is_err(), "refund key must not satisfy the claim path");
}

#[test]
fn ui_claim_key_cannot_use_refund_path() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("refund", &link, &refund, &link, REFUND_AFTER as u64, false);
    assert!(result.is_err(), "claim key must not satisfy the refund path");
}

#[test]
fn ui_claim_signature_does_not_survive_output_tampering() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("claim", &link, &refund, &link, 0, true);
    assert!(result.is_err(), "a tampered-output claim must invalidate the signature");
}

#[test]
fn ui_refund_signature_does_not_survive_output_tampering() {
    let link = random_keypair();
    let refund = random_keypair();
    let result = run_ui_script("refund", &link, &refund, &refund, REFUND_AFTER as u64, true);
    assert!(result.is_err(), "a tampered-output refund must invalidate the signature");
}
