// Claimable link v2 ("auto-return") ScriptBuilder tests.
//
// The claim branch is unchanged from v1. The return branch needs no key: after
// the lock time anyone may spend the single input, but only into one output to
// the committed return script, worth at least the input minus the committed fee.
//
// Usage: copy this file to
// `silverscript-lang/silverscript-lang/tests/claimable_autoreturn_tests.rs`
// inside the pinned kaspanet/silverscript checkout, then:
//
//   cargo test -p silverscript-lang --test claimable_autoreturn_tests

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
const OP_EQUAL_VERIFY: u8 = 0x88;
const OP_SUB: u8 = 0x94;
const OP_NUM_EQUAL_VERIFY: u8 = 0x9d;
const OP_GREATER_THAN_OR_EQUAL: u8 = 0xa2;
const OP_CHECK_SIG: u8 = 0xac;
const OP_TX_INPUT_COUNT: u8 = 0xb3;
const OP_TX_OUTPUT_COUNT: u8 = 0xb4;
const OP_TX_LOCK_TIME: u8 = 0xb5;
const OP_TX_INPUT_INDEX: u8 = 0xb9;
const OP_TX_INPUT_AMOUNT: u8 = 0xbe;
const OP_TX_OUTPUT_AMOUNT: u8 = 0xc2;
const OP_TX_OUTPUT_SPK: u8 = 0xc3;

const REFUND_AFTER: i64 = 500_000_000;
const FEE: u64 = 200_000;
const FUNDING_VALUE: u64 = 25_200_000;
// Same budget the web app sends for claimable spends.
const COMPUTE_BUDGET: u16 = 11;

#[derive(Clone, Copy)]
enum Spend {
    Claim,
    Return,
}

#[derive(Clone, Copy)]
enum Mutation {
    None,
    /// Output pays one sompi less than input minus the committed fee.
    FeeTooHigh,
    /// Output goes to a script other than the committed return address.
    WrongReturnScript,
    /// A second output (e.g. an attacker's change) is added.
    ExtraOutput,
    /// Two inputs of the same address are merged into one return.
    ExtraInput,
    /// The link was overfunded; the return pays the full input minus the fee.
    OverfundedFullReturn,
    /// The link was overfunded; the return only pays the planned amount.
    OverfundedPlannedReturn,
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

fn p2pk_script(key: &Keypair) -> ScriptPublicKey {
    let mut script = Vec::new();
    push_data(&mut script, &key.x_only_public_key().0.serialize());
    script.push(OP_CHECK_SIG);
    ScriptPublicKey::new(0, script.into())
}

fn serialized_script_public_key(script: &ScriptPublicKey) -> Vec<u8> {
    let mut serialized = script.version().to_be_bytes().to_vec();
    serialized.extend_from_slice(script.script().as_ref());
    serialized
}

/// Byte-for-byte the script `buildToccataClaimableAutoReturnScript` builds.
fn build_autoreturn_redeem_script(
    link_pk: &[u8],
    refund_after: i64,
    return_spk: &[u8],
    fee: i64,
) -> Vec<u8> {
    let mut script = Vec::new();
    script.push(OP_IF);
    push_data(&mut script, link_pk);
    script.push(OP_CHECK_SIG);
    script.push(OP_ELSE);
    script.push(OP_TX_LOCK_TIME);
    push_i64(&mut script, refund_after);
    script.push(OP_GREATER_THAN_OR_EQUAL);
    script.push(OP_VERIFY);
    script.push(OP_TX_INPUT_COUNT);
    push_i64(&mut script, 1);
    script.push(OP_NUM_EQUAL_VERIFY);
    script.push(OP_TX_OUTPUT_COUNT);
    push_i64(&mut script, 1);
    script.push(OP_NUM_EQUAL_VERIFY);
    push_i64(&mut script, 0);
    script.push(OP_TX_OUTPUT_SPK);
    push_data(&mut script, return_spk);
    script.push(OP_EQUAL_VERIFY);
    push_i64(&mut script, 0);
    script.push(OP_TX_OUTPUT_AMOUNT);
    script.push(OP_TX_INPUT_INDEX);
    script.push(OP_TX_INPUT_AMOUNT);
    push_i64(&mut script, fee);
    script.push(OP_SUB);
    script.push(OP_GREATER_THAN_OR_EQUAL);
    script.push(OP_ENDIF);
    script
}

fn run(
    spend: Spend,
    link: &Keypair,
    signer: &Keypair,
    owner: &Keypair,
    lock_time: u64,
    mutation: Mutation,
) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let link_pk = link.x_only_public_key().0.serialize();
    let return_script = p2pk_script(owner);
    let redeem_script = build_autoreturn_redeem_script(
        &link_pk,
        REFUND_AFTER,
        &serialized_script_public_key(&return_script),
        FEE as i64,
    );
    let funding_spk = pay_to_script_hash_script(&redeem_script);

