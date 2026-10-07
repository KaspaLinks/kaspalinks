// TxScript engine tests for the capital-efficient Giveaway V6 entry shard.
//
// Usage: copy this file and `giveaway_entry_shard_v6.sil` to
// `silverscript-lang/tests/`, then run:
//   cargo test -p silverscript-lang --test giveaway_entry_shard_v6_tests

mod common;

use common::{COV_A, bytecode, encode_entry_sig_script, execute_input_with_covenants, push_redeem_script, tx_input};
use kaspa_consensus_core::{
    config::params::MAINNET_PARAMS,
    hashing::sighash::SigHashReusedValuesUnsync,
    mass::{ComputeBudget, MassCalculator, ScriptUnits},
    tx::{CovenantBinding, PopulatedTransaction, Transaction, TransactionOutput, UtxoEntry, VerifiableTransaction},
};
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, caches::Cache, covenants::CovenantsContext, pay_to_script_hash_script};
use sha2::{Digest, Sha256};
use silverscript_abi::{ArtifactValue, SilAbiArtifact};
use silverscript_lang::compiler::{CompileOptions, compile_to_sil_abi_artifact_with_options};

const SOURCE: &str = include_str!("giveaway_entry_shard_v6.sil");
const FAMILY_SIZE: i64 = 5;
const SHARD_COUNT: i64 = 4;
const CLOSES_AT_DAA: u64 = 100;
const TREE_DEPTH: usize = 4;
const MAX_ENTRIES: i64 = 16;
const ENTRY_FEE: u64 = 50;
const SHARD_VALUE: u64 = 2_000;

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
    let mut levels = vec![leaf(leaf_domain, [0; 32])];
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

fn update_address_root(mut current: [u8; 32], commitment: [u8; 32], siblings: &[[u8; 32]]) -> [u8; 32] {
    for (index, sibling) in siblings.iter().enumerate() {
        let path_bit = (commitment[index / 8] >> (index % 8)) & 1;
        current = if path_bit == 0 { node(0x12, current, *sibling) } else { node(0x12, *sibling, current) };
    }
    current
}

fn compile_shard(
    shard_index: i64,
    count: i64,
    entries_root: [u8; 32],
    address_root: [u8; 32],
    pending_hash: [u8; 32],
) -> SilAbiArtifact {
    compile_to_sil_abi_artifact_with_options(
        SOURCE,
        &[
            ArtifactValue::Bytes([0x42; 32].to_vec()),
            ArtifactValue::Int(CLOSES_AT_DAA as i64),
            ArtifactValue::Int(FAMILY_SIZE),
            ArtifactValue::Int(SHARD_COUNT),
            ArtifactValue::Int(TREE_DEPTH as i64),
            ArtifactValue::Int(MAX_ENTRIES),
            ArtifactValue::Int(ENTRY_FEE as i64),
            ArtifactValue::Int(shard_index),
            ArtifactValue::Int(count),
            ArtifactValue::Bytes(entries_root.to_vec()),
            ArtifactValue::Bytes(address_root.to_vec()),
            ArtifactValue::Bytes(pending_hash.to_vec()),
        ],
        CompileOptions::default(),
    )
    .expect("entry shard compiles")
}

fn sigscript(artifact: &SilAbiArtifact, args: &[ArtifactValue]) -> Vec<u8> {
    let mut sigscript = encode_entry_sig_script(artifact, "register", args).expect("register sigscript builds");
    sigscript.extend_from_slice(&push_redeem_script(&bytecode(artifact)));
    sigscript
}

fn artifact_siblings(siblings: &[[u8; 32]]) -> ArtifactValue {
    ArtifactValue::Array(siblings.iter().map(|sibling| ArtifactValue::Bytes(sibling.to_vec())).collect())
}

fn winner_for_shard(shard_index: u8) -> Vec<u8> {
    winner_for_shard_from(shard_index, 0)
}

