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
    Hash,
    config::params::MAINNET_PARAMS,
    hashing,
    hashing::sighash::SigHashReusedValuesUnsync,
    mass::{ComputeBudget, MassCalculator, ScriptUnits},
    tx::{CovenantBinding, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionOutput, UtxoEntry, VerifiableTransaction},
};
use kaspa_txscript::{
    EngineCtx, EngineFlags, SeqCommitAccessor, TxScriptEngine, caches::Cache, covenants::CovenantsContext, pay_to_script_hash_script,
};
use risc0_zkvm::{Groth16Receipt, ReceiptClaim};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use silverscript_abi::{ArtifactValue, SilAbiArtifact};
use silverscript_lang::compiler::{CompileOptions, compile_to_sil_abi_artifact_with_options};
use std::collections::{BTreeMap, BTreeSet};

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
const ENTROPY_TARGET_BLUE_SCORE: u64 = 559_181_995;
const ENTROPY_IMAGE_ID: [u8; 32] = [
    0xa4, 0x02, 0xf8, 0x8f, 0x9b, 0x89, 0xaf, 0xd2, 0xeb, 0x5e, 0x5f, 0x6c, 0xdc, 0x96, 0xf6, 0x7a, 0xf2, 0xff, 0x4d, 0x4d, 0xa7,
    0x0e, 0x1e, 0x6a, 0x47, 0x67, 0xa9, 0x9c, 0x26, 0xb6, 0x92, 0xb1,
];
const PARENT_BLOCK_HASH: [u8; 32] = [
    0x49, 0xc3, 0x62, 0x90, 0x73, 0x57, 0xef, 0x61, 0xe3, 0xee, 0xb4, 0xa0, 0xfc, 0xf7, 0xca, 0xe6, 0xb7, 0xdc, 0x05, 0xa0, 0x4b,
    0x56, 0x6e, 0xc0, 0xa1, 0xfa, 0xe9, 0x17, 0xab, 0x4b, 0xe2, 0xd1,
];
const CANDIDATE_BLOCK_HASH: [u8; 32] = [
    0x6f, 0x47, 0xbd, 0x29, 0xcc, 0xfd, 0x40, 0x17, 0x57, 0xa8, 0x5f, 0xf3, 0x60, 0xdc, 0x70, 0x76, 0xc8, 0xe4, 0xb1, 0x67, 0xae,
    0x4b, 0x3c, 0xcb, 0xee, 0xc7, 0x55, 0x00, 0x28, 0xc0, 0xe5, 0x2b,
];
const PARENT_SEQ_COMMIT: [u8; 32] = [
    0x30, 0x97, 0xc0, 0x5f, 0xdb, 0x89, 0xce, 0xfd, 0x0b, 0x53, 0x0d, 0xb2, 0x27, 0xc5, 0x23, 0x8f, 0xaf, 0x31, 0x6e, 0xd0, 0x75,
    0xa4, 0x3e, 0xcb, 0x0f, 0x36, 0xee, 0x12, 0xf8, 0x35, 0x8f, 0x02,
];
const CANDIDATE_SEQ_COMMIT: [u8; 32] = [
    0xbf, 0x3b, 0x86, 0x31, 0xa0, 0xd0, 0x2e, 0x1a, 0x85, 0xdf, 0xf2, 0x28, 0x1e, 0x5d, 0xde, 0x75, 0xa5, 0x92, 0x2e, 0x3d, 0x37,
    0x6e, 0xef, 0x57, 0xf2, 0x41, 0x21, 0x00, 0xd5, 0xeb, 0x9e, 0xa1,
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParticipantFixture {
    giveaway_id: String,
    tree_depth: usize,
    shards: Vec<Vec<String>>,
}

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

fn decode_hex(value: &str) -> Vec<u8> {
    assert!(value.len() % 2 == 0);
    value.as_bytes().chunks_exact(2).map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap()).collect()
}

fn participant_fixture() -> ([u8; 32], Vec<Vec<Vec<u8>>>) {
    let fixture: ParticipantFixture =
        serde_json::from_str(include_str!("fixtures/giveaway_v6_participants.json")).expect("participant fixture decodes");
    assert_eq!(fixture.tree_depth, TREE_DEPTH);
    let giveaway_id = decode_hex(&fixture.giveaway_id).try_into().expect("giveaway ID has 32 bytes");
    let shards = fixture.shards.iter().map(|shard| shard.iter().map(|script| decode_hex(script)).collect()).collect();
    (giveaway_id, shards)
}

