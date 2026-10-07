// TxScript engine tests for the capital-efficient Giveaway V6 shard family.
//
// Usage: copy this file, `giveaway_entry_shard_v6.sil`, and
// `giveaway_prize_shards_v6.sil` to `silverscript-lang/tests/`, then run:
//   cargo test -p silverscript-lang --test giveaway_sharded_family_v6_tests

mod common;

use common::{
    COV_A, bytecode, compiled_template_parts_and_hash, encode_entry_sig_script, execute_input_with_covenants, push_redeem_script,
    tx_input,
};
use kaspa_consensus_core::{
    config::params::MAINNET_PARAMS,
    hashing::sighash::SigHashReusedValuesUnsync,
    mass::{ComputeBudget, MassCalculator, ScriptUnits},
    tx::{CovenantBinding, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionOutput, UtxoEntry, VerifiableTransaction},
};
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, caches::Cache, covenants::CovenantsContext, pay_to_script_hash_script};
use sha2::{Digest, Sha256};
use silverscript_abi::{ArtifactValue, SilAbiArtifact};
use silverscript_lang::compiler::{CompileOptions, compile_to_sil_abi_artifact_with_options};

const SHARD_SOURCE: &str = include_str!("giveaway_entry_shard_v6.sil");
const PRIZE_SOURCE: &str = include_str!("giveaway_prize_shards_v6.sil");
const CLOSES_AT_DAA: u64 = 100;
const SHARD_COUNT: usize = 4;
const FAMILY_SIZE: usize = SHARD_COUNT + 1;
const TREE_DEPTH: usize = 4;
const MAX_ENTRIES: i64 = 16;
const PRIZE_VALUE: u64 = 1_000;
const SHARD_VALUE: u64 = 2_000;
const ACTIVATION_FEE: u64 = 100;
const ENTRY_FEE: u64 = 50;
const FREEZE_FEE: u64 = 100;
const DRAW_FEE: u64 = 100;
const RETURN_FEE: u64 = 100;
const RETURN_AT_DAA: u64 = 200;

fn zero() -> [u8; 32] {
    [0; 32]
}

fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

fn node(domain: u8, left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut preimage = vec![domain];
    preimage.extend_from_slice(&left);
    preimage.extend_from_slice(&right);
    sha256(&preimage)
}

fn leaf(domain: u8, value: [u8; 32]) -> [u8; 32] {
    let mut preimage = vec![domain];
    preimage.extend_from_slice(&value);
    sha256(&preimage)
}

fn empty_levels(depth: usize, leaf_domain: u8, node_domain: u8) -> Vec<[u8; 32]> {
    let mut levels = vec![leaf(leaf_domain, zero())];
    for level in 0..depth {
        levels.push(node(node_domain, levels[level], levels[level]));
    }
    levels
}

fn update_root(mut current: [u8; 32], mut path: u64, siblings: &[[u8; 32]], domain: u8) -> [u8; 32] {
    for sibling in siblings {
        current = if path % 2 == 0 { node(domain, current, *sibling) } else { node(domain, *sibling, current) };
        path /= 2;
    }
    current
}

fn compile_shard(
    shard_index: usize,
    count: i64,
    entries_root: [u8; 32],
    address_root: [u8; 32],
    pending_hash: [u8; 32],
) -> SilAbiArtifact {
    compile_to_sil_abi_artifact_with_options(
        SHARD_SOURCE,
        &[
            ArtifactValue::Bytes([0x42; 32].to_vec()),
            ArtifactValue::Int(CLOSES_AT_DAA as i64),
            ArtifactValue::Int(FAMILY_SIZE as i64),
            ArtifactValue::Int(SHARD_COUNT as i64),
            ArtifactValue::Int(TREE_DEPTH as i64),
            ArtifactValue::Int(MAX_ENTRIES),
            ArtifactValue::Int(ENTRY_FEE as i64),
            ArtifactValue::Int(shard_index as i64),
            ArtifactValue::Int(count),
            ArtifactValue::Bytes(entries_root.to_vec()),
            ArtifactValue::Bytes(address_root.to_vec()),
            ArtifactValue::Bytes(pending_hash.to_vec()),
        ],
        CompileOptions::default(),
    )
    .expect("entry shard compiles")
}

