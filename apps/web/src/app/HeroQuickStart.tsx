"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { KASPA_ADDRESS_INPUT_PROPS } from "@/lib/kaspa-address-input";

import { QUICK_RECIPIENT_STORAGE_KEY } from "./new-link/quick-recipient";
import { validateRecipientAddress } from "./new-link/helpers";

/**
 * "Your tip link in 10 seconds": paste an address, land in a filled-in tip
 * form. The address travels in sessionStorage, not the URL, so it never ends
 * up in server logs.
 */
export function HeroQuickStart() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const check = validateRecipientAddress(address);
    if (check.state !== "valid") {
      setProblem(
        check.state === "invalid"
          ? check.reason
          : "Paste your Kaspa address, it starts with kaspa:",
      );
      return;
    }
    try {
      window.sessionStorage.setItem(QUICK_RECIPIENT_STORAGE_KEY, address.trim());
    } catch {
      // Without storage the form simply opens empty.
    }
    router.push("/new-link?start=paid&kind=any");
  }

  return (
    <form className="hero-quick" onSubmit={submit}>
      <label className="hero-quick-label" htmlFor="hero-quick-address">
        Your tip link in 10 seconds
      </label>
      <div className="hero-quick-row">
        <input
          id="hero-quick-address"
          {...KASPA_ADDRESS_INPUT_PROPS}
          onChange={(event) => {
            setAddress(event.target.value);
            setProblem("");
          }}
          placeholder="Paste your kaspa: address"
          value={address}
        />
        <button className="btn btn-primary" type="submit">
          Create my tip link
        </button>
      </div>
      {problem ? <p className="hero-quick-problem">{problem}</p> : null}
    </form>
  );
}
