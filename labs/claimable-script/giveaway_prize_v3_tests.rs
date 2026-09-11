// Engine-Tests fuer das Giveaway-Preis-Covenant V3.
//
// Usage: copy this file plus `giveaway_prize_v3.sil` to
// `silverscript-lang/tests/` inside the pinned kaspanet/silverscript
// checkout (include giveaway_prize_v3_prototype_vectors.json), then:
//
//   cargo test -p silverscript-lang --test giveaway_prize_v3_tests
//
// Die Tests fahren die echte TxScriptEngine mit covenants_enabled. Sie pruefen
// die Script-Ausfuehrung mit gemocktem Chain-Accessor. Die Web-Vektoren pruefen
// auch die Gebuehren-/Masserechnung; ein finanzierter Mainnet-Durchlauf bleibt separat.

mod common;

use common::{bytecode, compile_contract, compiled_template_parts_and_hash, encode_entry_sig_script};
use kaspa_consensus_core::Hash;
use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput,
    TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{
    EngineCtx, EngineFlags, SeqCommitAccessor, TxScriptEngine, pay_to_script_hash_script,
    pay_to_script_hash_signature_script_with_flags,
};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use silverscript_abi::ArtifactValue;
use silverscript_lang::compiler::CompileOptions;

const SOURCE: &str = include_str!("giveaway_prize_v3.sil");

const PRIZE: u64 = 100_000_000;
const DRAW_FEE: u64 = 3_000;
const CLOSES_AT_DAA: i64 = 200_000_000;
const REFUND_DAA: i64 = 200_100_000;
const FUNDING: u64 = PRIZE + DRAW_FEE + 5_000;
const COMPUTE_BUDGET: u16 = 2_000;

const ENTROPY_BLOCK: [u8; 32] = [0x7a; 32];
const ENTROPY_SEED: [u8; 32] = [0x5c; 32];

const TAG_FROZEN: u8 = 0x01;
const TAG_DIGEST: u8 = 0x03;
const TAG_ENTRIES_ATTESTATION: u8 = 0x11;
const TAG_ENTROPY_ATTESTATION: u8 = 0x12;

fn digest32(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Acht Byte little-endian, oberstes Bit frei — so liest `OpBin2Num` den Wert
/// als nicht-negative Zahl.
fn u64le(value: u64) -> [u8; 8] {
    assert!(value < 1 << 55, "Wert muss mit freiem Vorzeichenbit kodierbar sein");
    value.to_le_bytes()
}

/// `paramsHash = sha256(prize ‖ drawFee ‖ closesAt ‖ refundAt ‖ creatorPk)`
fn params_hash(creator_pk: &[u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&u64le(PRIZE));
    preimage.extend_from_slice(&u64le(DRAW_FEE));
    preimage.extend_from_slice(&u64le(CLOSES_AT_DAA as u64));
    preimage.extend_from_slice(&u64le(REFUND_DAA as u64));
    preimage.extend_from_slice(creator_pk);
    digest32(&preimage)
}

fn open_state(params: &[u8; 32]) -> [u8; 32] {
    let mut preimage = vec![0x00u8];
    preimage.extend_from_slice(params);
    preimage.extend_from_slice(&[0u8; 32]);
    digest32(&preimage)
}

fn fixed_keypair(seed: u8) -> Keypair {
    let secp = Secp256k1::new();
    let secret = SecretKey::from_slice(&[seed; 32]).expect("valid secret key");
    Keypair::from_secret_key(&secp, &secret)
}

/// Ein Teilnehmer-Auszahlungsziel. Die Liste committet auf sha256(spk), damit
/// sowohl P2PK- als auch P2SH-Gewinneradressen passen.
fn participant_spk(index: u8) -> ScriptPublicKey {
    ScriptPublicKey::new(0, vec![0x51, 0x60 + index].into())
}

fn serialized_spk(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut out = vec![0u8, 0u8];
    out.extend_from_slice(spk.script().as_ref());
    out
}

struct Draw {
    entries: Vec<u8>,
    entries_root: [u8; 32],
    winner_index: usize,
    winner_spk: ScriptPublicKey,
}

/// Baut die Teilnehmerliste und leitet den Gewinner exakt so ab, wie es das
/// Script tut: uint32 little-endian aus den ersten vier Digest-Bytes, modulo
/// Teilnehmerzahl.
fn build_draw(participant_count: u8) -> Draw {
    let spks: Vec<ScriptPublicKey> = (0..participant_count).map(participant_spk).collect();
    let mut entries = Vec::new();
    for spk in &spks {
        entries.extend_from_slice(&digest32(&serialized_spk(spk)));
    }
    let entries_root = digest32(&entries);

    let mut preimage = vec![TAG_DIGEST];
    preimage.extend_from_slice(&ENTROPY_SEED);
    preimage.extend_from_slice(&entries_root);
    let digest = digest32(&preimage);

    let raw = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]) as u64;
    let winner_index = (raw % participant_count as u64) as usize;

    Draw { entries, entries_root, winner_index, winner_spk: spks[winner_index].clone() }
}