fn shard_template() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let entry_root = empty_levels(TREE_DEPTH, 0x00, 0x02)[TREE_DEPTH];
    let address_root = empty_levels(256, 0x10, 0x12)[256];
    compiled_template_parts_and_hash(&compile_shard(0, 0, entry_root, address_root, zero()))
}

fn compile_prize(phase: i64, frozen_root: [u8; 32], count: i64) -> SilAbiArtifact {
    let entries_root = empty_levels(TREE_DEPTH, 0x00, 0x02)[TREE_DEPTH];
    let address_root = empty_levels(256, 0x10, 0x12)[256];
    let (prefix, suffix, template) = shard_template();
    compile_to_sil_abi_artifact_with_options(
        PRIZE_SOURCE,
        &[
            ArtifactValue::Bytes([0x42; 32].to_vec()),
            ArtifactValue::Int(CLOSES_AT_DAA as i64),
            ArtifactValue::Int(FAMILY_SIZE as i64),
            ArtifactValue::Int(SHARD_COUNT as i64),
            ArtifactValue::Int(TREE_DEPTH as i64),
            ArtifactValue::Int(MAX_ENTRIES),
            ArtifactValue::Int(PRIZE_VALUE as i64),
            ArtifactValue::Int(SHARD_VALUE as i64),
            ArtifactValue::Int(ENTRY_FEE as i64),
            ArtifactValue::Int(ACTIVATION_FEE as i64),
            ArtifactValue::Int(FREEZE_FEE as i64),
            ArtifactValue::Int(DRAW_FEE as i64),
            ArtifactValue::Int(RETURN_FEE as i64),
            ArtifactValue::Int(RETURN_AT_DAA as i64),
            ArtifactValue::Int(150),
            ArtifactValue::Bytes([0x55; 32].to_vec()),
            ArtifactValue::Bytes(spk_bytes(&return_spk())),
            ArtifactValue::Bytes(entries_root.to_vec()),
            ArtifactValue::Bytes(address_root.to_vec()),
            ArtifactValue::Bytes(template),
            ArtifactValue::Int(prefix.len() as i64),
            ArtifactValue::Int(suffix.len() as i64),
            ArtifactValue::Int(phase),
            ArtifactValue::Bytes(frozen_root.to_vec()),
            ArtifactValue::Int(count),
        ],
        CompileOptions::default(),
    )
    .expect("sharded prize state compiles")
}

fn return_spk() -> ScriptPublicKey {
    ScriptPublicKey::from_vec(0, vec![0x51])
}

fn spk_bytes(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut bytes = spk.version().to_be_bytes().to_vec();
    bytes.extend_from_slice(spk.script());
    bytes
}

fn sigscript(artifact: &SilAbiArtifact, entry: &str, args: &[ArtifactValue]) -> Vec<u8> {
    let mut sigscript = encode_entry_sig_script(artifact, entry, args).expect("entry sigscript builds");
    sigscript.extend_from_slice(&push_redeem_script(&bytecode(artifact)));
    sigscript
}

fn output(artifact: &SilAbiArtifact, value: u64, authorizing_input: u16) -> TransactionOutput {
    TransactionOutput {
        value,
        script_public_key: pay_to_script_hash_script(&bytecode(artifact)),
        covenant: Some(CovenantBinding { authorizing_input, covenant_id: COV_A }),
    }
}

fn utxo(artifact: &SilAbiArtifact, value: u64, daa_score: u64) -> UtxoEntry {
    UtxoEntry::new(value, pay_to_script_hash_script(&bytecode(artifact)), daa_score, false, Some(COV_A))
}