    let funding_value = match mutation {
        Mutation::OverfundedFullReturn | Mutation::OverfundedPlannedReturn => FUNDING_VALUE * 2,
        _ => FUNDING_VALUE,
    };
    let mut output_value = funding_value - FEE;
    let mut output_script = match spend {
        // A claimer may send anywhere; use a fresh key as their wallet.
        Spend::Claim => p2pk_script(&random_keypair()),
        Spend::Return => return_script.clone(),
    };
    match mutation {
        Mutation::FeeTooHigh => output_value -= 1,
        Mutation::WrongReturnScript => output_script = p2pk_script(&random_keypair()),
        Mutation::OverfundedPlannedReturn => output_value = FUNDING_VALUE - FEE,
        _ => {}
    }
    let mut outputs = vec![TransactionOutput {
        value: output_value,
        script_public_key: output_script,
        covenant: None,
    }];
    if matches!(mutation, Mutation::ExtraOutput) {
        outputs[0].value -= 1_000;
        outputs.push(TransactionOutput {
            value: 1_000,
            script_public_key: p2pk_script(&random_keypair()),
            covenant: None,
        });
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
    let utxo_entry = UtxoEntry::new(funding_value, funding_spk.clone(), 0, false, None);
    let entries = (0..input_count).map(|_| utxo_entry.clone()).collect::<Vec<_>>();
    let mut tx = MutableTransaction::with_entries(tx, entries);

    let flags = EngineFlags {
        covenants_enabled: true,
        ..Default::default()
    };
    let mut inner = Vec::new();
    match spend {
        Spend::Claim => {
            let reused = SigHashReusedValuesUnsync::new();
            let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &reused);
            let message =
                secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).unwrap();
            let sig = signer.sign_schnorr(message);
            let mut signature = Vec::new();
            signature.extend_from_slice(sig.as_ref().as_slice());
            signature.push(SIG_HASH_ALL.to_u8());
            push_data(&mut inner, &signature);
            inner.push(OP_TRUE);
        }
        // Keyless: only the branch selector.
        Spend::Return => inner.push(OP_FALSE),
    }
    let signature_script = pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags)
        .expect("p2sh sigscript builds");
    for input in tx.tx.inputs.iter_mut() {
        input.signature_script = signature_script.clone();
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
fn autoreturn_bytes_match_web_fixture() {
    // packages/kaspa/src/toccata.test.ts, return address
    // kaspa:qrpuhc8c998cdp4fkgjljspuwtetvjhy022k0a00da4dxh3kkz89qa96gge5r.
    let link_pk = from_hex("4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa");
    let return_spk =
        from_hex("000020c3cbe0f8294f8686a9b225f9403c72f2b64ae47a9567f5ef6f6ad35e36b08e50ac");
    let script = build_autoreturn_redeem_script(&link_pk, 123_456_789, &return_spk, 200_000);
    assert_eq!(
        to_hex(&script),
        "63204f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac67b50415cd5b07a269b3519db4519d00c324000020c3cbe0f8294f8686a9b225f9403c72f2b64ae47a9567f5ef6f6ad35e36b08e50ac8800c2b9be03400d0394a268",
    );
}

#[test]
fn claim_requires_the_link_key() {
    let link = random_keypair();
    let owner = random_keypair();
    let attacker = random_keypair();
    assert!(run(Spend::Claim, &link, &link, &owner, 0, Mutation::None).is_ok());
    assert!(run(Spend::Claim, &link, &attacker, &owner, 0, Mutation::None).is_err());
    assert!(run(Spend::Claim, &link, &owner, &owner, 0, Mutation::None).is_err());
}

#[test]
fn claim_stays_valid_after_expiry() {
    let link = random_keypair();
    let owner = random_keypair();
    assert!(run(Spend::Claim, &link, &link, &owner, REFUND_AFTER as u64, Mutation::None).is_ok());
}

#[test]
fn return_waits_for_the_lock_time() {
    let link = random_keypair();
    let owner = random_keypair();
    let anyone = random_keypair();
    assert!(run(Spend::Return, &link, &anyone, &owner, 0, Mutation::None).is_err());
    assert!(
        run(Spend::Return, &link, &anyone, &owner, (REFUND_AFTER - 1) as u64, Mutation::None)
            .is_err()
    );
}

#[test]
fn anyone_can_return_after_expiry_without_a_key() {
    let link = random_keypair();
    let owner = random_keypair();
    let anyone = random_keypair();
    assert!(run(Spend::Return, &link, &anyone, &owner, REFUND_AFTER as u64, Mutation::None).is_ok());
    assert!(
        run(Spend::Return, &link, &anyone, &owner, (REFUND_AFTER + 10_000) as u64, Mutation::None)
            .is_ok()
    );
}

#[test]
fn return_cannot_go_anywhere_else() {
    let link = random_keypair();
    let owner = random_keypair();
    let anyone = random_keypair();
    let after = REFUND_AFTER as u64;
    assert!(run(Spend::Return, &link, &anyone, &owner, after, Mutation::WrongReturnScript).is_err());
    assert!(run(Spend::Return, &link, &anyone, &owner, after, Mutation::ExtraOutput).is_err());
}

#[test]
fn return_cannot_burn_more_than_the_committed_fee() {
    let link = random_keypair();
    let owner = random_keypair();
    let anyone = random_keypair();
    let after = REFUND_AFTER as u64;
    assert!(run(Spend::Return, &link, &anyone, &owner, after, Mutation::FeeTooHigh).is_err());
    assert!(run(Spend::Return, &link, &anyone, &owner, after, Mutation::ExtraInput).is_err());
}

#[test]
fn overfunded_links_return_everything_but_the_fee() {
    let link = random_keypair();
    let owner = random_keypair();
    let anyone = random_keypair();
    let after = REFUND_AFTER as u64;
    assert!(run(Spend::Return, &link, &anyone, &owner, after, Mutation::OverfundedFullReturn).is_ok());
    assert!(
        run(Spend::Return, &link, &anyone, &owner, after, Mutation::OverfundedPlannedReturn).is_err()
    );
}