fn frozen_state(params: &[u8; 32], entries_root: &[u8; 32]) -> [u8; 32] {
    let mut preimage = vec![TAG_FROZEN];
    preimage.extend_from_slice(params);
    preimage.extend_from_slice(entries_root);
    digest32(&preimage)
}

struct MockChain {
    block: Hash,
    commitment: Hash,
}

impl SeqCommitAccessor for MockChain {
    fn is_chain_ancestor_from_pov(&self, block_hash: Hash) -> Option<bool> {
        Some(block_hash == self.block)
    }

    fn seq_commitment_within_depth(&self, block_hash: Hash) -> Option<Hash> {
        (block_hash == self.block).then_some(self.commitment)
    }
}

fn compile_v3(init_state: [u8; 32]) -> silverscript_abi::SilAbiArtifact {
    let platform = fixed_keypair(0x11);
    compile_contract(
        SOURCE,
        &[
            ArtifactValue::Bytes(platform.x_only_public_key().0.serialize().to_vec()),
            ArtifactValue::Bytes(init_state.to_vec()),
        ],
        CompileOptions::default(),
    )
    .expect("giveaway_prize_v3.sil compiles")
}

/// Setzt den Zustand in bereits kompilierten Bytecode ein — genau das, was
/// `validateOutputState` zur Laufzeit nachbaut.
fn bytecode_with_state(artifact: &silverscript_abi::SilAbiArtifact, state: &[u8; 32]) -> Vec<u8> {
    let (prefix, suffix, _) = compiled_template_parts_and_hash(artifact);
    let mut out = prefix;
    out.push(0x20);
    out.extend_from_slice(state);
    out.extend_from_slice(&suffix);
    out
}

/// Die fuenf Giveaway-Parameter, wie sie jeder Zweig im Witness erwartet.
fn param_args(creator_pk: &[u8; 32]) -> Vec<ArtifactValue> {
    vec![
        ArtifactValue::Bytes(u64le(PRIZE).to_vec()),
        ArtifactValue::Bytes(u64le(DRAW_FEE).to_vec()),
        ArtifactValue::Bytes(u64le(CLOSES_AT_DAA as u64).to_vec()),
        ArtifactValue::Bytes(u64le(REFUND_DAA as u64).to_vec()),
        ArtifactValue::Bytes(creator_pk.to_vec()),
    ]
}

#[derive(Clone, Copy, PartialEq)]
enum Mutation {
    None,
    /// Auszahlung an einen anderen Teilnehmer als den gezogenen.
    WrongWinner,
    /// Auszahlung an eine Adresse, die gar nicht teilgenommen hat.
    OutsiderWinner,
    /// Betrag abweichend.
    WrongAmount,
    /// Ein Eintrag der Liste veraendert — passt nicht mehr zur Wurzel.
    TamperedEntries,
    /// Liste umsortiert, damit ein anderer Teilnehmer auf die Gewinnposition
    /// rutscht.
    ReorderedEntries,
    /// Entropie-Block liegt nicht in der Selected Chain.
    UnknownBlock,
    /// Zusaetzlicher Output neben der Auszahlung.
    ExtraOutput,
    /// Plattform-Signatur von einem fremden Schluessel.
    ForgedPlatformSig,
    /// Zeitschranke noch nicht erreicht.
    TooEarly,
    /// `draw` versucht, obwohl noch nicht eingefroren wurde.
    NotFrozen,
    FrozenRefund,
    WrongRefundKey,
    RefundOutputTampered,
}

