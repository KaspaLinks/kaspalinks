// ClaimableLink mainnet canary harness.
//
// Usage: copy to `silverscript-lang/examples/claimable_canary.rs` inside the
// pinned kaspanet/silverscript checkout, then:
//
//   cargo run -p silverscript-lang --example claimable_canary -- setup <name> <refund_after_daa>
//   cargo run -p silverscript-lang --example claimable_canary -- claim  <name> <txid> <index> <utxo_sompi> <dest_address> [fee_sompi]
//   cargo run -p silverscript-lang --example claimable_canary -- refund <name> <txid> <index> <utxo_sompi> <dest_address> [fee_sompi] <lock_time>
//
// `setup` generates fresh claim/refund keys, compiles the contract, and
// prints the mainnet P2SH funding address. `claim`/`refund` build the spend,
// run it through the real kaspa-txscript engine as a local pre-flight, and —
// only if that passes — print submit JSON for manual wRPC broadcast.
//
// Lab rules: tiny amounts only (the harness refuses outputs below the 0.2 KAS
// storage-mass floor), keys live in ./canary/<name>.env on the lab host only,
// and this tool never talks to the network itself — submission is an explicit
// separate operator step.

use std::env;
use std::fs;
use std::path::Path;
use std::str::FromStr;

use kaspa_addresses::{Address, Prefix};
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::hashing::sighash::calc_schnorr_signature_hash;
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    MutableTransaction, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput, UtxoEntry,
    VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::{
    EngineCtx, EngineFlags, TxScriptEngine, extract_script_pub_key_address, pay_to_address_script, pay_to_script_hash_script,
    pay_to_script_hash_signature_script_with_flags,
};
use rand::{RngCore, thread_rng};
use secp256k1::{Keypair, Secp256k1, SecretKey};
use silverscript_lang::compiler::{CompileOptions, compile_contract};

const MIN_OUTPUT_SOMPI: u64 = 20_000_000; // 0.2 KAS storage-mass floor
const MAX_UTXO_SOMPI: u64 = 100_000_000; // 1 KAS canary cap
const DEFAULT_FEE_SOMPI: u64 = 200_000;
const CLAIM_SCRIPT_UNITS_USED: u64 = 100_293;
const COMPUTE_BUDGET: u16 = 11;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("setup") if args.len() == 3 => setup(
            &args[1],
            args[2].parse().expect("refund_after_daa must be an integer"),
        ),
        Some("claim") if args.len() == 6 || args.len() == 7 => {
            let fee_sompi = args
                .get(6)
                .map(|value| value.parse().unwrap())
                .unwrap_or(DEFAULT_FEE_SOMPI);
            spend(
                "claim",
                &args[1],
                &args[2],
                args[3].parse().unwrap(),
                args[4].parse().unwrap(),
                &args[5],
                fee_sompi,
                0,
            )
        }
        Some("refund") if args.len() == 7 || args.len() == 8 => {
            let (fee_sompi, lock_time) = if args.len() == 8 {
                (args[6].parse().unwrap(), args[7].parse().unwrap())
            } else {
                (DEFAULT_FEE_SOMPI, args[6].parse().unwrap())
            };
            spend(
                "refund",
                &args[1],
                &args[2],
                args[3].parse().unwrap(),
                args[4].parse().unwrap(),
                &args[5],
                fee_sompi,
                lock_time,
            )
        }
        _ => {
            eprintln!("usage:");
            eprintln!("  setup  <name> <refund_after_daa>");
            eprintln!("  claim  <name> <txid> <index> <utxo_sompi> <dest_address> [fee_sompi]");
            eprintln!("  refund <name> <txid> <index> <utxo_sompi> <dest_address> [fee_sompi] <lock_time>");
            std::process::exit(2);
        }
    }
}

fn contract_source() -> String {
    let path = format!("{}/tests/examples/claimable_link.sil", env!("CARGO_MANIFEST_DIR"));
    fs::read_to_string(&path).unwrap_or_else(|err| panic!("failed to read {path}: {err}"))
}

