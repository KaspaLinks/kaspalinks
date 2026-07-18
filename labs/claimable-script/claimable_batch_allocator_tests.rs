// Batch allocator ScriptBuilder tests.
//
// Usage: copy this file to
// `silverscript-lang/silverscript-lang/tests/claimable_batch_allocator_tests.rs`
// inside the pinned kaspanet/silverscript checkout, then:
//
//   cargo test -p silverscript-lang --test claimable_batch_allocator_tests

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
const OP_TWO: u8 = 0x52;
const OP_IF: u8 = 0x63;
const OP_ELSE: u8 = 0x67;
const OP_ENDIF: u8 = 0x68;
const OP_VERIFY: u8 = 0x69;
const OP_EQUAL_VERIFY: u8 = 0x88;
const OP_NUM_EQUAL_VERIFY: u8 = 0x9d;
const OP_GREATER_THAN_OR_EQUAL: u8 = 0xa2;
const OP_CHECK_SIG: u8 = 0xac;
const OP_CHECK_SIG_VERIFY: u8 = 0xad;
const OP_TX_INPUT_COUNT: u8 = 0xb3;
const OP_TX_OUTPUT_COUNT: u8 = 0xb4;
const OP_TX_LOCK_TIME: u8 = 0xb5;
const OP_TX_OUTPUT_AMOUNT: u8 = 0xc2;
const OP_TX_OUTPUT_SPK: u8 = 0xc3;

const REFUND_AFTER: i64 = 500_000_000;
const FIRST_OUTPUT_VALUE: u64 = 100_000_000;
const SECOND_OUTPUT_VALUE: u64 = 200_000_000;
const FUNDING_VALUE: u64 = 301_000_000;
const REFUND_OUTPUT_VALUE: u64 = 300_000_000;
const COMPUTE_BUDGET: u16 = 500;

#[derive(Clone, Copy)]
enum Mutation {
    None,
    ChangedAmount,
    ChangedScript,
    MissingOutput,
    ExtraInput,
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

fn committed_outputs() -> Vec<(u64, ScriptPublicKey)> {
    vec![
        (FIRST_OUTPUT_VALUE, ScriptPublicKey::new(0, vec![OP_TRUE].into())),
        (
            SECOND_OUTPUT_VALUE,
            ScriptPublicKey::new(0, vec![OP_TWO].into()),
        ),
    ]
}

fn serialized_script_public_key(script: &ScriptPublicKey) -> Vec<u8> {
    let mut serialized = vec![0, 0];
    serialized.extend_from_slice(script.script().as_ref());
    serialized
}

fn build_allocator_redeem_script(
    activation_pk: &[u8],
    refund_pk: &[u8],
    refund_after: i64,
) -> Vec<u8> {
    let outputs = committed_outputs();
    let mut script = Vec::new();
    script.push(OP_IF);
    push_data(&mut script, activation_pk);
    script.push(OP_CHECK_SIG_VERIFY);
    script.push(OP_TX_INPUT_COUNT);
    push_i64(&mut script, 1);
    script.push(OP_NUM_EQUAL_VERIFY);
    script.push(OP_TX_OUTPUT_COUNT);
    push_i64(&mut script, outputs.len() as i64);
    script.push(OP_NUM_EQUAL_VERIFY);

    for (index, (amount, script_public_key)) in outputs.iter().enumerate() {
        push_i64(&mut script, index as i64);
        script.push(OP_TX_OUTPUT_AMOUNT);
        push_i64(&mut script, *amount as i64);
        script.push(OP_NUM_EQUAL_VERIFY);
        push_i64(&mut script, index as i64);
        script.push(OP_TX_OUTPUT_SPK);
        push_data(&mut script, &serialized_script_public_key(script_public_key));
        script.push(OP_EQUAL_VERIFY);
    }

    script.push(OP_TRUE);
    script.push(OP_ELSE);
    script.push(OP_TX_LOCK_TIME);
    push_i64(&mut script, refund_after);
    script.push(OP_GREATER_THAN_OR_EQUAL);
    script.push(OP_VERIFY);
    push_data(&mut script, refund_pk);
    script.push(OP_CHECK_SIG);
    script.push(OP_ENDIF);
    script
}

fn run_allocator_script(
    mode: &str,
    activation: &Keypair,
    refund: &Keypair,
    signer: &Keypair,
    lock_time: u64,
    mutation: Mutation,
) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let activation_pk = activation.x_only_public_key().0.serialize();
    let refund_pk = refund.x_only_public_key().0.serialize();
    let redeem_script = build_allocator_redeem_script(&activation_pk, &refund_pk, REFUND_AFTER);
    let funding_spk = pay_to_script_hash_script(&redeem_script);

    let mut outputs = if mode == "activate" {
        committed_outputs()
            .into_iter()
            .map(|(value, script_public_key)| TransactionOutput {
                value,
                script_public_key,
                covenant: None,
            })
            .collect::<Vec<_>>()
    } else {
        vec![TransactionOutput {
            value: REFUND_OUTPUT_VALUE,
            script_public_key: ScriptPublicKey::new(0, vec![OP_TRUE].into()),
            covenant: None,
        }]
    };