fn run(mode: &str, mutation: Mutation) -> Result<(), TxScriptError> {
    let platform = fixed_keypair(0x11);
    let creator = fixed_keypair(0x22);
    let impostor = fixed_keypair(0x33);
    let creator_pk = creator.x_only_public_key().0.serialize();
    let params = params_hash(&creator_pk);
    let open = open_state(&params);

    let mut draw = build_draw(4);
    let frozen = frozen_state(&params, &draw.entries_root);

    let init_state = if (mode == "draw" && mutation != Mutation::NotFrozen) || mutation == Mutation::FrozenRefund { frozen } else { open };
    let artifact = compile_v3(init_state);
    let redeem_script = bytecode(&artifact);
    let funding_spk = pay_to_script_hash_script(&redeem_script);

    // Outputs je nach Zweig.
    let mut outputs = match mode {
        "freeze" => vec![TransactionOutput {
            value: PRIZE + DRAW_FEE,
            script_public_key: ScriptPublicKey::new(
                0,
                pay_to_script_hash_script(&bytecode_with_state(&artifact, &frozen)).script().to_vec().into(),
            ),
            covenant: None,
        }],
        "draw" => {
            let target = match mutation {
                Mutation::WrongWinner => participant_spk(((draw.winner_index as u8) + 1) % 4),
                Mutation::OutsiderWinner => ScriptPublicKey::new(0, vec![0x51, 0x7f].into()),
                _ => draw.winner_spk.clone(),
            };
            vec![TransactionOutput { value: PRIZE, script_public_key: target, covenant: None }]
        }
        "refund" => vec![TransactionOutput {
            value: FUNDING - 1_000,
            script_public_key: participant_spk(0),
            covenant: None,
        }],
        other => panic!("unknown mode {other}"),
    };

    if mutation == Mutation::WrongAmount {
        outputs[0].value -= 1;
    }
    if mutation == Mutation::ExtraOutput {
        outputs.push(TransactionOutput { value: 1_000, script_public_key: participant_spk(1), covenant: None });
    }

    let lock_time: u64 = match (mode, mutation) {
        (_, Mutation::TooEarly) if mode == "freeze" => (CLOSES_AT_DAA - 1) as u64,
        (_, Mutation::TooEarly) => (REFUND_DAA - 1) as u64,
        ("freeze", _) => CLOSES_AT_DAA as u64,
        ("refund", _) => REFUND_DAA as u64,
        _ => 0,
    };

    let input = TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([7u8; 32]), index: 0 },
        vec![],
        0,
        COMPUTE_BUDGET,
    );
    let tx = Transaction::new(1, vec![input], outputs, lock_time, Default::default(), 0, vec![]);
    let utxo_entry = UtxoEntry::new(FUNDING, funding_spk, 0, false, None);
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo_entry.clone()]);

    // Die Liste darf erst nach der Wurzelbildung manipuliert werden, sonst
    // wuerde der Test die Wurzel mitziehen und nichts beweisen.
    if mutation == Mutation::TamperedEntries {
        draw.entries[0] ^= 0xff;
    }
    if mutation == Mutation::ReorderedEntries {
        let (head, tail) = draw.entries.split_at(32);
        let mut swapped = tail[..32].to_vec();
        swapped.extend_from_slice(head);
        swapped.extend_from_slice(&tail[32..]);
        draw.entries = swapped;
    }

    let signer = if mutation == Mutation::ForgedPlatformSig { &impostor } else { &platform };

    let witness: Vec<ArtifactValue> = match mode {
        "freeze" => {
            let mut msg = vec![TAG_ENTRIES_ATTESTATION];
            msg.extend_from_slice(&params);
            msg.extend_from_slice(&draw.entries_root);
            let digest = digest32(&msg);
            let sig = signer.sign_schnorr(secp256k1::Message::from_digest(digest));
            let mut args = vec![ArtifactValue::Bytes(sig.as_ref().to_vec())];
            args.extend(param_args(&creator_pk));
            args.push(ArtifactValue::Bytes(draw.entries_root.to_vec()));
            args.push(ArtifactValue::Bytes(vec![0u8; 32]));
            args
        }
        "draw" => {
            let mut msg = vec![TAG_ENTROPY_ATTESTATION];
            msg.extend_from_slice(&params);
            msg.extend_from_slice(&ENTROPY_BLOCK);
            let digest = digest32(&msg);
            let sig = signer.sign_schnorr(secp256k1::Message::from_digest(digest));
            let mut args = vec![ArtifactValue::Bytes(sig.as_ref().to_vec())];
            args.extend(param_args(&creator_pk));
            args.push(ArtifactValue::Bytes(draw.entries_root.to_vec()));
            args.push(ArtifactValue::Bytes(ENTROPY_BLOCK.to_vec()));
            args.push(ArtifactValue::Bytes(draw.entries.clone()));
            args.push(ArtifactValue::Bytes(serialized_spk(&tx.tx.outputs[0].script_public_key)));
            args
        }
        "refund" => {
            let reused = SigHashReusedValuesUnsync::new();
            let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &reused);
            let message = secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).unwrap();
            let sig = if mutation == Mutation::WrongRefundKey { impostor.sign_schnorr(message) } else { creator.sign_schnorr(message) };
            let mut encoded = sig.as_ref().to_vec();
            encoded.push(SIG_HASH_ALL.to_u8());
            let mut args = vec![ArtifactValue::Bytes(encoded)];
            args.extend(param_args(&creator_pk));
            let frozen_refund = mutation == Mutation::FrozenRefund;
            args.push(ArtifactValue::Bytes(vec![if frozen_refund { 0x01 } else { 0x00 }]));
            args.push(ArtifactValue::Bytes(if frozen_refund { draw.entries_root.to_vec() } else { vec![0u8; 32] }));
            args
        }
        other => panic!("unknown mode {other}"),
    };

    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };
    let inner = encode_entry_sig_script(&artifact, mode, &witness).expect("witness encodes");
    tx.tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags).expect("p2sh sigscript builds");

    if mutation == Mutation::RefundOutputTampered {
        tx.tx.outputs[0].script_public_key = participant_spk(3);
    }
    let chain = MockChain {
        block: Hash::from_bytes(if mutation == Mutation::UnknownBlock { [0x99; 32] } else { ENTROPY_BLOCK }),
        commitment: Hash::from_bytes(ENTROPY_SEED),
    };

    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(&tx.tx, vec![utxo_entry.clone()]);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("covenants context");
    let ctx = EngineCtx::new(&sig_cache)
        .with_reused(&reused)
        .with_covenants_ctx(&cov_ctx)
        .with_seq_commit_accessor(&chain);

    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        &populated.tx().inputs[0],
        0,
        &utxo_entry,
        ctx,
        flags,
    );
    vm.execute()
}


