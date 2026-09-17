// Engine-Tests fuer das Escrow-Covenant V1 (docs/escrow-covenant-v1.md).
//
// Usage: copy this file plus `escrow_v1.sil` to `silverscript-lang/tests/`
// inside the pinned kaspanet/silverscript checkout, then:
//
//   cargo test -p silverscript-lang --test escrow_v1_tests
//
// Die Tests fahren die echte TxScriptEngine mit covenants_enabled. Jeder
// Auszahlungsweg wird einmal gueltig und mehrfach manipuliert ausgefuehrt.
// Ausgabemanipulationen passieren vor dem Signieren, damit die Signatur gueltig
// bleibt und wirklich die Ausgabebindung des Scripts geprueft wird.
// Gebuehren, Masse und ein finanzierter Durchlauf bleiben separat.

mod common;

use common::{bytecode, compile_contract, compiled_template_parts_and_hash, encode_entry_sig_script};
use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId,
    TransactionInput, TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{
    EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script,
    pay_to_script_hash_signature_script_with_flags,
};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use silverscript_abi::ArtifactValue;
use silverscript_lang::compiler::CompileOptions;

const SOURCE: &str = include_str!("escrow_v1.sil");

const AMOUNT: u64 = 100_000_000;
const FEE: u64 = 20_000;
const FUNDING: u64 = AMOUNT + FEE;
const RELEASE_DAA: u64 = 200_000_000;
const COMPUTE_BUDGET: u16 = 2_000;

const ACTIVE: u8 = 0x00;
const FROZEN: u8 = 0x01;