fn measured_script_units(tx: &Transaction, entries: &[UtxoEntry], input_index: usize) -> ScriptUnits {
    let reused_values = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(tx, entries.to_vec());
    let covenants = CovenantsContext::from_tx(&populated).expect("covenant context builds");
    let input = &tx.inputs[input_index];
    let utxo = populated.utxo(input_index).expect("selected input UTXO");
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        input,
        input_index,
        utxo,
        EngineCtx::new(&sig_cache).with_reused(&reused_values).with_covenants_ctx(&covenants),
        EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
    );
    vm.execute().expect("input executes while measuring its script units");
    vm.used_script_units()
}

fn with_exact_compute_budgets(mut tx: Transaction, entries: &[UtxoEntry]) -> Transaction {
    let budgets: Vec<_> = (0..tx.inputs.len())
        .map(|input_index| {
            ComputeBudget::checked_covering_script_units(measured_script_units(&tx, entries, input_index))
                .expect("input script units fit a Toccata compute budget")
        })
        .collect();
    for (input, budget) in tx.inputs.iter_mut().zip(budgets) {
        input.compute_commit = budget.into();
    }
    tx
}

fn assert_post_toccata_non_contextual_mass(label: &str, tx: &Transaction) -> (u64, u64) {
    let masses = MassCalculator::new_with_consensus_params(&MAINNET_PARAMS).calc_non_contextual_masses(tx);
    let limits = MAINNET_PARAMS.block_mass_limits().after();
    assert!(masses.compute_mass <= limits.compute, "{label} compute mass {} exceeds {}", masses.compute_mass, limits.compute);
    assert!(
        masses.transient_mass <= limits.transient,
        "{label} transient mass {} exceeds {}",
        masses.transient_mass,
        limits.transient
    );
    eprintln!("{label}: compute_mass={}, transient_mass={}", masses.compute_mass, masses.transient_mass);
    (masses.compute_mass, masses.transient_mass)
}

fn sibling_arg(siblings: &[[u8; 32]]) -> ArtifactValue {
    ArtifactValue::Array(siblings.iter().map(|sibling| ArtifactValue::Bytes(sibling.to_vec())).collect())
}