// ---------------------------------------------------------------- Positivfaelle

#[test]
fn freeze_locks_the_attested_entry_list() {
    run("freeze", Mutation::None).expect("freeze mit gueltiger Plattform-Signatur wird akzeptiert");
}

#[test]
fn draw_pays_the_drawn_winner() {
    run("draw", Mutation::None).expect("Ziehung zahlt an den abgeleiteten Gewinner");
}

#[test]
fn refund_returns_to_creator_after_deadline() {
    run("refund", Mutation::None).expect("Refund nach Ablauf wird akzeptiert");
}

/// Das Contract ist groesser als die alte 520-Byte-Grenze. Post-Toccata gilt
/// 1 MB; dieser Test fuehrt es tatsaechlich aus, statt sich auf die Konstante
/// zu verlassen.
#[test]
fn redeem_script_exceeds_the_legacy_520_byte_limit() {
    let script_len = bytecode(&compile_v3([0x33; 32])).len();
    assert!(script_len > 520, "Contract ist {script_len} Byte, der Test braucht >520");
    run("freeze", Mutation::None).expect("ein >520-Byte-P2SH-Script laeuft mit aktivierten Covenants");
}

// ---------------------------------------------------------------- Negativfaelle

#[test]
fn draw_rejects_payout_to_another_participant() {
    run("draw", Mutation::WrongWinner).expect_err("Auszahlung an einen anderen Teilnehmer muss scheitern");
}