fn digest32(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Acht Byte little-endian mit freiem Vorzeichenbit, damit `OpBin2Num` den Wert
/// als nicht-negative Zahl liest.
fn u64le(value: u64) -> [u8; 8] {
    assert!(value < 1 << 55, "Wert muss mit freiem Vorzeichenbit kodierbar sein");
    value.to_le_bytes()
}

fn fixed_keypair(seed: u8) -> Keypair {
    let secp = Secp256k1::new();
    let secret = SecretKey::from_slice(&[seed; 32]).expect("valid secret key");
    Keypair::from_secret_key(&secp, &secret)
}

/// Auszahlungsziel. Das Contract committet auf sha256(spk), damit sowohl P2PK-
/// als auch P2SH-Adressen passen.
fn payout_spk(tag: u8) -> ScriptPublicKey {
    ScriptPublicKey::new(0, vec![0x51, 0x60 + tag].into())
}

fn serialized_spk(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut out = vec![0u8, 0u8];
    out.extend_from_slice(spk.script().as_ref());
    out
}

/// `paramsHash = sha256(amount ‖ fee ‖ releaseAfter ‖ buyerPk ‖ sellerPk
///                      ‖ buyerSpkHash ‖ sellerSpkHash)`
fn params_hash(amount: u64, buyer_pk: &[u8; 32], seller_pk: &[u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&u64le(amount));
    preimage.extend_from_slice(&u64le(FEE));
    preimage.extend_from_slice(&u64le(RELEASE_DAA));
    preimage.extend_from_slice(buyer_pk);
    preimage.extend_from_slice(seller_pk);
    preimage.extend_from_slice(&digest32(&serialized_spk(&payout_spk(1))));
    preimage.extend_from_slice(&digest32(&serialized_spk(&payout_spk(2))));
    digest32(&preimage)
}

fn state(tag: u8, params: &[u8; 32]) -> [u8; 32] {
    let mut preimage = vec![tag];
    preimage.extend_from_slice(params);
    digest32(&preimage)
}

fn compile_escrow(init_state: [u8; 32]) -> silverscript_abi::SilAbiArtifact {
    compile_contract(
        SOURCE,
        &[ArtifactValue::Bytes(init_state.to_vec())],
        CompileOptions::default(),
    )
    .expect("escrow_v1.sil compiles")
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

/// Die sieben Deal-Parameter, wie sie jeder Zweig im Witness erwartet.
fn param_args(amount: u64, buyer_pk: &[u8; 32], seller_pk: &[u8; 32]) -> Vec<ArtifactValue> {
    vec![
        ArtifactValue::Bytes(u64le(amount).to_vec()),
        ArtifactValue::Bytes(u64le(FEE).to_vec()),
        ArtifactValue::Bytes(u64le(RELEASE_DAA).to_vec()),
        ArtifactValue::Bytes(buyer_pk.to_vec()),
        ArtifactValue::Bytes(seller_pk.to_vec()),
        ArtifactValue::Bytes(digest32(&serialized_spk(&payout_spk(1))).to_vec()),
        ArtifactValue::Bytes(digest32(&serialized_spk(&payout_spk(2))).to_vec()),
    ]
}

#[derive(Clone, Copy, PartialEq)]
enum Mutation {
    None,
    /// Auszahlung an die andere Partei.
    WrongRecipient,
    /// Betrag abweichend.
    WrongAmount,
    /// Zusaetzliche Ausgabe neben der Auszahlung.
    ExtraOutput,
    /// Signatur von einem fremden Schluessel.
    WrongSigner,
    /// Zeitschranke noch nicht erreicht.
    TooEarly,
    /// Eingabe liegt im eingefrorenen Zustand.
    FromFrozen,
    /// Witness-Parameter passen nicht zum finanzierten Zustand.
    ForgedParams,
    /// Einigung mit nur einer echten Signatur.
    SingleSignature,
    /// Einfrieren, das den Zustand ACTIVE beibehaelt.
    FreezeKeepsActive,
    /// Einfrieren in ein fremdes Script.
    FreezeForeignTemplate,
    /// Einigung, obwohl die Eingabe noch aktiv ist.
    SettleInActive,
}

fn run(mode: &str, mutation: Mutation) -> Result<(), TxScriptError> {
    let buyer = fixed_keypair(0x21);
    let seller = fixed_keypair(0x22);
    let impostor = fixed_keypair(0x33);
    let buyer_pk = buyer.x_only_public_key().0.serialize();
    let seller_pk = seller.x_only_public_key().0.serialize();

    let params = params_hash(AMOUNT, &buyer_pk, &seller_pk);
    let active = state(ACTIVE, &params);
    let frozen = state(FROZEN, &params);

    let frozen_input = (mode == "settle" && mutation != Mutation::SettleInActive)
        || mutation == Mutation::FromFrozen;
    let init_state = if frozen_input { frozen } else { active };
    let artifact = compile_escrow(init_state);
    let redeem_script = bytecode(&artifact);
    let funding_spk = pay_to_script_hash_script(&redeem_script);
    let funding_value = if frozen_input { AMOUNT } else { FUNDING };

    let buyer_spk = payout_spk(1);
    let seller_spk = payout_spk(2);

    let mut outputs = match mode {
        "release" | "claim" => {
            let target = if mutation == Mutation::WrongRecipient {
                buyer_spk.clone()
            } else {
                seller_spk.clone()
            };
            vec![TransactionOutput { value: AMOUNT, script_public_key: target, covenant: None }]
        }
        "refund" => {
            let target = if mutation == Mutation::WrongRecipient {
                seller_spk.clone()
            } else {
                buyer_spk.clone()
            };
            // Im eingefrorenen Zustand traegt die Eingabe nur noch AMOUNT, also
            // bleibt eine Gebuehr weniger uebrig.
            let value = if frozen_input { AMOUNT - FEE } else { AMOUNT };
            vec![TransactionOutput { value, script_public_key: target, covenant: None }]
        }
        "freeze" => {
            let script = match mutation {
                Mutation::FreezeKeepsActive => bytecode_with_state(&artifact, &active),
                Mutation::FreezeForeignTemplate => vec![0x51],
                _ => bytecode_with_state(&artifact, &frozen),
            };
            vec![TransactionOutput {
                value: AMOUNT,
                script_public_key: ScriptPublicKey::new(
                    0,
                    pay_to_script_hash_script(&script).script().to_vec().into(),
                ),
                covenant: None,
            }]
        }
        "settle" => {
            let buyer_share = 40_000_000;
            vec![
                TransactionOutput {
                    value: buyer_share,
                    script_public_key: buyer_spk.clone(),
                    covenant: None,
                },
                TransactionOutput {
                    value: AMOUNT - FEE - buyer_share,
                    script_public_key: seller_spk.clone(),
                    covenant: None,
                },
            ]
        }
        other => panic!("unknown mode {other}"),
    };

    if mutation == Mutation::WrongAmount {
        outputs[0].value -= 1;
    }
    if mutation == Mutation::ExtraOutput {
        outputs.push(TransactionOutput {
            value: 1_000,
            script_public_key: payout_spk(3),
            covenant: None,
        });
    }

    let lock_time: u64 = match (mode, mutation) {
        ("claim", Mutation::TooEarly) => RELEASE_DAA - 1,
        ("claim", _) => RELEASE_DAA,
        _ => 0,
    };

    let budget: u16 = std::env::var("ESCROW_COMPUTE_BUDGET")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(COMPUTE_BUDGET);
    let input = TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([7u8; 32]), index: 0 },
        vec![],
        0,
        budget,
    );
    let tx = Transaction::new(1, vec![input], outputs, lock_time, Default::default(), 0, vec![]);
    let utxo_entry = UtxoEntry::new(funding_value, funding_spk, 0, false, None);
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo_entry.clone()]);

    // Transaktionssignaturen deckend die Ausgaben, deshalb erst hier signieren.
    let reused = SigHashReusedValuesUnsync::new();
    let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &reused);
    let message =
        secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).expect("32 bytes");
    let sign = |keypair: &Keypair| {
        let mut encoded = keypair.sign_schnorr(message).as_ref().to_vec();
        encoded.push(SIG_HASH_ALL.to_u8());
        ArtifactValue::Bytes(encoded)
    };

    let witness_amount =
        if mutation == Mutation::ForgedParams { AMOUNT + 1 } else { AMOUNT };
    let params_witness = param_args(witness_amount, &buyer_pk, &seller_pk);

    let buyer_signer = if mutation == Mutation::WrongSigner && (mode == "release" || mode == "freeze")
    {
        &impostor
    } else {
        &buyer
    };
    let seller_signer =
        if mutation == Mutation::WrongSigner && (mode == "refund" || mode == "claim") {
            &impostor
        } else {
            &seller
        };

    let mut witness: Vec<ArtifactValue> = match mode {
        "release" | "freeze" => vec![sign(buyer_signer)],
        "refund" | "claim" => vec![sign(seller_signer)],
        "settle" => {
            let second = if mutation == Mutation::SingleSignature { &impostor } else { &seller };
            vec![sign(&buyer), sign(second)]
        }
        other => panic!("unknown mode {other}"),
    };
    witness.extend(params_witness);

    match mode {
        "release" | "claim" => {
            witness.push(ArtifactValue::Bytes(serialized_spk(&seller_spk)));
        }
        "refund" => {
            witness.push(ArtifactValue::Bytes(vec![if frozen_input { FROZEN } else { ACTIVE }]));
            witness.push(ArtifactValue::Bytes(serialized_spk(&buyer_spk)));
        }
        _ => {}
    }

    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };
    let inner = encode_entry_sig_script(&artifact, mode, &witness).expect("witness encodes");
    let redeem_len = redeem_script.len();
    let inner_len = inner.len();
    tx.tx.inputs[0].signature_script =
        pay_to_script_hash_signature_script_with_flags(redeem_script, inner, flags)
            .expect("p2sh sigscript builds");
    if std::env::var("ESCROW_REPORT_SIZES").is_ok() {
        println!(
            "{mode}: redeem {redeem_len} B, witness {inner_len} B, signature script {} B, budget {budget}",
            tx.tx.inputs[0].signature_script.len()
        );
    }

    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(&tx.tx, vec![utxo_entry.clone()]);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("covenants context");
    let ctx = EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx);

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
fn release_pays_the_seller() {
    run("release", Mutation::None).expect("Freigabe durch den Kaeufer zahlt an den Verkaeufer");
}