fn entry_root_and_proof(commitments: &[[u8; 32]], winner_index: usize) -> ([u8; 32], Vec<[u8; 32]>) {
    let empty_leaf = leaf(0x00, zero());
    let mut level: Vec<_> = commitments
        .iter()
        .map(|commitment| leaf(0x01, *commitment))
        .chain(std::iter::repeat(empty_leaf))
        .take(1usize << TREE_DEPTH)
        .collect();
    let mut position = winner_index;
    let mut siblings = Vec::with_capacity(TREE_DEPTH);
    for _ in 0..TREE_DEPTH {
        siblings.push(level[position ^ 1]);
        position /= 2;
        level = level.chunks_exact(2).map(|pair| node(0x02, pair[0], pair[1])).collect();
    }
    (level[0], siblings)
}

fn entry_root(commitments: &[[u8; 32]]) -> [u8; 32] {
    entry_root_and_proof(commitments, 0).0
}

fn shift_right(mut value: [u8; 32]) -> [u8; 32] {
    let mut carry = 0u8;
    for byte in value.iter_mut().rev() {
        let next_carry = *byte & 1;
        *byte = (*byte >> 1) | (carry << 7);
        carry = next_carry;
    }
    value
}

fn address_root(commitments: &[[u8; 32]]) -> [u8; 32] {
    let mut empty = vec![leaf(0x10, zero())];
    for level in 0..256 {
        empty.push(node(0x12, empty[level], empty[level]));
    }
    let mut nodes: BTreeMap<[u8; 32], [u8; 32]> =
        commitments.iter().map(|commitment| (*commitment, leaf(0x11, *commitment))).collect();
    for level in 0..256 {
        let mut parents = BTreeMap::new();
        let mut visited = BTreeSet::new();
        for (position, hash) in &nodes {
            if !visited.insert(*position) {
                continue;
            }
            let mut sibling_position = *position;
            sibling_position[0] ^= 1;
            visited.insert(sibling_position);
            let sibling = nodes.get(&sibling_position).copied().unwrap_or(empty[level]);
            let parent = if position[0] & 1 == 0 { node(0x12, *hash, sibling) } else { node(0x12, sibling, *hash) };
            parents.insert(shift_right(*position), parent);
        }
        nodes = parents;
    }
    nodes.values().next().copied().unwrap_or(empty[256])
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
            ArtifactValue::Int(ENTROPY_TARGET_BLUE_SCORE as i64),
            ArtifactValue::Bytes(ENTROPY_IMAGE_ID.to_vec()),
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

fn unbound_output(artifact: &SilAbiArtifact, value: u64) -> TransactionOutput {
    TransactionOutput { value, script_public_key: pay_to_script_hash_script(&bytecode(artifact)), covenant: None }
}

fn utxo(artifact: &SilAbiArtifact, value: u64, daa_score: u64) -> UtxoEntry {
    UtxoEntry::new(value, pay_to_script_hash_script(&bytecode(artifact)), daa_score, false, Some(COV_A))
}

fn bootstrap_utxo(artifact: &SilAbiArtifact, value: u64, daa_score: u64) -> UtxoEntry {
    UtxoEntry::new(value, pay_to_script_hash_script(&bytecode(artifact)), daa_score, false, None)
}

fn measured_script_units(
    tx: &Transaction,
    entries: &[UtxoEntry],
    input_index: usize,
    seq_commit_accessor: Option<&dyn SeqCommitAccessor>,
) -> ScriptUnits {
    let reused_values = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(tx, entries.to_vec());
    let covenants = CovenantsContext::from_tx(&populated).expect("covenant context builds");
    let input = &tx.inputs[input_index];
    let utxo = populated.utxo(input_index).expect("selected input UTXO");
    let mut ctx = EngineCtx::new(&sig_cache).with_reused(&reused_values).with_covenants_ctx(&covenants);
    if let Some(accessor) = seq_commit_accessor {
        ctx = ctx.with_seq_commit_accessor(accessor);
    }
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        input,
        input_index,
        utxo,
        ctx,
        EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
    );
    vm.execute().expect("input executes while measuring its script units");
    vm.used_script_units()
}

fn with_exact_compute_budgets(mut tx: Transaction, entries: &[UtxoEntry]) -> Transaction {
    let budgets: Vec<_> = (0..tx.inputs.len())
        .map(|input_index| {
            ComputeBudget::checked_covering_script_units(measured_script_units(&tx, entries, input_index, None))
                .expect("input script units fit a Toccata compute budget")
        })
        .collect();
    for (input, budget) in tx.inputs.iter_mut().zip(budgets) {
        input.compute_commit = budget.into();
    }
    tx
}