fn random_keypair() -> Keypair {
    let secp = Secp256k1::new();
    let mut rng = thread_rng();
    let mut sk_bytes = [0u8; 32];
    loop {
        rng.fill_bytes(&mut sk_bytes);
        if let Ok(secret_key) = SecretKey::from_slice(&sk_bytes) {
            return Keypair::from_secret_key(&secp, &secret_key);
        }
    }
}

fn setup(name: &str, refund_after: i64) {
    let link = random_keypair();
    let refund = random_keypair();
    let link_pk = link.x_only_public_key().0.serialize();
    let refund_pk = refund.x_only_public_key().0.serialize();

    let source = contract_source();
    let constructor_args = vec![link_pk.to_vec().into(), refund_pk.to_vec().into(), refund_after.into()];
    let compiled = compile_contract(&source, &constructor_args, CompileOptions::default()).expect("compile succeeds");

    let spk = pay_to_script_hash_script(&compiled.script);
    let address = extract_script_pub_key_address(&spk, Prefix::Mainnet).expect("p2sh address derivable");

    fs::create_dir_all("canary").expect("create canary dir");
    let state_path = format!("canary/{name}.env");
    assert!(!Path::new(&state_path).exists(), "{state_path} already exists — refusing to overwrite keys");
    let state = format!(
        "link_sk={}\nrefund_sk={}\nlink_pk={}\nrefund_pk={}\nrefund_after={}\naddress={}\nscript={}\n",
        to_hex(&link.secret_bytes()),
        to_hex(&refund.secret_bytes()),
        to_hex(&link_pk),
        to_hex(&refund_pk),
        refund_after,
        address,
        to_hex(compiled.script.as_slice()),
    );
    fs::write(&state_path, state).expect("write state");

    println!("canary '{name}' ready");
    println!("  fund address (mainnet P2SH): {address}");
    println!("  refund unlocks at DAA score: {refund_after}");
    println!("  script bytes sha256 input:   {} bytes", compiled.script.len());
    println!("  state file:                  {state_path} (keys — lab only, tiny amounts)");
    println!("  fund with 0.25–0.5 KAS. Do NOT reuse this address after the canary.");
}

