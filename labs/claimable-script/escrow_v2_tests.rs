// Offline Escrow V2 tests against the covenant-enabled rusty-kaspa v2.0.1 engine.
// Copy this file and escrow_v2.sil into silverscript-lang/tests/ in the pinned lab.

mod common;

use common::{bytecode, compile_contract, compiled_template_parts_and_hash, encode_entry_sig_script};
use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId,
    TransactionInput, TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script, pay_to_script_hash_signature_script_with_flags};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use silverscript_abi::ArtifactValue;
use silverscript_lang::compiler::CompileOptions;

const SOURCE: &str = include_str!("escrow_v2.sil");
const AMOUNT: u64 = 100_000_000;
const FEE: u64 = 20_000;
const CLAIM_DELAY: u64 = 1_000;
const FALLBACK_DELAY: u64 = 2_000;
const ACTIVE: u8 = 0;
const FROZEN: u8 = 1;

fn hash(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().into()
}
fn le(value: u64) -> [u8; 8] { value.to_le_bytes() }
fn key(seed: u8) -> Keypair {
    let secret = SecretKey::from_slice(&[seed; 32]).unwrap();
    Keypair::from_secret_key(&Secp256k1::new(), &secret)
}
fn payout_spk(tag: u8) -> ScriptPublicKey {
    ScriptPublicKey::new(0, vec![0x51, 0x60 + tag].into())
}
fn serialized_spk(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut bytes = vec![0, 0];
    bytes.extend_from_slice(spk.script().as_ref());
    bytes
}
fn params(buyer: &[u8; 32], seller: &[u8; 32], mediator: &[u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&le(AMOUNT));
    preimage.extend_from_slice(&le(FEE));
    preimage.extend_from_slice(&le(CLAIM_DELAY));
    preimage.extend_from_slice(&le(FALLBACK_DELAY));
    preimage.extend_from_slice(buyer);
    preimage.extend_from_slice(seller);
    preimage.extend_from_slice(mediator);
    preimage.extend_from_slice(&hash(&serialized_spk(&payout_spk(1))));
    preimage.extend_from_slice(&hash(&serialized_spk(&payout_spk(2))));
    hash(&preimage)
}
fn state(phase: u8, params: &[u8; 32]) -> [u8; 32] {
    let mut preimage = vec![phase];
    preimage.extend_from_slice(params);
    hash(&preimage)
}
fn compile(init_state: [u8; 32]) -> silverscript_abi::SilAbiArtifact {
    compile_contract(SOURCE, &[ArtifactValue::Bytes(init_state.to_vec())], CompileOptions::default())
        .expect("Escrow V2 compiles")
}
fn with_state(artifact: &silverscript_abi::SilAbiArtifact, next: &[u8; 32]) -> Vec<u8> {
    let (mut prefix, suffix, _) = compiled_template_parts_and_hash(artifact);
    prefix.push(0x20);
    prefix.extend_from_slice(next);
    prefix.extend_from_slice(&suffix);
    prefix
}
fn args(buyer: &[u8; 32], seller: &[u8; 32], mediator: &[u8; 32]) -> Vec<ArtifactValue> {
    vec![
        ArtifactValue::Bytes(le(AMOUNT).to_vec()),
        ArtifactValue::Bytes(le(FEE).to_vec()),
        ArtifactValue::Bytes(le(CLAIM_DELAY).to_vec()),
        ArtifactValue::Bytes(le(FALLBACK_DELAY).to_vec()),
        ArtifactValue::Bytes(buyer.to_vec()),
        ArtifactValue::Bytes(seller.to_vec()),
        ArtifactValue::Bytes(mediator.to_vec()),
        ArtifactValue::Bytes(hash(&serialized_spk(&payout_spk(1))).to_vec()),
        ArtifactValue::Bytes(hash(&serialized_spk(&payout_spk(2))).to_vec()),
    ]
}

#[derive(Clone, Copy)]
enum Mutation { None, TooEarly, WrongMediator, WrongRecipient, WrongShare, WrongParty, MissingSigner, WrongInputAmount }