fn winner_for_shard_from(shard_index: u8, start: u16) -> Vec<u8> {
    for marker in start..=u16::MAX {
        let winner_spk = marker.to_le_bytes().repeat(17);
        if sha256(&winner_spk)[0] % SHARD_COUNT as u8 == shard_index {
            return winner_spk;
        }
    }
    unreachable!("every shard should have a short test fixture")
}

struct RegistrationFixture {
    active: SilAbiArtifact,
    successor: SilAbiArtifact,
    winner_spk: Vec<u8>,
    append_siblings: Vec<[u8; 32]>,
    address_siblings: Vec<[u8; 32]>,
    entries_root_before: [u8; 32],
    finalized_entry_root: [u8; 32],
    address_root_after: [u8; 32],
    commitment: [u8; 32],
}

fn first_registration(shard_index: u8) -> RegistrationFixture {
    let winner_spk = winner_for_shard(shard_index);
    let commitment = sha256(&winner_spk);
    let entry_levels = empty_levels(TREE_DEPTH, 0x00, 0x02);
    let address_levels = empty_levels(256, 0x10, 0x12);
    let append_siblings = entry_levels[..TREE_DEPTH].to_vec();
    let address_siblings = address_levels[..256].to_vec();
    let entries_root_before = entry_levels[TREE_DEPTH];
    let address_root_before = address_levels[256];
    let finalized_entry_root = update_root(leaf(0x01, commitment), 0, &append_siblings, 0x02);
    let address_root_after = update_address_root(leaf(0x11, commitment), commitment, &address_siblings);
    RegistrationFixture {
        active: compile_shard(shard_index as i64, 0, entries_root_before, address_root_before, [0; 32]),
        successor: compile_shard(shard_index as i64, 0, entries_root_before, address_root_after, commitment),
        winner_spk,
        append_siblings,
        address_siblings,
        entries_root_before,
        finalized_entry_root,
        address_root_after,
        commitment,
    }
}

fn registration_case(
    active: &SilAbiArtifact,
    successor: &SilAbiArtifact,
    winner_spk: Vec<u8>,
    append_siblings: &[[u8; 32]],
    address_siblings: &[[u8; 32]],
    daa_score: u64,
) -> (Transaction, Vec<UtxoEntry>) {
    let args = [ArtifactValue::Bytes(winner_spk), artifact_siblings(append_siblings), artifact_siblings(address_siblings)];
    let input = tx_input(0, sigscript(active, &args));
    let output = TransactionOutput {
        value: SHARD_VALUE - ENTRY_FEE,
        script_public_key: pay_to_script_hash_script(&bytecode(successor)),
        covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COV_A }),
    };
    let tx = Transaction::new(1, vec![input], vec![output], 0, Default::default(), 0, vec![]);
    let entry = UtxoEntry::new(SHARD_VALUE, pay_to_script_hash_script(&bytecode(active)), daa_score, false, Some(COV_A));
    (tx, vec![entry])
}

fn execute_registration(
    active: &SilAbiArtifact,
    successor: &SilAbiArtifact,
    winner_spk: Vec<u8>,
    append_siblings: &[[u8; 32]],
    address_siblings: &[[u8; 32]],
    daa_score: u64,
) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let (tx, entries) = registration_case(active, successor, winner_spk, append_siblings, address_siblings, daa_score);
    execute_input_with_covenants(tx, entries, 0)
}

fn measured_script_units(tx: &Transaction, entries: &[UtxoEntry]) -> ScriptUnits {
    let reused_values = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(tx, entries.to_vec());
    let covenants = CovenantsContext::from_tx(&populated).expect("covenant context builds");
    let utxo = populated.utxo(0).expect("selected input UTXO");
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        &tx.inputs[0],
        0,
        utxo,
        EngineCtx::new(&sig_cache).with_reused(&reused_values).with_covenants_ctx(&covenants),
        EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
    );
    vm.execute().expect("registration executes while measuring its script units");
    vm.used_script_units()
}