#[test]
fn draw_rejects_payout_to_a_non_participant() {
    run("draw", Mutation::OutsiderWinner).expect_err("Auszahlung an einen Nichtteilnehmer muss scheitern");
}

#[test]
fn draw_rejects_short_payout() {
    run("draw", Mutation::WrongAmount).expect_err("abweichender Betrag muss scheitern");
}

#[test]
fn draw_rejects_tampered_entry_list() {
    run("draw", Mutation::TamperedEntries).expect_err("veraenderte Teilnehmerliste muss scheitern");
}

#[test]
fn draw_rejects_reordered_entry_list() {
    run("draw", Mutation::ReorderedEntries).expect_err("umsortierte Liste muss scheitern");
}

#[test]
fn draw_rejects_block_outside_the_selected_chain() {
    run("draw", Mutation::UnknownBlock).expect_err("Block ausserhalb der Selected Chain muss scheitern");
}

#[test]
fn draw_rejects_additional_outputs() {
    run("draw", Mutation::ExtraOutput).expect_err("zusaetzlicher Output muss scheitern");
}

#[test]
fn draw_rejects_forged_entropy_attestation() {
    run("draw", Mutation::ForgedPlatformSig).expect_err("gefaelschte Signatur auf dem Entropie-Block muss scheitern");
}

#[test]
fn draw_rejects_running_before_freeze() {
    run("draw", Mutation::NotFrozen).expect_err("Ziehung vor dem Einfrieren muss scheitern");
}

#[test]
fn freeze_rejects_forged_attestation() {
    run("freeze", Mutation::ForgedPlatformSig).expect_err("gefaelschte Plattform-Signatur muss scheitern");
}

#[test]
fn freeze_rejects_before_entry_close() {
    run("freeze", Mutation::TooEarly).expect_err("Einfrieren vor Teilnahmeschluss muss scheitern");
}

#[test]
fn refund_rejects_before_deadline() {
    run("refund", Mutation::TooEarly).expect_err("Refund vor Ablauf muss scheitern");
}

/// Diagnose: zeigt, *woran* jeder Negativfall scheitert. Ein Negativtest, der
/// aus einem beilaeufigen Grund fehlschlaegt, beweist nichts ueber die Regel,
/// die er pruefen soll.
#[test]
fn every_rejection_has_a_stated_reason() {
    let cases: [(&str, &str, Mutation); 13] = [
        ("draw", "anderer Teilnehmer", Mutation::WrongWinner),
        ("draw", "Nichtteilnehmer", Mutation::OutsiderWinner),
        ("draw", "zu kleiner Betrag", Mutation::WrongAmount),
        ("draw", "Liste veraendert", Mutation::TamperedEntries),
        ("draw", "Liste umsortiert", Mutation::ReorderedEntries),
        ("draw", "Block nicht in der Chain", Mutation::UnknownBlock),
        ("draw", "zusaetzlicher Output", Mutation::ExtraOutput),
        ("draw", "Entropie-Sig gefaelscht", Mutation::ForgedPlatformSig),
        ("draw", "vor dem Einfrieren", Mutation::NotFrozen),
        ("freeze", "Listen-Sig gefaelscht", Mutation::ForgedPlatformSig),
        ("freeze", "vor Teilnahmeschluss", Mutation::TooEarly),
        ("refund", "vor Ablauf", Mutation::TooEarly),
        ("draw", "unveraendert (muss laufen)", Mutation::None),
    ];
    for (mode, label, mutation) in cases {
        match run(mode, mutation) {
            Ok(()) => println!("{mode:7} {label:30} -> AKZEPTIERT"),
            Err(err) => println!("{mode:7} {label:30} -> {err}"),
        }
    }
}

// ------------------------------------------------- Sprachuebergreifende Pruefung