#[test]
fn refund_returns_the_payment_to_the_buyer() {
    run("refund", Mutation::None).expect("Erstattung durch den Verkaeufer geht an den Kaeufer");
}

#[test]
fn refund_from_a_frozen_escrow_returns_the_remainder() {
    run("refund", Mutation::FromFrozen)
        .expect("Erstattung im eingefrorenen Zustand zahlt amount - fee");
}

#[test]
fn claim_pays_the_seller_after_the_deadline() {
    run("claim", Mutation::None).expect("Auszahlung nach Ablauf der Frist wird akzeptiert");
}

#[test]
fn freeze_moves_the_escrow_into_the_frozen_state() {
    run("freeze", Mutation::None).expect("Einfrieren in denselben Covenant wird akzeptiert");
}

#[test]
fn settle_pays_out_when_both_parties_sign() {
    run("settle", Mutation::None).expect("Einigung mit beiden Signaturen wird akzeptiert");
}

/// Das Contract ist groesser als die alte 520-Byte-Grenze. Post-Toccata gilt
/// 1 MB; der Test fuehrt es aus statt sich auf die Konstante zu verlassen.
#[test]
fn redeem_script_exceeds_the_legacy_520_byte_limit() {
    let script_len = bytecode(&compile_escrow([0x33; 32])).len();
    assert!(script_len > 520, "Contract ist {script_len} Byte, der Test braucht >520");
    run("release", Mutation::None).expect("ein >520-Byte-P2SH-Script laeuft mit Covenants");
}