fn run(mode: &str, phase: u8, mutation: Mutation) -> Result<(), TxScriptError> {
    let buyer = key(0x21);
    let seller = key(0x22);
    let mediator = key(0x23);
    let stranger = key(0x24);
    let buyer_pk = buyer.x_only_public_key().0.serialize();
    let seller_pk = seller.x_only_public_key().0.serialize();
    let mediator_pk = mediator.x_only_public_key().0.serialize();
    let parameters = params(&buyer_pk, &seller_pk, &mediator_pk);
    let current = state(phase, &parameters);
    let artifact = compile(current);
    let script = bytecode(&artifact);
    let input_spk = pay_to_script_hash_script(&script);
    let buyer_spk = payout_spk(1);
    let seller_spk = payout_spk(2);
    let net = if phase == ACTIVE { AMOUNT } else { AMOUNT - FEE };
    let output = |value, script_public_key| TransactionOutput { value, script_public_key, covenant: None };
    let mut outputs = match mode {
        "release" | "claim" | "fallbackSeller" => vec![output(net, seller_spk.clone())],
        "refund" => vec![output(net, buyer_spk.clone())],
        "freeze" => vec![output(AMOUNT, ScriptPublicKey::new(
            0,
            pay_to_script_hash_script(&with_state(&artifact, &state(FROZEN, &parameters)))
                .script().to_vec().into(),
        ))],
        "agree" | "arbitrate" => vec![
            output(40_000_000, buyer_spk.clone()),
            output(AMOUNT - FEE - 40_000_000, seller_spk.clone()),
        ],
        _ => panic!("unknown mode"),
    };
    if matches!(mutation, Mutation::WrongRecipient) {
        outputs[0].script_public_key = payout_spk(3);
    }
    if matches!(mutation, Mutation::WrongShare) { outputs[0].value -= 1; }

    // Relative lock is committed by input sequence; consensus also checks the
    // actual UTXO age, which this isolated script engine cannot prove.
    let sequence = match mode {
        "claim" => if matches!(mutation, Mutation::TooEarly) { CLAIM_DELAY - 1 } else { CLAIM_DELAY },
        "fallbackSeller" => if matches!(mutation, Mutation::TooEarly) { FALLBACK_DELAY - 1 } else { FALLBACK_DELAY },
        _ => 0,
    };
    let input = TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([7u8; 32]), index: 0 },
        vec![], sequence, 2_000,
    );
    let tx = Transaction::new(1, vec![input], outputs, 0, Default::default(), 0, vec![]);
    let expected_input = if phase == ACTIVE { AMOUNT + FEE } else { AMOUNT };
    let utxo = UtxoEntry::new(
        if matches!(mutation, Mutation::WrongInputAmount) { expected_input + 1 } else { expected_input },
        input_spk, 0, false, None,
    );
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo.clone()]);
    let reused = SigHashReusedValuesUnsync::new();
    let sighash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &reused);
    let message = secp256k1::Message::from_digest_slice(sighash.as_bytes().as_slice()).unwrap();
    let sign = |pair: &Keypair| {
        let mut bytes = pair.sign_schnorr(message).as_ref().to_vec();
        bytes.push(SIG_HASH_ALL.to_u8());
        ArtifactValue::Bytes(bytes)
    };
    let mut witness = match mode {
        "release" | "freeze" => vec![sign(&buyer)],
        "claim" | "refund" | "fallbackSeller" => vec![sign(&seller)],
        "agree" => vec![sign(&buyer), sign(if matches!(mutation, Mutation::MissingSigner) { &stranger } else { &seller })],
        "arbitrate" => vec![
            sign(if matches!(mutation, Mutation::WrongParty) { &seller } else { &buyer }),
            sign(if matches!(mutation, Mutation::WrongMediator) { &stranger } else { &mediator }),
        ],
        _ => unreachable!(),
    };
    witness.extend(args(&buyer_pk, &seller_pk, &mediator_pk));
    match mode {
        "release" | "claim" | "fallbackSeller" => witness.push(ArtifactValue::Bytes(serialized_spk(&seller_spk))),
        "refund" => {
            witness.push(ArtifactValue::Bytes(vec![phase]));
            witness.push(ArtifactValue::Bytes(serialized_spk(&buyer_spk)));
        }
        "agree" | "arbitrate" => {
            if mode == "arbitrate" { witness.push(ArtifactValue::Bytes(vec![0])); }
            witness.push(ArtifactValue::Int(40_000_000));
            witness.push(ArtifactValue::Bytes(serialized_spk(&buyer_spk)));
            witness.push(ArtifactValue::Bytes(serialized_spk(&seller_spk)));
        }
        _ => {}
    }
    let inner = encode_entry_sig_script(&artifact, mode, &witness).expect("witness encodes");
    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };
    tx.tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(script, inner, flags).expect("p2sh script");
    let cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(&tx.tx, vec![utxo.clone()]);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("covenants context");
    let ctx = EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov_ctx);
    TxScriptEngine::from_transaction_input(
        &populated, &populated.tx().inputs[0], 0, &utxo, ctx, flags,
    ).execute()
}

