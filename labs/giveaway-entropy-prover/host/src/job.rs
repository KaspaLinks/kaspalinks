use giveaway_entropy_core::EntropyInput;
use serde::{Deserialize, Serialize};

use crate::{
    entropy_input_from_capture, groth16_receipt_from_bytes, prove_groth16, CaptureError,
    CapturedEntropyPair, ProverError,
};

/// Public data only. The header capture is independently rehashed before proving.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofJobInput {
    pub giveaway_id_hex: String,
    pub frozen_root_hex: String,
    pub entropy_target_blue_score: String,
    pub captured_pair: CapturedEntropyPair,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofReadyResponse {
    pub status: &'static str,
    pub compact_proof_hex: String,
    pub parent_block_hash_hex: String,
    pub parent_blue_score: String,
    pub parent_sequence_commitment_hex: String,
    pub candidate_block_hash_hex: String,
    pub candidate_blue_score: String,
    pub candidate_sequence_commitment_hex: String,
}

#[derive(Debug)]
pub enum JobError {
    InvalidInput,
    InvalidCapture(CaptureError),
    Proving(ProverError),
    ProofEncoding,
}

impl ProofJobInput {
    pub fn entropy(&self) -> Result<EntropyInput, JobError> {
        let giveaway_id = parse_hash(&self.giveaway_id_hex)?;
        let frozen_root = parse_hash(&self.frozen_root_hex)?;
        let target = parse_u64(&self.entropy_target_blue_score)?;
        if self.captured_pair.target_blue_score != self.entropy_target_blue_score {
            return Err(JobError::InvalidInput);
        }
        let input = entropy_input_from_capture(&self.captured_pair, giveaway_id, frozen_root)
            .map_err(JobError::InvalidCapture)?;
        if input.target_blue_score != target {
            return Err(JobError::InvalidInput);
        }
        Ok(input)
    }
}

pub fn prove_job(job: &ProofJobInput) -> Result<ProofReadyResponse, JobError> {
    let input = job.entropy()?;
    let info = prove_groth16(&input).map_err(JobError::Proving)?;
    let receipt = info
        .receipt
        .inner
        .groth16()
        .map_err(|_| JobError::ProofEncoding)?;
    let bytes = borsh::to_vec(receipt).map_err(|_| JobError::ProofEncoding)?;
    response_from_receipt(job, &bytes)
}

/// Allows a fixture or a freshly generated receipt through the same checked
/// response boundary. A receipt for another image, Giveaway, or header fails.
pub fn response_from_receipt(
    job: &ProofJobInput,
    receipt_bytes: &[u8],
) -> Result<ProofReadyResponse, JobError> {
    let input = job.entropy()?;
    let receipt = groth16_receipt_from_bytes(&input, receipt_bytes).map_err(JobError::Proving)?;
    let proof = kaspa_txscript_zk_sdk::prepare_r0_groth16_proof(&receipt)
        .map_err(|_| JobError::ProofEncoding)?;
    let validated = input.validate().map_err(|_| JobError::InvalidInput)?;
    Ok(ProofReadyResponse {
        status: "ready",
        compact_proof_hex: hex(&proof),
        parent_block_hash_hex: hex(&validated.parent_hash),
        parent_blue_score: input.parent.blue_score.to_string(),
        parent_sequence_commitment_hex: hex(&input.parent.accepted_id_merkle_root),
        candidate_block_hash_hex: hex(&validated.candidate_hash),
        candidate_blue_score: input.candidate.blue_score.to_string(),
        candidate_sequence_commitment_hex: hex(&validated.candidate_seq_commit),
    })
}

fn parse_u64(value: &str) -> Result<u64, JobError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(JobError::InvalidInput);
    }
    value.parse().map_err(|_| JobError::InvalidInput)
}

fn parse_hash(value: &str) -> Result<[u8; 32], JobError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(JobError::InvalidInput);
    }
    let mut hash = [0; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let text = core::str::from_utf8(pair).map_err(|_| JobError::InvalidInput)?;
        hash[index] = u8::from_str_radix(text, 16).map_err(|_| JobError::InvalidInput)?;
    }
    Ok(hash)
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").expect("hex formatting cannot fail");
    }
    out
}