// ---------------------------------------------------------------- Negativfaelle

#[test]
fn release_rejects_a_payout_to_the_buyer() {
    run("release", Mutation::WrongRecipient)
        .expect_err("der Kaeufer darf die Zahlung nicht zu sich umlenken");
}

#[test]
fn release_rejects_a_short_payout() {
    run("release", Mutation::WrongAmount).expect_err("abweichender Betrag muss scheitern");
}

#[test]
fn release_rejects_an_extra_output() {
    run("release", Mutation::ExtraOutput).expect_err("zusaetzliche Ausgabe muss scheitern");
}

#[test]
fn release_rejects_a_foreign_signature() {
    run("release", Mutation::WrongSigner)
        .expect_err("ohne Kaeufer-Signatur darf nicht freigegeben werden");
}

#[test]
fn refund_rejects_a_payout_to_the_seller() {
    run("refund", Mutation::WrongRecipient)
        .expect_err("der Verkaeufer darf die Erstattung nicht zu sich umlenken");
}

#[test]
fn refund_rejects_a_foreign_signature() {
    run("refund", Mutation::WrongSigner)
        .expect_err("ohne Verkaeufer-Signatur darf nicht erstattet werden");
}

#[test]
fn claim_rejects_a_spend_before_the_deadline() {
    run("claim", Mutation::TooEarly).expect_err("Auszahlung vor der Frist muss scheitern");
}

#[test]
fn claim_rejects_a_frozen_escrow() {
    run("claim", Mutation::FromFrozen)
        .expect_err("im eingefrorenen Zustand gibt es keine einseitige Auszahlung");
}

#[test]
fn claim_rejects_a_foreign_signature() {
    run("claim", Mutation::WrongSigner).expect_err("fremde Signatur darf nicht auszahlen");
}

#[test]
fn freeze_rejects_a_state_that_stays_active() {
    run("freeze", Mutation::FreezeKeepsActive)
        .expect_err("Einfrieren muss den Zustand wirklich aendern");
}

#[test]
fn freeze_rejects_a_foreign_covenant_template() {
    run("freeze", Mutation::FreezeForeignTemplate)
        .expect_err("Einfrieren in ein fremdes Script muss scheitern");
}

#[test]
fn freeze_rejects_a_short_output() {
    run("freeze", Mutation::WrongAmount)
        .expect_err("Einfrieren darf keinen Betrag abzweigen");
}

#[test]
fn freeze_rejects_an_extra_output() {
    run("freeze", Mutation::ExtraOutput)
        .expect_err("Einfrieren darf keine zweite Ausgabe erzeugen");
}

#[test]
fn freeze_rejects_a_foreign_signature() {
    run("freeze", Mutation::WrongSigner)
        .expect_err("nur der Kaeufer darf einfrieren");
}

#[test]
fn settle_rejects_a_single_signature() {
    run("settle", Mutation::SingleSignature)
        .expect_err("eine Einigung braucht beide Signaturen");
}

#[test]
fn settle_rejects_an_escrow_that_is_not_frozen() {
    run("settle", Mutation::SettleInActive)
        .expect_err("ohne Einfrieren gibt es keine gemeinsame Auszahlung");
}

#[test]
fn release_rejects_a_frozen_escrow() {
    run("release", Mutation::FromFrozen)
        .expect_err("im eingefrorenen Zustand gibt es keine einseitige Freigabe");
}

#[test]
fn freeze_rejects_an_already_frozen_escrow() {
    run("freeze", Mutation::FromFrozen).expect_err("zweimal einfrieren muss scheitern");
}

#[test]
fn every_path_rejects_forged_parameters() {
    for mode in ["release", "refund", "claim", "freeze", "settle"] {
        assert!(
            run(mode, Mutation::ForgedParams).is_err(),
            "{mode} darf gefaelschte Parameter nicht akzeptieren"
        );
    }
}

/// Misst, was ein ausgebender Wallet tragen muss. Mit
/// `ESCROW_REPORT_SIZES=1 cargo test ... -- --nocapture sizes` sichtbar.
#[test]
fn reports_script_and_witness_sizes() {
    unsafe { std::env::set_var("ESCROW_REPORT_SIZES", "1") };
    for mode in ["release", "refund", "claim", "freeze", "settle"] {
        run(mode, Mutation::None).unwrap_or_else(|err| panic!("{mode} laeuft: {err:?}"));
    }
    unsafe { std::env::remove_var("ESCROW_REPORT_SIZES") };
}