fn run_invalid_funding_recovery(correct_amount: bool, wrong_recipient: bool) -> Result<(), TxScriptError> {
    let buyer = key(0x21);
    let seller = key(0x22);
    let mediator = key(0x23);
    let buyer_pk = buyer.x_only_public_key().0.serialize();
    let seller_pk = seller.x_only_public_key().0.serialize();
    let mediator_pk = mediator.x_only_public_key().0.serialize();
    let parameters = params(&buyer_pk, &seller_pk, &mediator_pk);
    let artifact = compile(state(ACTIVE, &parameters));
    let script = bytecode(&artifact);
    let input_spk = pay_to_script_hash_script(&script);
    let buyer_spk = payout_spk(1);
    let deposit = if correct_amount { AMOUNT + FEE } else { AMOUNT + FEE + 1_234 };
    let recipient = if wrong_recipient { payout_spk(3) } else { buyer_spk.clone() };
    let inputs = vec![
        TransactionInput::new_with_compute_budget(
            TransactionOutpoint { transaction_id: TransactionId::from_bytes([7u8; 32]), index: 0 },
            vec![], 0, 2_000,
        ),
        TransactionInput::new_with_compute_budget(
            TransactionOutpoint { transaction_id: TransactionId::from_bytes([8u8; 32]), index: 0 },
            vec![], 0, 0,
        ),
    ];
    let tx = Transaction::new(
        1, inputs, vec![TransactionOutput { value: deposit, script_public_key: recipient, covenant: None }],
        0, Default::default(), 0, vec![],
    );
    let covenant_utxo = UtxoEntry::new(deposit, input_spk, 0, false, None);
    let fee_utxo = UtxoEntry::new(FEE, payout_spk(4), 0, false, None);
    let entries = vec![covenant_utxo.clone(), fee_utxo];
    let mut tx = MutableTransaction::with_entries(tx, entries.clone());
    let reused = SigHashReusedValuesUnsync::new();
    let sighash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &reused);
    let message = secp256k1::Message::from_digest_slice(sighash.as_bytes().as_slice()).unwrap();
    let mut signature = buyer.sign_schnorr(message).as_ref().to_vec();
    signature.push(SIG_HASH_ALL.to_u8());
    let mut witness = vec![ArtifactValue::Bytes(signature)];
    witness.extend(args(&buyer_pk, &seller_pk, &mediator_pk));
    witness.push(ArtifactValue::Bytes(serialized_spk(&buyer_spk)));
    let inner = encode_entry_sig_script(&artifact, "recoverInvalidFunding", &witness)
        .expect("recovery witness encodes");
    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };
    tx.tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(script, inner, flags).expect("p2sh script");
    let cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(&tx.tx, entries);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("covenants context");
    let ctx = EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov_ctx);
    TxScriptEngine::from_transaction_input(
        &populated, &populated.tx().inputs[0], 0, &covenant_utxo, ctx, flags,
    ).execute()
}

#[test]
fn active_paths_work() {
    run("release", ACTIVE, Mutation::None).unwrap();
    run("refund", ACTIVE, Mutation::None).unwrap();
    run("claim", ACTIVE, Mutation::None).unwrap();
    run("freeze", ACTIVE, Mutation::None).unwrap();
}
#[test]
fn frozen_paths_work() {
    run("refund", FROZEN, Mutation::None).unwrap();
    run("agree", FROZEN, Mutation::None).unwrap();
    run("arbitrate", FROZEN, Mutation::None).unwrap();
    run("fallbackSeller", FROZEN, Mutation::None).unwrap();
}
#[test]
fn relative_time_locks_reject_early_spends() {
    assert!(run("claim", ACTIVE, Mutation::TooEarly).is_err());
    assert!(run("fallbackSeller", FROZEN, Mutation::TooEarly).is_err());
}
#[test]
fn mediator_and_payout_binding_reject_wrong_spends() {
    assert!(run("arbitrate", FROZEN, Mutation::WrongMediator).is_err());
    assert!(run("arbitrate", FROZEN, Mutation::WrongParty).is_err());
    assert!(run("agree", FROZEN, Mutation::MissingSigner).is_err());
    assert!(run("arbitrate", FROZEN, Mutation::WrongRecipient).is_err());
    assert!(run("arbitrate", FROZEN, Mutation::WrongShare).is_err());
    assert!(run("release", ACTIVE, Mutation::WrongInputAmount).is_err());
}

#[test]
fn invalid_funding_can_only_be_returned_in_full_to_the_buyer() {
    run_invalid_funding_recovery(false, false).unwrap();
    assert!(run_invalid_funding_recovery(true, false).is_err());
    assert!(run_invalid_funding_recovery(false, true).is_err());
}
