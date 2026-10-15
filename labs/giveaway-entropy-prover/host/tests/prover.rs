use giveaway_entropy_core::{EntropyInput, HeaderInput, ValidationError, TOCCATA_BLOCK_VERSION};
use giveaway_entropy_host::{
    entropy_input_from_capture, groth16_receipt_from_bytes, image_id, prove, prove_groth16,
    reconstruct_giveaway_fixture, CaptureError, CapturedEntropyPair, ProverError,
};

fn reconstructed() -> giveaway_entropy_host::ReconstructedGiveaway {
    reconstruct_giveaway_fixture(
        include_str!("../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"),
        include_str!("../../../claimable-script/fixtures/giveaway_v6_participants.json"),
    )
    .expect("shared Mainnet Giveaway fixture reconstructs")
}

fn synthetic_header(seed: u8, score: u64, direct_parent: [u8; 32]) -> HeaderInput {
    HeaderInput {
        version: TOCCATA_BLOCK_VERSION,
        parents_by_level: vec![vec![direct_parent], vec![[seed.wrapping_add(1); 32]]],
        hash_merkle_root: [seed.wrapping_add(2); 32],
        accepted_id_merkle_root: [seed.wrapping_add(3); 32],
        utxo_commitment: [seed.wrapping_add(4); 32],
        timestamp: 1_700_000_000_000 + seed as u64,
        bits: 0x1e7fffff,
        nonce: 42 + seed as u64,
        daa_score: 10_000 + seed as u64,
        blue_work: vec![seed.max(1), seed.wrapping_add(5)],
        blue_score: score,
        pruning_point: [seed.wrapping_add(6); 32],
    }
}

fn synthetic_input() -> EntropyInput {
    let parent = synthetic_header(11, 99, [9; 32]);
    let candidate = synthetic_header(21, 100, parent.hash());
    EntropyInput {
        target_blue_score: 100,
        parent,
        candidate,
    }
}

fn mainnet_capture() -> CapturedEntropyPair {
    serde_json::from_str(include_str!(
        "../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"
    ))
    .expect("pinned Mainnet header pair parses")
}

#[test]
fn imports_and_rehashes_the_pinned_mainnet_pair() {
    let input =
        entropy_input_from_capture(&mainnet_capture()).expect("pinned Mainnet headers verify");
    assert_eq!(
        hex(&input.parent.hash()),
        "49c362907357ef61e3eeb4a0fcf7cae6b7dc05a04b566ec0a1fae917ab4be2d1"
    );
    assert_eq!(
        hex(&input.candidate.hash()),
        "6f47bd29ccfd401757a85ff360dc7076c8e4b167ae4b3ccbeec7550028c0e52b"
    );
    assert_eq!(input.target_blue_score, 559_181_995);
}

#[test]
fn rejects_a_mutated_mainnet_header_capture() {
    let mut capture = mainnet_capture();
    capture.candidate.nonce = (capture.candidate.nonce.parse::<u64>().unwrap() + 1).to_string();
    assert_eq!(
        entropy_input_from_capture(&capture),
        Err(CaptureError::HashMismatch("candidate.hash"))
    );
}

#[test]
fn image_id_is_pinned() {
    assert_eq!(
        hex(&image_id()),
        "8d405aec6ae72a8a2bba7ed56620c85973c555599b52403187f40c6891d44d3b"
    );
}

#[test]
fn invalid_input_never_reaches_the_prover() {
    let mut input = synthetic_input();
    input.candidate.parents_by_level[0][0] = [7; 32];
    assert!(matches!(
        prove(&input),
        Err(ProverError::InvalidInput(
            ValidationError::WrongSelectedParent
        ))
    ));
}

#[test]
fn produces_and_verifies_a_composite_receipt() {
    let input = synthetic_input();
    let info = prove(&input).expect("proof must be generated and verified");
    assert_eq!(info.receipt.journal.bytes, input.journal().unwrap());
}

#[test]
#[ignore = "requires Docker for RISC Zero Groth16 compression"]
fn produces_and_verifies_a_groth16_receipt() {
    let input = reconstructed().entropy;
    let info = prove_groth16(&input).expect("Groth16 proof must be generated and verified");
    assert!(info.receipt.inner.groth16().is_ok());
    assert_eq!(info.receipt.journal.bytes, input.journal().unwrap());
}

#[test]
fn verifies_the_pinned_groth16_fixture() {
    let fixture = reconstructed();
    let receipt = groth16_receipt_from_bytes(
        &fixture.entropy,
        include_bytes!(
            "../../../claimable-script/fixtures/giveaway_entropy_v6_mainnet_groth16.rcpt"
        ),
    )
    .expect("fixture must attest the exact guest claim");
    assert_eq!(receipt.seal.len(), 256);
    assert_eq!(fixture.frozen.entry_count, 12);
    assert_eq!(fixture.winner.global_index, 5);
    assert_eq!(fixture.winner.shard_index, 1);
    assert_eq!(fixture.winner.local_index, 2);
}

#[test]
fn pinned_proof_is_bound_to_its_target_blue_score() {
    // The pinned pair crosses every target in (parent score, candidate score],
    // so a neighbouring target is still a valid first crossing for the same
    // headers. The receipt must nevertheless verify only for its own target:
    // that binding is what keeps one draw slot's proof out of another slot.
    let mut input = reconstructed().entropy;
    assert!(input.parent.blue_score < input.target_blue_score - 1);
    input.target_blue_score -= 1;
    input
        .validate()
        .expect("the same pair also crosses the neighbouring target");
    assert!(matches!(
        groth16_receipt_from_bytes(
            &input,
            include_bytes!(
                "../../../claimable-script/fixtures/giveaway_entropy_v6_mainnet_groth16.rcpt"
            ),
        ),
        Err(ProverError::Verification(_))
    ));
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").unwrap();
    }
    out
}
