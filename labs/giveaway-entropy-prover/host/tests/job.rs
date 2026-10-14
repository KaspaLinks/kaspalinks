use giveaway_entropy_host::{
    job::{response_from_receipt, ProofJobInput},
    reconstruct_giveaway_fixture,
};

fn fixture_job() -> ProofJobInput {
    let fixture = reconstruct_giveaway_fixture(
        include_str!("../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"),
        include_str!("../../../claimable-script/fixtures/giveaway_v6_participants.json"),
    )
    .expect("fixture reconstructs");
    let captured_pair: serde_json::Value = serde_json::from_str(include_str!(
        "../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"
    ))
    .expect("header capture parses");
    serde_json::from_value(serde_json::json!({
        "giveawayIdHex": hex(&fixture.entropy.giveaway_id),
        "frozenRootHex": hex(&fixture.frozen.frozen_root),
        "entropyTargetBlueScore": fixture.entropy.target_blue_score.to_string(),
        "capturedPair": captured_pair,
    }))
    .expect("proof job parses")
}

#[test]
fn existing_mainnet_receipt_becomes_a_worker_ready_response() {
    let job = fixture_job();
    let response = response_from_receipt(
        &job,
        include_bytes!(
            "../../../claimable-script/fixtures/giveaway_entropy_v6_mainnet_groth16.rcpt"
        ),
    )
    .expect("receipt is bound to the job and encoded for Kaspa");
    assert_eq!(response.status, "ready");
    assert_eq!(response.compact_proof_hex.len(), 256);
    assert_eq!(response.candidate_blue_score, "559181995");
    assert_eq!(response.parent_blue_score, "559181983");
    assert_eq!(
        response.candidate_block_hash_hex,
        job.captured_pair.candidate.hash
    );
    assert_eq!(
        response.candidate_sequence_commitment_hex,
        job.captured_pair.candidate.accepted_id_merkle_root
    );
}

#[test]
fn another_frozen_root_cannot_reuse_the_receipt() {
    let mut job = fixture_job();
    job.frozen_root_hex.replace_range(0..2, "00");
    assert!(response_from_receipt(
        &job,
        include_bytes!(
            "../../../claimable-script/fixtures/giveaway_entropy_v6_mainnet_groth16.rcpt"
        ),
    )
    .is_err());
}

#[test]
fn a_different_target_is_rejected_before_proving() {
    let mut job = fixture_job();
    job.entropy_target_blue_score = "559181996".to_owned();
    assert!(job.entropy().is_err());
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").unwrap();
    }
    out
}