#[test]
fn first_entry_records_pending_commitment_and_address_without_a_signature() {
    let fixture = first_registration(0);
    execute_registration(
        &fixture.active,
        &fixture.successor,
        fixture.winner_spk,
        &fixture.append_siblings,
        &fixture.address_siblings,
        10,
    )
    .expect("valid append and non-membership proofs pass");
}

#[test]
fn wrong_successor_root_or_count_is_rejected() {
    let fixture = first_registration(0);
    let wrong = compile_shard(0, 0, fixture.entries_root_before, [0x99; 32], fixture.commitment);
    execute_registration(&fixture.active, &wrong, fixture.winner_spk, &fixture.append_siblings, &fixture.address_siblings, 10)
        .expect_err("the exact address-set root is covenant-enforced");
}

#[test]
fn payout_commitment_cannot_register_in_the_wrong_shard() {
    let fixture = first_registration(0);
    let wrong_active =
        compile_shard(1, 0, empty_levels(TREE_DEPTH, 0x00, 0x02)[TREE_DEPTH], empty_levels(256, 0x10, 0x12)[256], [0; 32]);
    let wrong_successor = compile_shard(1, 0, fixture.entries_root_before, fixture.address_root_after, fixture.commitment);
    execute_registration(&wrong_active, &wrong_successor, fixture.winner_spk, &fixture.append_siblings, &fixture.address_siblings, 10)
        .expect_err("the payout hash deterministically selects one shard");
}

#[test]
fn an_existing_payout_commitment_fails_the_non_membership_proof() {
    let fixture = first_registration(0);
    let commitment = sha256(&fixture.winner_spk);
    let second_append_siblings = fixture.append_siblings.clone();
    let second_entries_root = fixture.finalized_entry_root;
    let impossible_successor = compile_shard(0, 1, second_entries_root, fixture.address_root_after, commitment);
    execute_registration(
        &fixture.successor,
        &impossible_successor,
        fixture.winner_spk,
        &second_append_siblings,
        &fixture.address_siblings,
        10,
    )
    .expect_err("the occupied sparse-set path cannot prove non-membership again");
}

#[test]
fn a_pending_entry_confirmed_after_close_cannot_be_rolled_forward() {
    let fixture = first_registration(0);
    let first_marker = u16::from_le_bytes(fixture.winner_spk[..2].try_into().unwrap());
    let next_winner = winner_for_shard_from(0, first_marker + 1);
    let impossible_successor = compile_shard(0, 1, fixture.finalized_entry_root, fixture.address_root_after, sha256(&next_winner));
    execute_registration(
        &fixture.successor,
        &impossible_successor,
        next_winner,
        &fixture.append_siblings,
        &fixture.address_siblings,
        CLOSES_AT_DAA + 1,
    )
    .expect_err("a late pending UTXO cannot advance the eligible entry root");
}

#[test]
fn shard_script_and_realistic_registration_witness_fit_consensus_bounds() {
    let fixture = first_registration(0);
    let (mut tx, entries) = registration_case(
        &fixture.active,
        &fixture.successor,
        fixture.winner_spk,
        &fixture.append_siblings,
        &fixture.address_siblings,
        10,
    );
    let budget = ComputeBudget::checked_covering_script_units(measured_script_units(&tx, &entries))
        .expect("registration fits a Toccata compute budget");
    tx.inputs[0].compute_commit = budget.into();
    let masses = MassCalculator::new_with_consensus_params(&MAINNET_PARAMS).calc_non_contextual_masses(&tx);
    let limits = MAINNET_PARAMS.block_mass_limits().after();
    let witness = &tx.inputs[0].signature_script;
    assert!(bytecode(&fixture.active).len() < 1_000_000);
    assert!(witness.len() < 250_000);
    assert!(masses.compute_mass <= limits.compute);
    assert!(masses.transient_mass <= limits.transient);
    eprintln!("registration: compute_mass={}, transient_mass={}", masses.compute_mass, masses.transient_mass);
}