fn with_exact_compute_budgets_and_seqcommit(
    mut tx: Transaction,
    entries: &[UtxoEntry],
    accessor: &dyn SeqCommitAccessor,
) -> Transaction {
    let budgets: Vec<_> = (0..tx.inputs.len())
        .map(|input_index| {
            ComputeBudget::checked_covering_script_units(measured_script_units(&tx, entries, input_index, Some(accessor)))
                .expect("input script units fit a Toccata compute budget")
        })
        .collect();
    for (input, budget) in tx.inputs.iter_mut().zip(budgets) {
        input.compute_commit = budget.into();
    }
    tx
}

struct MockChain {
    parent_commitment: Hash,
    candidate_commitment: Hash,
}

impl SeqCommitAccessor for MockChain {
    fn is_chain_ancestor_from_pov(&self, block_hash: Hash) -> Option<bool> {
        Some(block_hash == Hash::from_bytes(PARENT_BLOCK_HASH) || block_hash == Hash::from_bytes(CANDIDATE_BLOCK_HASH))
    }

    fn seq_commitment_within_depth(&self, block_hash: Hash) -> Option<Hash> {
        if block_hash == Hash::from_bytes(PARENT_BLOCK_HASH) {
            Some(self.parent_commitment)
        } else if block_hash == Hash::from_bytes(CANDIDATE_BLOCK_HASH) {
            Some(self.candidate_commitment)
        } else {
            None
        }
    }
}