#[allow(clippy::too_many_arguments)]
fn spend(entrypoint: &str, name: &str, txid: &str, index: u32, utxo_sompi: u64, dest: &str, fee_sompi: u64, lock_time: u64) {
    let state = fs::read_to_string(format!("canary/{name}.env")).expect("state file exists — run setup first");
    let get = |key: &str| -> String {
        state
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{key}=")))
            .unwrap_or_else(|| panic!("missing {key} in state"))
            .to_string()
    };

    let secp = Secp256k1::new();
    let link = Keypair::from_secret_key(&secp, &SecretKey::from_slice(&from_hex(&get("link_sk"))).unwrap());
    let refund = Keypair::from_secret_key(&secp, &SecretKey::from_slice(&from_hex(&get("refund_sk"))).unwrap());
    let refund_after: i64 = get("refund_after").parse().unwrap();
    let signer = match entrypoint {
        "claim" => &link,
        "refund" => &refund,
        other => panic!("unknown entrypoint {other}"),
    };

    // Deterministic recompile from the stored constructor args.
    let link_pk = from_hex(&get("link_pk"));
    let refund_pk = from_hex(&get("refund_pk"));
    let constructor_args = vec![link_pk.into(), refund_pk.into(), refund_after.into()];
    let source = contract_source();
    let compiled = compile_contract(&source, &constructor_args, CompileOptions::default()).expect("compile succeeds");

    let spk = pay_to_script_hash_script(&compiled.script);
    let address = extract_script_pub_key_address(&spk, Prefix::Mainnet).expect("p2sh address derivable");
    assert_eq!(address.to_string(), get("address"), "recompiled script does not match stored address");

    // Canary guardrails.
    assert!(utxo_sompi <= MAX_UTXO_SOMPI, "canary cap: utxo must be <= 1 KAS");
    assert!(utxo_sompi > fee_sompi, "fee exceeds utxo");
    let output_value = utxo_sompi - fee_sompi;
    assert!(output_value >= MIN_OUTPUT_SOMPI, "output below 0.2 KAS storage-mass floor — increase funding or lower fee");
    // Mainnet reported this script at 100,293 script units. With the Toccata
    // v1 allowance formula, budget 11 allows 119,999 units while keeping the
    // required relay fee low enough for tiny canary outputs.
    let compute_budget = COMPUTE_BUDGET;
    let allowed_script_units = u64::from(compute_budget) * 10_000 + 9_999;

    let dest_address = Address::try_from(dest).expect("destination must be a valid kaspa: address");
    assert_eq!(dest_address.prefix, Prefix::Mainnet, "destination must be mainnet");
    let dest_spk = pay_to_address_script(&dest_address);

    let input = TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: TransactionId::from_str(txid).expect("txid hex"), index },
        vec![],
        0,
        compute_budget,
    );
    let output = TransactionOutput { value: output_value, script_public_key: dest_spk.clone(), covenant: None };

    let tx = Transaction::new(1, vec![input], vec![output], lock_time, Default::default(), 0, vec![]);
    let utxo_entry = UtxoEntry::new(utxo_sompi, spk.clone(), 0, false, None);
    let mut tx = MutableTransaction::with_entries(tx, vec![utxo_entry.clone()]);

    let signing_reused = SigHashReusedValuesUnsync::new();
    let sig_hash = calc_schnorr_signature_hash(&tx.as_verifiable(), 0, SIG_HASH_ALL, &signing_reused);
    let msg = secp256k1::Message::from_digest_slice(sig_hash.as_bytes().as_slice()).unwrap();
    let sig = signer.sign_schnorr(msg);
    let mut signature = Vec::new();
    signature.extend_from_slice(sig.as_ref().as_slice());
    signature.push(SIG_HASH_ALL.to_u8());

    let flags = EngineFlags { covenants_enabled: true, ..Default::default() };
    let inner = compiled.build_sig_script(entrypoint, vec![signature.into()]).expect("sigscript builds");
    let full_sigscript =
        pay_to_script_hash_signature_script_with_flags(compiled.script.clone(), inner, flags).expect("wrap p2sh sigscript");
    tx.tx.inputs[0].signature_script = full_sigscript.clone();

    // Local pre-flight on the real engine before anything is broadcast.
    let executing_reused = SigHashReusedValuesUnsync::new();
    let verifiable = tx.as_verifiable();
    let sig_cache = Cache::new(10_000);
    let mut vm = TxScriptEngine::from_transaction_input(
        &verifiable,
        &verifiable.inputs()[0],
        0,
        &utxo_entry,
        EngineCtx::new(&sig_cache).with_reused(&executing_reused),
        flags,
    );
    match vm.execute() {
        Ok(()) => {
            eprintln!("pre-flight: PASS ({entrypoint} spend executes on the v2.0.1 engine)");
            eprintln!("fee: {fee_sompi} sompi");
            eprintln!("net output: {output_value} sompi");
            eprintln!("compute budget: {compute_budget} ({CLAIM_SCRIPT_UNITS_USED}/{allowed_script_units} observed script units)");
        }
        Err(err) => {
            eprintln!("pre-flight: FAIL — {err}");
            eprintln!("not printing submit JSON. Fix the spend first.");
            std::process::exit(1);
        }
    }

    // REST submit payload for `POST https://api.kaspa.org/transactions`.
    let json = format!(
        concat!(
            "{{\"transaction\":{{\"version\":1,",
            "\"inputs\":[{{\"previousOutpoint\":{{\"transactionId\":\"{txid}\",\"index\":{index}}},",
            "\"signatureScript\":\"{sigscript}\",\"sequence\":0,\"computeBudget\":{compute_budget}}}],",
            "\"outputs\":[{{\"amount\":{amount},\"scriptPublicKey\":{{\"version\":{spk_version},\"scriptPublicKey\":\"{spk}\"}}}}],",
            "\"lockTime\":{lock_time},\"subnetworkId\":\"0000000000000000000000000000000000000000\"}},",
            "\"allowOrphan\":false}}"
        ),
        txid = txid,
        index = index,
        sigscript = to_hex(&full_sigscript),
        compute_budget = compute_budget,
        amount = output_value,
        spk_version = dest_spk.version(),
        spk = to_hex(dest_spk.script()),
        lock_time = lock_time,
    );
    println!("{json}");
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex length");
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex")).collect()
}