    match mutation {
        Mutation::ChangedAmount => outputs[0].value -= 1,
        Mutation::ChangedScript => {
            outputs[0].script_public_key = ScriptPublicKey::new(0, vec![OP_FALSE].into())
        }
        Mutation::MissingOutput => {
            outputs.pop();
        }
        Mutation::None | Mutation::ExtraInput => {}
    }

    let input_count = if matches!(mutation, Mutation::ExtraInput) { 2 } else { 1 };
    let inputs = (0..input_count)
        .map(|index| {
            TransactionInput::new_with_compute_budget(
                TransactionOutpoint {
                    transaction_id: TransactionId::from_bytes([9 + index as u8; 32]),
                    index: 0,
                },
                vec![],
                0,
                COMPUTE_BUDGET,
            )
        })
        .collect::<Vec<_>>();
    let tx = Transaction::new(1, inputs, outputs, lock_time, Default::default(), 0, vec![]);
    let utxo_entry = UtxoEntry::new(FUNDING_VALUE, funding_spk.clone(), 0, false, None);
    let entries = (0..input_count)
        .map(|_| utxo_entry.clone())
        .collect::<Vec<_>>();
    let mut tx = MutableTransaction::with_entries(tx, entries);

    let signing_reused = SigHashReusedValuesUnsync::new();
    let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &signing_reused);
    let message = secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).unwrap();
    let sig = signer.sign_schnorr(message);
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
        "activate" => OP_TRUE,
        "refund" => OP_FALSE,
        other => panic!("unknown mode {other}"),
    });
    tx.tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags)
            .expect("p2sh sigscript builds");

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

fn push_i64(script: &mut Vec<u8>, value: i64) {
    if value == 0 {
        script.push(OP_FALSE);
    } else if (1..=16).contains(&value) {
        script.push(OP_TRUE + value as u8 - 1);
    } else {
        push_script_number(script, value);
    }
}

fn push_script_number(script: &mut Vec<u8>, value: i64) {
    assert!(value >= 0, "lab script numbers are non-negative");
    let mut remaining = value as u64;
    let mut bytes = Vec::new();
    while remaining > 0 {
        bytes.push((remaining & 0xff) as u8);
        remaining >>= 8;
    }
    if bytes.last().is_some_and(|byte| byte & 0x80 != 0) {
        bytes.push(0);
    }
    push_data(script, &bytes);
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn from_hex(value: &str) -> Vec<u8> {
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("hex"))
        .collect()
}

#[test]
fn allocator_bytes_match_web_fixture() {
    let activation_pk =
        from_hex("bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72");
    let refund_pk =
        from_hex("1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c");
    let script = build_allocator_redeem_script(&activation_pk, &refund_pk, 123_456_789);
    assert_eq!(
        to_hex(&script),
        "6320bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72adb3519db4529d00c20400e1f5059d00c3030000518851c20400c2eb0b9d51c303000052885167b50415cd5b07a269201730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8cac68",
    );
}

#[test]
fn exact_activation_passes() {
    let activation = random_keypair();
    let refund = random_keypair();
    assert!(run_allocator_script("activate", &activation, &refund, &activation, 0, Mutation::None).is_ok());
}

#[test]
fn activation_rejects_changed_amount_or_script() {
    let activation = random_keypair();
    let refund = random_keypair();
    assert!(run_allocator_script("activate", &activation, &refund, &activation, 0, Mutation::ChangedAmount).is_err());
    assert!(run_allocator_script("activate", &activation, &refund, &activation, 0, Mutation::ChangedScript).is_err());
}

#[test]
fn activation_rejects_wrong_output_or_input_count() {
    let activation = random_keypair();
    let refund = random_keypair();
    assert!(run_allocator_script("activate", &activation, &refund, &activation, 0, Mutation::MissingOutput).is_err());
    assert!(run_allocator_script("activate", &activation, &refund, &activation, 0, Mutation::ExtraInput).is_err());
}

#[test]
fn activation_rejects_unrelated_key() {
    let activation = random_keypair();
    let refund = random_keypair();
    let attacker = random_keypair();
    assert!(run_allocator_script("activate", &activation, &refund, &attacker, 0, Mutation::None).is_err());
}

#[test]
fn activation_branch_remains_valid_after_refund_lock() {
    let activation = random_keypair();
    let refund = random_keypair();
    assert!(run_allocator_script("activate", &activation, &refund, &activation, REFUND_AFTER as u64, Mutation::None).is_ok());
}

#[test]
fn refund_requires_refund_key_and_expiry() {
    let activation = random_keypair();
    let refund = random_keypair();
    assert!(run_allocator_script("refund", &activation, &refund, &refund, (REFUND_AFTER - 1) as u64, Mutation::None).is_err());
    assert!(run_allocator_script("refund", &activation, &refund, &activation, REFUND_AFTER as u64, Mutation::None).is_err());
    assert!(run_allocator_script("refund", &activation, &refund, &refund, REFUND_AFTER as u64, Mutation::None).is_ok());
}