fn execute_input_with_seqcommit(
    tx: Transaction,
    entries: Vec<UtxoEntry>,
    input_index: usize,
    accessor: &dyn SeqCommitAccessor,
) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let reused_values = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(&tx, entries);
    let covenants = CovenantsContext::from_tx(&populated).map_err(kaspa_txscript_errors::TxScriptError::from)?;
    let input = &tx.inputs[input_index];
    let utxo = populated.utxo(input_index).expect("selected input UTXO");
    let ctx = EngineCtx::new(&sig_cache).with_reused(&reused_values).with_covenants_ctx(&covenants).with_seq_commit_accessor(accessor);
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        input,
        input_index,
        utxo,
        ctx,
        EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
    );
    vm.execute()
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
    let mut outputs = vec![
        unbound_output(&open, PRIZE_VALUE),
        unbound_output(&shards[0], SHARD_VALUE),
        unbound_output(&shards[1], SHARD_VALUE),
        unbound_output(&shards[2], SHARD_VALUE),
        unbound_output(&shards[3], SHARD_VALUE),
    ];
    let covenant_id = hashing::covenant_id::covenant_id(
        input.previous_outpoint,
        outputs.iter().enumerate().map(|(index, output)| (index as u32, output)),
    );
    for output in &mut outputs {
        output.covenant = Some(CovenantBinding { authorizing_input: 0, covenant_id });
    }
    let tx = Transaction::new(
        1,
        vec![input],
        outputs,
        0,
        Default::default(),
        0,
        vec![],
    );
    let input_value = PRIZE_VALUE + SHARD_COUNT as u64 * SHARD_VALUE + ACTIVATION_FEE;
    let entries = vec![bootstrap_utxo(&bootstrap, input_value, 1)];
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
fn proof_bound_draw_pays_the_on_chain_winner() {
    let (giveaway_id, shards) = participant_fixture();
    assert_eq!(giveaway_id, [0x42; 32]);
    assert_eq!(shards.len(), SHARD_COUNT);
    let commitments: Vec<Vec<[u8; 32]>> = shards
        .iter()
        .enumerate()
        .map(|(shard_index, scripts)| {
            scripts
                .iter()
                .map(|script| {
                    let commitment = sha256(script);
                    assert_eq!(commitment[0] as usize % SHARD_COUNT, shard_index);
                    commitment
                })
                .collect()
        })
        .collect();
    let shard_counts: [u64; SHARD_COUNT] = shards.iter().map(|shard| shard.len() as u64).collect::<Vec<_>>().try_into().unwrap();
    let shard_entries_roots: [[u8; 32]; SHARD_COUNT] =
        commitments.iter().map(|shard| entry_root(shard)).collect::<Vec<_>>().try_into().unwrap();
    let shard_address_roots: [[u8; 32]; SHARD_COUNT] =
        commitments.iter().map(|shard| address_root(shard)).collect::<Vec<_>>().try_into().unwrap();

    let mut frozen_root = sha256(&[]);
    for index in 0..SHARD_COUNT {
        frozen_root =
            aggregate_shard(frozen_root, index as u64, shard_counts[index], shard_entries_roots[index], shard_address_roots[index]);
    }
    let expected_frozen_root: [u8; 32] =
        decode_hex("a8780ddf4e63d1779828849df0c56c67703f0a29ebe0df70b233eebb05149f10").try_into().unwrap();
    assert_eq!(frozen_root, expected_frozen_root);

    let mut draw_preimage = vec![0x61];
    draw_preimage.extend_from_slice(&giveaway_id);
    draw_preimage.extend_from_slice(&frozen_root);
    draw_preimage.extend_from_slice(&CANDIDATE_BLOCK_HASH);
    draw_preimage.extend_from_slice(&CANDIDATE_SEQ_COMMIT);
    let draw_digest = sha256(&draw_preimage);
    let global_index = u32::from_le_bytes(draw_digest[..4].try_into().unwrap()) as usize % 12;
    assert_eq!(global_index, 5);
    let winner_shard = 1;
    let winner_local_index = 2;
    let winner_spk_bytes = shards[winner_shard][winner_local_index].clone();
    let winner_spk =
        ScriptPublicKey::from_vec(u16::from_be_bytes(winner_spk_bytes[..2].try_into().unwrap()), winner_spk_bytes[2..].to_vec());
    let (winner_root, winner_siblings) = entry_root_and_proof(&commitments[winner_shard], winner_local_index);
    assert_eq!(winner_root, shard_entries_roots[winner_shard]);

    let receipt: Groth16Receipt<ReceiptClaim> =
        borsh::from_slice(include_bytes!("fixtures/giveaway_entropy_v6_mainnet_groth16.rcpt")).expect("Groth16 fixture decodes");
    receipt.verify_integrity().expect("Groth16 fixture verifies");
    let proof = kaspa_txscript_zk_sdk::prepare_r0_groth16_proof(&receipt).expect("compact TxScript proof encodes");

    let frozen = compile_prize(2, frozen_root, 12);
    let input_value = PRIZE_VALUE + SHARD_COUNT as u64 * SHARD_VALUE - FREEZE_FEE;
    let args = [
        ArtifactValue::Bytes(proof),
        ArtifactValue::Bytes(PARENT_BLOCK_HASH.to_vec()),
        ArtifactValue::Int(559_181_983),
        ArtifactValue::Bytes(CANDIDATE_BLOCK_HASH.to_vec()),
        ArtifactValue::Int(559_181_995),
        ArtifactValue::Array(shard_counts.into_iter().map(|count| ArtifactValue::Int(count as i64)).collect()),
        ArtifactValue::Array(shard_entries_roots.into_iter().map(|root| ArtifactValue::Bytes(root.to_vec())).collect()),
        ArtifactValue::Array(shard_address_roots.into_iter().map(|root| ArtifactValue::Bytes(root.to_vec())).collect()),
        ArtifactValue::Bytes(winner_spk_bytes),
        sibling_arg(&winner_siblings),
    ];
    let tx = Transaction::new(
        1,
        vec![tx_input(0, sigscript(&frozen, "draw", &args))],
        vec![
            TransactionOutput { value: PRIZE_VALUE, script_public_key: winner_spk, covenant: None },
            TransactionOutput { value: input_value - PRIZE_VALUE - DRAW_FEE, script_public_key: return_spk(), covenant: None },
        ],
        0,
        Default::default(),
        0,
        vec![],
    );
    let entries = vec![utxo(&frozen, input_value, CLOSES_AT_DAA)];
    let chain = MockChain {
        parent_commitment: Hash::from_bytes(PARENT_SEQ_COMMIT),
        candidate_commitment: Hash::from_bytes(CANDIDATE_SEQ_COMMIT),
    };
    let tx = with_exact_compute_budgets_and_seqcommit(tx, &entries, &chain);
    assert_post_toccata_non_contextual_mass("proof-bound draw", &tx);
    execute_input_with_seqcommit(tx.clone(), entries.clone(), 0, &chain).expect("proof-bound draw passes");

    let mut redirected_tx = tx.clone();
    redirected_tx.outputs[0].script_public_key = ScriptPublicKey::from_vec(0, vec![0x52]);
    execute_input_with_seqcommit(redirected_tx, entries.clone(), 0, &chain)
        .expect_err("the proof cannot redirect the prize to another script");

    let wrong_chain =
        MockChain { parent_commitment: Hash::from_bytes(PARENT_SEQ_COMMIT), candidate_commitment: Hash::from_bytes([25; 32]) };
    execute_input_with_seqcommit(tx, entries, 0, &wrong_chain)
        .expect_err("the same proof cannot authorize a different on-chain sequence commitment");
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
