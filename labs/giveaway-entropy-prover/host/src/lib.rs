use giveaway_entropy_core::{EntropyInput, ValidationError};
use giveaway_entropy_methods::{GIVEAWAY_ENTROPY_GUEST_ELF, GIVEAWAY_ENTROPY_GUEST_ID};
use risc0_groth16::{ProofJson, Seal};
use risc0_zkvm::{
    default_prover,
    sha::{Digest, Digestible},
    ExecutorEnv, Groth16Receipt, Groth16ReceiptVerifierParameters, ProveInfo, ProverOpts,
    ReceiptClaim,
};

#[derive(Debug)]
pub enum ProverError {
    InvalidInput(ValidationError),
    Environment(String),
    Proving(String),
    Verification(String),
    ProofFormat(String),
    JournalMismatch,
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

/// Reconstructs and verifies the compact receipt emitted by the pinned RISC
/// Zero Groth16 container. The proof JSON contains no private Giveaway data.
pub fn groth16_receipt_from_proof_json(
    input: &EntropyInput,
    proof_json: &str,
) -> Result<Groth16Receipt<ReceiptClaim>, ProverError> {
    let journal = input.journal().map_err(ProverError::InvalidInput)?;
    let proof: ProofJson = serde_json::from_str(proof_json)
        .map_err(|err| ProverError::ProofFormat(err.to_string()))?;
    let seal: Seal = proof
        .try_into()
        .map_err(|err: anyhow::Error| ProverError::ProofFormat(err.to_string()))?;
    let claim = ReceiptClaim::ok(GIVEAWAY_ENTROPY_GUEST_ID, journal.to_vec());
    let receipt = Groth16Receipt::new(
        seal.to_vec(),
        claim.into(),
        Groth16ReceiptVerifierParameters::default().digest(),
    );
    receipt
        .verify_integrity()
        .map_err(|err| ProverError::Verification(err.to_string()))?;
    Ok(receipt)
}