/// Der Webserver signiert die Attestierungen mit `@noble/secp256k1`, gepruefte
/// werden sie von Kaspas `OpCheckSigFromStack`. Dass beide dasselbe BIP340
/// meinen, ist eine Annahme — hier wird sie ausgefuehrt.
///
/// Schluessel, Nachricht und Signatur stammen aus einem Lauf von noble v3.1.0
/// (Testschluessel, nicht der Produktivschluessel). Erzeugt mit:
///   sk     = sha256("kaspalinks-v3-crosscheck-test-key")
///   digest = sha256("kaspalinks-v3-crosscheck-message")
///   sig    = schnorr.sign(digest, sk)
const NOBLE_PUBLIC_KEY: &str = "1685021ce3cd2ab4914444e087600eefbb6fb54328e79a18fbf3b166450362e5";
const NOBLE_DIGEST: &str = "14ac8c1f7be728a3db7f79a4d7820a39d22b244cb199c4952a922dd8b7a17c13";
const NOBLE_SIGNATURE: &str = "b7e7a5f05a63250c52415747f91f040c64825aea4dfe74e9caf060b0a021b82e\
9c959bfcc4ab424d2e8957aec2a83027808ebf4f52816f32fc7b13ec06c28ff5";

fn unhex(value: &str) -> Vec<u8> {
    let cleaned: String = value.chars().filter(|c| !c.is_whitespace()).collect();
    (0..cleaned.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).expect("hex"))
        .collect()
}

fn run_attestation(signature: Vec<u8>) -> Result<(), TxScriptError> {
    let source = r#"
        contract Attest(pubkey platformPk, byte[32] expectedDigest) {
            entry check(datasig platformSig) {
                require(checkMsgSig(platformSig, expectedDigest, platformPk));
            }
        }
    "#;
    let artifact = compile_contract(
        source,
        &[
            ArtifactValue::Bytes(unhex(NOBLE_PUBLIC_KEY)),
            ArtifactValue::Bytes(unhex(NOBLE_DIGEST)),
        ],
        CompileOptions::default(),
    )
    .expect("attestation probe compiles");

    let redeem_script = bytecode(&artifact);
    let funding_spk = pay_to_script_hash_script(&redeem_script);
    let input = TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([5u8; 32]), index: 0 },
        vec![],
        0,
        COMPUTE_BUDGET,
    );
    let output = TransactionOutput { value: 1_000, script_public_key: participant_spk(0), covenant: None };
    let tx = Transaction::new(1, vec![input], vec![output], 0, Default::default(), 0, vec![]);
    let utxo_entry = UtxoEntry::new(2_000, funding_spk, 0, false, None);
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo_entry.clone()]);

    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };
    let inner = encode_entry_sig_script(&artifact, "check", &[ArtifactValue::Bytes(signature)])
        .expect("witness encodes");
    tx.tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags).expect("p2sh sigscript builds");

    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(&tx.tx, vec![utxo_entry.clone()]);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("covenants context");
    let ctx = EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx);
    let mut vm =
        TxScriptEngine::from_transaction_input(&populated, &populated.tx().inputs[0], 0, &utxo_entry, ctx, flags);
    vm.execute()
}

#[test]
fn kaspa_accepts_an_attestation_signed_by_the_web_apps_library() {
    run_attestation(unhex(NOBLE_SIGNATURE)).expect("Kaspa akzeptiert die von noble erzeugte BIP340-Signatur");
}

#[test]
fn kaspa_rejects_a_single_flipped_signature_byte() {
    // Ohne diesen Fall koennte der Test oben auch gruen sein, wenn die
    // Signatur ueberhaupt nicht geprueft wuerde.
    let mut tampered = unhex(NOBLE_SIGNATURE);
    tampered[10] ^= 0x01;
    run_attestation(tampered).expect_err("eine veraenderte Signatur muss scheitern");
}

#[test]
fn refund_from_frozen_state_passes() {
    run("refund", Mutation::FrozenRefund).expect("frozen prize remains refundable");
}
#[test]
fn refund_rejects_another_signing_key() {
    run("refund", Mutation::WrongRefundKey).expect_err("only creator can refund");
}
#[test]
fn refund_signature_binds_destination() {
    run("refund", Mutation::RefundOutputTampered).expect_err("refund cannot be redirected after signing");
}