fn aggregate_shard(previous: [u8; 32], shard_index: u64, count: u64, entries_root: [u8; 32], address_root: [u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::from(previous);
    preimage.extend_from_slice(&shard_index.to_le_bytes());
    preimage.extend_from_slice(&count.to_le_bytes());
    preimage.extend_from_slice(&entries_root);
    preimage.extend_from_slice(&address_root);
    sha256(&preimage)
}

#[test]
fn activation_creates_only_the_exact_empty_shard_family() {
    let bootstrap = compile_prize(0, zero(), 0);
    let open = compile_prize(1, zero(), 0);
    let entries_root = empty_levels(TREE_DEPTH, 0x00, 0x02)[TREE_DEPTH];
    let address_root = empty_levels(256, 0x10, 0x12)[256];
    let shards: Vec<_> = (0..SHARD_COUNT).map(|index| compile_shard(index, 0, entries_root, address_root, zero())).collect();
    let (prefix, suffix, _) = shard_template();
    let input = tx_input(0, sigscript(&bootstrap, "activate", &[ArtifactValue::Bytes(prefix), ArtifactValue::Bytes(suffix)]));
    let tx = Transaction::new(
        1,
        vec![input],
        vec![
            output(&open, PRIZE_VALUE, 0),
            output(&shards[0], SHARD_VALUE, 0),
            output(&shards[1], SHARD_VALUE, 0),
            output(&shards[2], SHARD_VALUE, 0),
            output(&shards[3], SHARD_VALUE, 0),
        ],
        0,
        Default::default(),
        0,
        vec![],
    );
    let input_value = PRIZE_VALUE + SHARD_COUNT as u64 * SHARD_VALUE + ACTIVATION_FEE;
    let entries = vec![utxo(&bootstrap, input_value, 1)];
    let tx = with_exact_compute_budgets(tx, &entries);
    assert!(tx.inputs[0].signature_script.len() < 225_000);
    assert_post_toccata_non_contextual_mass("activation", &tx);
    execute_input_with_covenants(tx, entries, 0).expect("exact sharded activation passes");
}

fn freeze_case(pending_daa: u64) -> (Transaction, Vec<UtxoEntry>, i64) {
    let commitment = sha256(&[0x31; 34]);
    let entry_levels = empty_levels(TREE_DEPTH, 0x00, 0x02);
    let entries_root = entry_levels[TREE_DEPTH];
    let entry_siblings = entry_levels[..TREE_DEPTH].to_vec();
    let finalized_root = update_root(leaf(0x01, commitment), 0, &entry_siblings, 0x02);
    let empty_address_root = empty_levels(256, 0x10, 0x12)[256];
    let address_root_with_pending = [0x77; 32];
    let shard0 = compile_shard(0, 0, entries_root, address_root_with_pending, commitment);
    let empty_shards: Vec<_> =
        (1..SHARD_COUNT).map(|index| compile_shard(index, 0, entries_root, empty_address_root, zero())).collect();
    let on_time = pending_daa <= CLOSES_AT_DAA;
    let shard0_root = if on_time { finalized_root } else { entries_root };
    let shard0_count = u64::from(on_time);
    let aggregate0 = aggregate_shard(sha256(&[]), 0, shard0_count, shard0_root, address_root_with_pending);
    let mut aggregate = aggregate0;
    for index in 1..SHARD_COUNT {
        aggregate = aggregate_shard(aggregate, index as u64, 0, entries_root, empty_address_root);
    }
    let total_count = shard0_count as i64;
    let open = compile_prize(1, zero(), 0);
    let frozen = compile_prize(2, aggregate, total_count);
    let mut flat_siblings = entry_siblings.clone();
    for _ in 1..SHARD_COUNT {
        flat_siblings.extend_from_slice(&entry_siblings);
    }
    let mut inputs = vec![
        tx_input(0, sigscript(&open, "freeze", &[sibling_arg(&flat_siblings)])),
        tx_input(1, sigscript(&shard0, "delegateFreeze", &[])),
    ];
    for (offset, shard) in empty_shards.iter().enumerate() {
        inputs.push(tx_input((offset + 2) as u32, sigscript(shard, "delegateFreeze", &[])));
    }
    let total_value = PRIZE_VALUE + SHARD_COUNT as u64 * SHARD_VALUE;
    let tx =
        Transaction::new(1, inputs, vec![output(&frozen, total_value - FREEZE_FEE, 0)], CLOSES_AT_DAA, Default::default(), 0, vec![]);
    let mut entries = vec![utxo(&open, PRIZE_VALUE, 5), utxo(&shard0, SHARD_VALUE, pending_daa)];
    entries.extend(empty_shards.iter().map(|shard| utxo(shard, SHARD_VALUE, 10)));
    (tx, entries, total_count)
}

#[test]
fn freeze_finalizes_an_on_time_pending_entry_and_every_delegate_accepts() {
    let (tx, entries, count) = freeze_case(CLOSES_AT_DAA);
    assert_eq!(count, 1);
    let tx = with_exact_compute_budgets(tx, &entries);
    let signature_bytes: usize = tx.inputs.iter().map(|input| input.signature_script.len()).sum();
    assert!(signature_bytes < 225_000);
    assert_post_toccata_non_contextual_mass("freeze", &tx);
    for input_index in 0..FAMILY_SIZE {
        execute_input_with_covenants(tx.clone(), entries.clone(), input_index)
            .unwrap_or_else(|err| panic!("sharded family input {input_index} failed: {err}"));
    }
}

#[test]
fn freeze_excludes_a_late_pending_entry_and_rejects_a_missing_shard() {
    let (tx, entries, count) = freeze_case(CLOSES_AT_DAA + 1);
    assert_eq!(count, 0);
    execute_input_with_covenants(tx.clone(), entries.clone(), 0)
        .expect("late pending commitment is excluded from the frozen count and root");

    let mut missing_tx = tx;
    missing_tx.inputs.pop();
    let mut missing_entries = entries;
    missing_entries.pop();
    execute_input_with_covenants(missing_tx, missing_entries, 0).expect_err("the Prize State cannot freeze without every shard");
}

#[test]
fn freeze_rejects_a_transaction_before_the_committed_close() {
    let (mut tx, entries, _) = freeze_case(CLOSES_AT_DAA);
    tx.lock_time = CLOSES_AT_DAA - 1;
    execute_input_with_covenants(tx, entries, 0).expect_err("the complete family cannot be frozen before closesAtDaa");
}

fn return_tx(frozen: &SilAbiArtifact, lock_time: u64) -> (Transaction, Vec<UtxoEntry>) {
    let input_value = PRIZE_VALUE + SHARD_COUNT as u64 * SHARD_VALUE - FREEZE_FEE;
    let tx = Transaction::new(
        1,
        vec![tx_input(0, sigscript(frozen, "returnFunds", &[]))],
        vec![TransactionOutput { value: input_value - RETURN_FEE, script_public_key: return_spk(), covenant: None }],
        lock_time,
        Default::default(),
        0,
        vec![],
    );
    (tx, vec![utxo(frozen, input_value, CLOSES_AT_DAA)])
}

#[test]
fn empty_frozen_giveaway_returns_keylessly_at_close() {
    let frozen = compile_prize(2, [0x44; 32], 0);
    let (tx, entries) = return_tx(&frozen, CLOSES_AT_DAA);
    execute_input_with_covenants(tx, entries, 0).expect("an empty frozen giveaway returns to the committed script at close");
}

#[test]
fn non_empty_frozen_giveaway_uses_the_fallback_deadline() {
    let frozen = compile_prize(2, [0x44; 32], 1);
    let (early, early_entries) = return_tx(&frozen, RETURN_AT_DAA - 1);
    execute_input_with_covenants(early, early_entries, 0)
        .expect_err("a non-empty giveaway cannot return before its fallback deadline");

    let (mature, mature_entries) = return_tx(&frozen, RETURN_AT_DAA);
    execute_input_with_covenants(mature, mature_entries, 0)
        .expect("anyone can broadcast the exact return after the fallback deadline");
}

#[test]
fn prize_script_and_realistic_draw_witness_fit_toccata_bounds() {
    let frozen = compile_prize(2, [0x44; 32], 1);
    let counts =
        ArtifactValue::Array(vec![ArtifactValue::Int(1), ArtifactValue::Int(0), ArtifactValue::Int(0), ArtifactValue::Int(0)]);
    let roots = ArtifactValue::Array((0..SHARD_COUNT).map(|index| ArtifactValue::Bytes([0x11 + index as u8; 32].to_vec())).collect());
    let addresses =
        ArtifactValue::Array((0..SHARD_COUNT).map(|index| ArtifactValue::Bytes([0x33 + index as u8; 32].to_vec())).collect());
    let siblings = ArtifactValue::Array((0..TREE_DEPTH).map(|_| ArtifactValue::Bytes([0x55; 32].to_vec())).collect());
    let witness = sigscript(
        &frozen,
        "draw",
        &[
            ArtifactValue::Bytes(vec![0x66; 256]),
            ArtifactValue::Bytes([0x77; 32].to_vec()),
            ArtifactValue::Int(149),
            ArtifactValue::Bytes([0x88; 32].to_vec()),
            ArtifactValue::Int(150),
            counts,
            roots,
            addresses,
            ArtifactValue::Bytes(vec![0x00, 0x00, 0x51]),
            siblings,
        ],
    );

    assert!(bytecode(&frozen).len() < 1_000_000);
    assert!(witness.len() < 250_000);
}
