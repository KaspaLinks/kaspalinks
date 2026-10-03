// TxScript engine tests for the keyless V5 return branch.
//
// Usage: copy this file and `giveaway_prize_v5.sil` to
// `silverscript-lang/tests/` in the pinned compiler checkout, then run:
//   cargo test -p silverscript-lang --test giveaway_prize_v5_tests

mod common;

use common::{bytecode, compile_contract, encode_entry_sig_script};
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput,
    TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{
    pay_to_script_hash_script, pay_to_script_hash_signature_script_with_flags, EngineCtx,
    EngineFlags, TxScriptEngine,
};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use silverscript_abi::ArtifactValue;
use silverscript_lang::compiler::CompileOptions;

const SOURCE: &str = include_str!("giveaway_prize_v5.sil");
const PRIZE: u64 = 100_000_000;
const FEE: u64 = 1_000_000;
const CLOSES_AT_DAA: u64 = 200_000_000;
const REFUND_DAA: u64 = 200_100_000;
const COMPUTE_BUDGET: u16 = 5_000;

fn digest32(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

fn u64le(value: u64) -> [u8; 8] {
    assert!(value < 1 << 55);
    value.to_le_bytes()
}

fn return_spk(seed: u8) -> ScriptPublicKey {
    let mut script = vec![0x20];
    script.extend_from_slice(&[seed; 32]);
    script.push(0xac);
    ScriptPublicKey::new(0, script.into())
}

fn serialized_spk(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut out = vec![0u8, 0u8];
    out.extend_from_slice(spk.script().as_ref());
    out
}

fn params_hash(refund_spk: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&u64le(PRIZE));
    preimage.extend_from_slice(&u64le(FEE));
    preimage.extend_from_slice(&u64le(CLOSES_AT_DAA));
    preimage.extend_from_slice(&u64le(REFUND_DAA));
    preimage.extend_from_slice(refund_spk);
    digest32(&preimage)
}

fn state_hash(phase: u8, params: &[u8; 32], entries_root: &[u8; 32]) -> [u8; 32] {
    let mut preimage = vec![phase];
    preimage.extend_from_slice(params);
    preimage.extend_from_slice(entries_root);
    digest32(&preimage)
}

fn compile(init_state: [u8; 32]) -> silverscript_abi::SilAbiArtifact {
    let secret = SecretKey::from_slice(&[0x11; 32]).unwrap();
    let platform = Keypair::from_secret_key(&Secp256k1::new(), &secret);
    compile_contract(
        SOURCE,
        &[
            ArtifactValue::Bytes(platform.x_only_public_key().0.serialize().to_vec()),
            ArtifactValue::Bytes(init_state.to_vec()),
        ],
        CompileOptions::default(),
    )
    .expect("giveaway_prize_v5.sil compiles")
}

#[derive(Clone, Copy)]
enum Mutation {
    None,
    WrongAddress,
    WrongAmount,
    ExtraOutput,
    ExtraInput,
    TooEarly,
}

fn run(frozen_empty: bool, mutation: Mutation) -> Result<(), TxScriptError> {
    let destination = return_spk(0x44);
    let refund_spk = serialized_spk(&destination);
    let params = params_hash(&refund_spk);
    let entries_root = if frozen_empty {
        digest32(&[])
    } else {
        [0u8; 32]
    };
    let phase = if frozen_empty { 0x01 } else { 0x00 };
    let artifact = compile(state_hash(phase, &params, &entries_root));
    let redeem_script = bytecode(&artifact);
    let funding_spk = pay_to_script_hash_script(&redeem_script);
    let input_value = if frozen_empty {
        PRIZE + FEE
    } else {
        PRIZE + 2 * FEE
    };
    let deadline = if frozen_empty {
        CLOSES_AT_DAA
    } else {
        REFUND_DAA
    };

    let output_spk = if matches!(mutation, Mutation::WrongAddress) {
        return_spk(0x55)
    } else {
        destination
    };
    let output_value = input_value - FEE - u64::from(matches!(mutation, Mutation::WrongAmount));
    let mut outputs = vec![TransactionOutput {
        value: output_value,
        script_public_key: output_spk,
        covenant: None,
    }];
    if matches!(mutation, Mutation::ExtraOutput) {
        outputs.push(TransactionOutput {
            value: 1,
            script_public_key: return_spk(0x66),
            covenant: None,
        });
    }
    let mut inputs = vec![TransactionInput::new_with_compute_budget(
        TransactionOutpoint {
            transaction_id: TransactionId::from_bytes([7u8; 32]),
            index: 0,
        },
        vec![],
        0,
        COMPUTE_BUDGET,
    )];
    if matches!(mutation, Mutation::ExtraInput) {
        inputs.push(TransactionInput::new_with_compute_budget(
            TransactionOutpoint {
                transaction_id: TransactionId::from_bytes([8u8; 32]),
                index: 0,
            },
            vec![],
            0,
            0,
        ));
    }
    let lock_time = if matches!(mutation, Mutation::TooEarly) {
        deadline - 1
    } else {
        deadline
    };
    let mut tx = Transaction::new(1, inputs, outputs, lock_time, Default::default(), 0, vec![]);
    let first_utxo = UtxoEntry::new(input_value, funding_spk, 0, false, None);
    let mut utxos = vec![first_utxo.clone()];
    if matches!(mutation, Mutation::ExtraInput) {
        utxos.push(UtxoEntry::new(1, return_spk(0x77), 0, false, None));
    }

    let witness = vec![
        ArtifactValue::Bytes(u64le(PRIZE).to_vec()),
        ArtifactValue::Bytes(u64le(FEE).to_vec()),
        ArtifactValue::Bytes(u64le(CLOSES_AT_DAA).to_vec()),
        ArtifactValue::Bytes(u64le(REFUND_DAA).to_vec()),
        ArtifactValue::Bytes(refund_spk),
        ArtifactValue::Bytes(vec![phase]),
        ArtifactValue::Bytes(entries_root.to_vec()),
    ];
    let flags = EngineFlags {
        covenants_enabled: true,
        ..Default::default()
    };
    let inner = encode_entry_sig_script(&artifact, "refund", &witness).unwrap();
    tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags).unwrap();

    let populated = PopulatedTransaction::new(&tx, utxos);
    let cov_ctx = CovenantsContext::from_tx(&populated).unwrap();
    let cache = Cache::new(100);
    let reused = SigHashReusedValuesUnsync::new();
    let ctx = EngineCtx::new(&cache)
        .with_reused(&reused)
        .with_covenants_ctx(&cov_ctx);
    TxScriptEngine::from_transaction_input(
        &populated,
        &populated.tx().inputs[0],
        0,
        &first_utxo,
        ctx,
        flags,
    )
    .execute()
}

#[test]
fn open_fallback_return_passes_without_a_signature() {
    run(false, Mutation::None).expect("exact committed return passes");
}

#[test]
fn frozen_empty_return_passes_at_entry_close() {
    run(true, Mutation::None).expect("empty giveaway returns at close");
}

#[test]
fn return_rejects_every_redirect_or_value_change() {
    for mutation in [
        Mutation::WrongAddress,
        Mutation::WrongAmount,
        Mutation::ExtraOutput,
        Mutation::ExtraInput,
        Mutation::TooEarly,
    ] {
        assert!(run(false, mutation).is_err());
    }
}