// Complete transactions emitted by the web prototype, including its actual
// browser refund signer. Chain entropy is the only mocked dependency here.
fn run_web_prototype_vector(index: usize, tamper: bool) -> Result<(), TxScriptError> {
    use std::str::FromStr;
    use kaspa_consensus_core::mass::MassCalculator;
    let fixture: serde_json::Value = serde_json::from_str(include_str!("giveaway_prize_v3_prototype_vectors.json")).unwrap();
    let vector = &fixture["vectors"][index];
    let json = &vector["transaction"];
    let input = &json["inputs"][0];
    let output = &json["outputs"][0];
    let bytes = |hex: &str| {
        let mut result = vec![0u8; hex.len() / 2];
        faster_hex::hex_decode(hex.as_bytes(), &mut result).unwrap(); result
    };
    let spk = |value: &serde_json::Value| {
        let encoded = bytes(value.as_str().unwrap());
        ScriptPublicKey::new(u16::from_be_bytes([encoded[0], encoded[1]]), encoded[2..].to_vec().into())
    };
    let number = |value: &serde_json::Value| value.as_str().unwrap().parse::<u64>().unwrap();
    let mut tx = Transaction::new(1, vec![TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: Hash::from_str(input["transactionId"].as_str().unwrap()).unwrap(), index: input["index"].as_u64().unwrap() as u32 },
        bytes(input["signatureScript"].as_str().unwrap()), number(&input["sequence"]), input["computeBudget"].as_u64().unwrap() as u16,
    )], vec![TransactionOutput { value: number(&output["value"]), script_public_key: spk(&output["scriptPublicKey"]), covenant: None }],
        number(&json["lockTime"]), Default::default(), 0, vec![]);
    let utxo = UtxoEntry::new(number(&input["utxo"]["amount"]), spk(&input["utxo"]["scriptPublicKey"]), number(&input["utxo"]["blockDaaScore"]), false, None);
    let masses = MassCalculator::new(1, 10, 1_000_000_000_000).calc_non_contextual_masses(&tx);
    let fee_floor = masses.compute_mass.max(masses.transient_mass / 2) * 100;
    assert_eq!(fee_floor, number(&vector["minimumFeeSompi"]), "web fee calculation matches consensus");
    assert!(utxo.amount - tx.outputs[0].value >= fee_floor);
    assert!(masses.compute_mass <= 500_000 && masses.transient_mass <= 1_000_000);
    if tamper { tx.outputs[0].value -= 1; }
    let chain = MockChain { block: Hash::from_bytes(ENTROPY_BLOCK), commitment: Hash::from_bytes(ENTROPY_SEED) };
    let populated = PopulatedTransaction::new(&tx, vec![utxo.clone()]);
    let cov_ctx = CovenantsContext::from_tx(&populated).unwrap();
    let cache = Cache::new(100);
    let reused = SigHashReusedValuesUnsync::new();
    let ctx = EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov_ctx).with_seq_commit_accessor(&chain);
    TxScriptEngine::from_transaction_input(&populated, &tx.inputs[0], 0, &utxo, ctx,
        EngineFlags { covenants_enabled: true, ..Default::default() }).execute()
}

#[test]
fn web_prototype_freeze_passes_engine_and_mass_checks() { run_web_prototype_vector(0, false).unwrap(); }
#[test]
fn web_prototype_draw_passes_engine_and_mass_checks() { run_web_prototype_vector(1, false).unwrap(); }
#[test]
fn web_prototype_open_refund_passes_engine_and_mass_checks() { run_web_prototype_vector(2, false).unwrap(); }
#[test]
fn web_prototype_frozen_refund_passes_engine_and_mass_checks() { run_web_prototype_vector(3, false).unwrap(); }
#[test]
fn web_prototype_rejects_tampered_output_in_all_branches() {
    for index in 0..4 { assert!(run_web_prototype_vector(index, true).is_err()); }
}
