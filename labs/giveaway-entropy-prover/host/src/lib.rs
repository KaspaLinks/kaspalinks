use giveaway_entropy_core::{EntropyInput, ValidationError};
use giveaway_entropy_methods::{GIVEAWAY_ENTROPY_GUEST_ELF, GIVEAWAY_ENTROPY_GUEST_ID};
use risc0_zkvm::{
    default_prover,
    sha::{Digest, Digestible},
    ExecutorEnv, Groth16Receipt, Groth16ReceiptVerifierParameters, ProveInfo, ProverOpts,
    ReceiptClaim,
};
use serde::Deserialize;

pub mod participants;

#[derive(Debug)]
pub enum ProverError {
    InvalidInput(ValidationError),
    Environment(String),
    Proving(String),
    Verification(String),
    ReceiptFormat(String),
    JournalMismatch,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CaptureError {
    Field(&'static str),
    HashMismatch(&'static str),
    InvalidNetwork,
    InvalidPair(ValidationError),
    Json,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReconstructionError {
    HeaderCapture(CaptureError),
    ParticipantCapture(participants::ParticipantCaptureError),
    ParticipantTree(participants::ParticipantTreeError),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReconstructedGiveaway {
    pub entropy: EntropyInput,
    pub frozen: participants::FrozenParticipantSet,
    pub winner: participants::WinnerProof,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedEntropyPair {
    pub network: String,
    pub captured_at: String,
    pub source_sink: String,
    pub source_virtual_daa_score: String,
    pub target_blue_score: String,
    pub traversed_selected_parents: usize,
    pub parent: CapturedHeader,
    pub candidate: CapturedHeader,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedHeader {
    pub hash: String,
    pub version: u16,
    pub parents_by_level: Vec<Vec<String>>,
    pub hash_merkle_root: String,
    pub accepted_id_merkle_root: String,
    pub utxo_commitment: String,
    pub timestamp: String,
    pub bits: u32,
    pub nonce: String,
    pub daa_score: String,
    pub blue_work: String,
    pub blue_score: String,
    pub pruning_point: String,
}

/// Converts a public wRPC capture into the exact guest input and verifies both
/// declared header hashes before any proof work begins.
pub fn entropy_input_from_capture(
    capture: &CapturedEntropyPair,
    giveaway_id: [u8; 32],
    frozen_root: [u8; 32],
) -> Result<EntropyInput, CaptureError> {
    if capture.network != "mainnet" {
        return Err(CaptureError::InvalidNetwork);
    }
    parse_u64(&capture.source_virtual_daa_score, "sourceVirtualDaaScore")?;
    let target_blue_score = parse_u64(&capture.target_blue_score, "targetBlueScore")?;
    let (parent, declared_parent_hash) = decode_header(&capture.parent)?;
    let (candidate, declared_candidate_hash) = decode_header(&capture.candidate)?;
    if parent.hash() != declared_parent_hash {
        return Err(CaptureError::HashMismatch("parent.hash"));
    }
    if candidate.hash() != declared_candidate_hash {
        return Err(CaptureError::HashMismatch("candidate.hash"));
    }
    let input = EntropyInput {
        giveaway_id,
        frozen_root,
        target_blue_score,
        parent,
        candidate,
    };
    input.validate().map_err(CaptureError::InvalidPair)?;
    Ok(input)
}

/// Rebuilds the proof input and winner solely from public header and
/// participant captures. Production chain indexing can feed the same boundary
/// after replaying accepted shard transitions.
pub fn reconstruct_giveaway_fixture(
    header_json: &str,
    participant_json: &str,
) -> Result<ReconstructedGiveaway, ReconstructionError> {
    let capture: CapturedEntropyPair = serde_json::from_str(header_json)
        .map_err(|_| ReconstructionError::HeaderCapture(CaptureError::Json))?;
    let (giveaway_id, tree_depth, shards) =
        participants::decode_participant_capture(participant_json)
            .map_err(ReconstructionError::ParticipantCapture)?;
    let frozen = participants::build_frozen_participant_set(&shards, tree_depth)
        .map_err(ReconstructionError::ParticipantTree)?;
    let entropy = entropy_input_from_capture(&capture, giveaway_id, frozen.frozen_root)
        .map_err(ReconstructionError::HeaderCapture)?;
    let validated = entropy
        .validate()
        .map_err(CaptureError::InvalidPair)
        .map_err(ReconstructionError::HeaderCapture)?;
    let winner = participants::select_winner(
        &shards,
        tree_depth,
        giveaway_id,
        frozen.frozen_root,
        validated.candidate_hash,
        validated.candidate_seq_commit,
    )
    .map_err(ReconstructionError::ParticipantTree)?;
    Ok(ReconstructedGiveaway {
        entropy,
        frozen,
        winner,
    })
}

fn decode_header(
    header: &CapturedHeader,
) -> Result<(giveaway_entropy_core::HeaderInput, [u8; 32]), CaptureError> {
    let parents_by_level = header
        .parents_by_level
        .iter()
        .map(|level| {
            level
                .iter()
                .map(|hash| parse_hash(hash, "parentsByLevel"))
                .collect()
        })
        .collect::<Result<Vec<Vec<[u8; 32]>>, CaptureError>>()?;
    let blue_work = parse_hex(&header.blue_work, "blueWork")?;
    Ok((
        giveaway_entropy_core::HeaderInput {
            version: header.version,
            parents_by_level,
            hash_merkle_root: parse_hash(&header.hash_merkle_root, "hashMerkleRoot")?,
            accepted_id_merkle_root: parse_hash(
                &header.accepted_id_merkle_root,
                "acceptedIdMerkleRoot",
            )?,
            utxo_commitment: parse_hash(&header.utxo_commitment, "utxoCommitment")?,
            timestamp: parse_u64(&header.timestamp, "timestamp")?,
            bits: header.bits,
            nonce: parse_u64(&header.nonce, "nonce")?,
            daa_score: parse_u64(&header.daa_score, "daaScore")?,
            blue_work,
            blue_score: parse_u64(&header.blue_score, "blueScore")?,
            pruning_point: parse_hash(&header.pruning_point, "pruningPoint")?,
        },
        parse_hash(&header.hash, "hash")?,
    ))
}

fn parse_hash(value: &str, field: &'static str) -> Result<[u8; 32], CaptureError> {
    let bytes = parse_hex(value, field)?;
    bytes.try_into().map_err(|_| CaptureError::Field(field))
}

fn parse_hex(value: &str, field: &'static str) -> Result<Vec<u8>, CaptureError> {
    if value.len() % 2 != 0 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CaptureError::Field(field));
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = core::str::from_utf8(pair).map_err(|_| CaptureError::Field(field))?;
            u8::from_str_radix(text, 16).map_err(|_| CaptureError::Field(field))
        })
        .collect()
}

fn parse_u64(value: &str, field: &'static str) -> Result<u64, CaptureError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CaptureError::Field(field));
    }
    value.parse().map_err(|_| CaptureError::Field(field))
}

pub fn prove(input: &EntropyInput) -> Result<ProveInfo, ProverError> {
    prove_with_options(input, None)
}

pub fn prove_groth16(input: &EntropyInput) -> Result<ProveInfo, ProverError> {
    prove_with_options(input, Some(&ProverOpts::groth16()))
}

fn prove_with_options(
    input: &EntropyInput,
    options: Option<&ProverOpts>,
) -> Result<ProveInfo, ProverError> {
    let expected_journal = input.journal().map_err(ProverError::InvalidInput)?;
    let env = ExecutorEnv::builder()
        .write(input)
        .map_err(|err| ProverError::Environment(err.to_string()))?
        .build()
        .map_err(|err| ProverError::Environment(err.to_string()))?;

    let prover = default_prover();
    let info = match options {
        Some(options) => prover.prove_with_opts(env, GIVEAWAY_ENTROPY_GUEST_ELF, options),
        None => prover.prove(env, GIVEAWAY_ENTROPY_GUEST_ELF),
    }
    .map_err(|err| ProverError::Proving(err.to_string()))?;
    info.receipt
        .verify(GIVEAWAY_ENTROPY_GUEST_ID)
        .map_err(|err| ProverError::Verification(err.to_string()))?;
    if info.receipt.journal.bytes.as_slice() != expected_journal {
        return Err(ProverError::JournalMismatch);
    }
    Ok(info)
}

pub fn image_id() -> [u8; 32] {
    let digest = Digest::from(GIVEAWAY_ENTROPY_GUEST_ID);
    digest.into()
}

/// Decodes and verifies a compact receipt against the exact public Giveaway
/// input. The receipt contains no private Giveaway or wallet data.
pub fn groth16_receipt_from_bytes(
    input: &EntropyInput,
    bytes: &[u8],
) -> Result<Groth16Receipt<ReceiptClaim>, ProverError> {
    let receipt: Groth16Receipt<ReceiptClaim> =
        borsh::from_slice(bytes).map_err(|err| ProverError::ReceiptFormat(err.to_string()))?;
    verify_groth16_receipt(input, &receipt)?;
    Ok(receipt)
}

/// Verifies both proof integrity and the claim binding to the expected image
/// ID and journal. Integrity alone would only prove the receipt's own claim.
pub fn verify_groth16_receipt(
    input: &EntropyInput,
    receipt: &Groth16Receipt<ReceiptClaim>,
) -> Result<(), ProverError> {
    let journal = input.journal().map_err(ProverError::InvalidInput)?;
    let expected_claim = ReceiptClaim::ok(GIVEAWAY_ENTROPY_GUEST_ID, journal.to_vec());
    if receipt.claim.digest() != expected_claim.digest() {
        return Err(ProverError::Verification(
            "receipt claim does not match the expected image and journal".to_owned(),
        ));
    }
    if receipt.verifier_parameters != Groth16ReceiptVerifierParameters::default().digest() {
        return Err(ProverError::Verification(
            "receipt uses unexpected verifier parameters".to_owned(),
        ));
    }
    receipt
        .verify_integrity()
        .map_err(|err| ProverError::Verification(err.to_string()))?;
    Ok(())
}
