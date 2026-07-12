"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  connectKaswareWallet,
  disconnectKaswareWallet,
  getKaswareProvider,
  normalizeKaswareBalance,
  normalizeKaswareNetwork,
  onKaswareEvent,
  readKaswareAccounts,
  readKaswareBalance,
  readKaswareNetwork,
  type KaspaWalletNetwork,
  type KaswareBalance,
  type KaswareProvider,
} from "@kaspa-actions/wallet-adapter";

import type { PublicActionMetadata } from "@/lib/action-serializer";

type WalletConnectCardProps = {
  expectedNetwork: PublicActionMetadata["network"];
  onStateChange?: (state: WalletConnectionSnapshot) => void;
};

type WalletState = {
  accounts: string[];
  balance: KaswareBalance | null;
  checked: boolean;
  connecting: boolean;
  disconnecting: boolean;
  error: null | string;
  installed: boolean;
  isTouchOnly: boolean;
  network: KaspaWalletNetwork;
  notice: null | string;
};

export type WalletConnectionSnapshot = {
  account: null | string;
  checked: boolean;
  connected: boolean;
  installed: boolean;
  isTouchOnly: boolean;
  network: KaspaWalletNetwork;
};

const INITIAL_WALLET_STATE: WalletState = {
  accounts: [],
  balance: null,
  checked: false,
  connecting: false,
  disconnecting: false,
  error: null,
  installed: false,
  isTouchOnly: false,
  network: "unknown",
  notice: null,
};

const SOMPI_PER_KAS = 100_000_000n;

export function WalletConnectCard({ expectedNetwork, onStateChange }: WalletConnectCardProps) {
  const [wallet, setWallet] = useState<WalletState>(INITIAL_WALLET_STATE);

  const refreshPassiveState = useCallback(async (provider: KaswareProvider) => {
    const [accounts, network, balance] = await Promise.all([
      readKaswareAccounts(provider).catch(() => []),
      readKaswareNetwork(provider).catch(() => "unknown" as const),
      readKaswareBalance(provider).catch(() => null),
    ]);

    setWallet((current) => ({
      ...current,
      accounts,
      balance,
      checked: true,
      error: null,
      installed: true,
      network,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanupAccounts: () => void = () => {};
    let cleanupNetwork: () => void = () => {};
    let cleanupBalance: () => void = () => {};

    // Detect touch-only devices once: KasWare is a desktop browser extension,
    // so on phones / tablets we want to hide the card entirely instead of
    // showing a permanent "NOT DETECTED" state.
    const isTouchOnly =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    setWallet((current) => ({ ...current, isTouchOnly }));

    const attach = (provider: KaswareProvider) => {
      setWallet((current) => ({
        ...current,
        checked: true,
        installed: true,
      }));

      void refreshPassiveState(provider);

      cleanupAccounts = onKaswareEvent(provider, "accountsChanged", (payload) => {
        setWallet((current) => ({
          ...current,
          accounts: Array.isArray(payload)
            ? payload
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter((item) => item.length > 0 && !/\s/.test(item))
            : [],
        }));
      });
      cleanupNetwork = onKaswareEvent(provider, "networkChanged", (payload) => {
        setWallet((current) => ({
          ...current,
          network: normalizeKaswareNetwork(payload),
        }));
      });
      cleanupBalance = onKaswareEvent(provider, "balanceChanged", (payload) => {
        setWallet((current) => ({
          ...current,
          balance: normalizeKaswareBalance(payload) ?? current.balance,
        }));
      });
    };

    const poll = () => {
      if (cancelled) return;
      const provider = getKaswareProvider();
      if (provider) {
        attach(provider);
        return;
      }
      attempts += 1;
      // Try for ~4s total: 0ms, 250ms, 500ms, 750ms, 1000ms, 1500ms, 2000ms, 3000ms, 4000ms
      if (attempts >= 9) {
        setWallet((current) => ({
          ...current,
          checked: true,
          installed: false,
        }));
        return;
      }
      const delays = [250, 250, 250, 250, 500, 500, 1000, 1000];
      pollTimer = setTimeout(poll, delays[attempts - 1] ?? 1000);
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      cleanupAccounts();
      cleanupNetwork();
      cleanupBalance();
    };
  }, [refreshPassiveState]);

  const connect = useCallback(async () => {
    const provider = getKaswareProvider();

    if (!provider) {
      setWallet((current) => ({
        ...current,
        checked: true,
        error:
          "KasWare was not detected. Make sure the extension is installed and unlocked, then reload the page.",
        installed: false,
      }));
      return;
    }

    setWallet((current) => ({
      ...current,
      connecting: true,
      error: null,
      installed: true,
      notice: null,
    }));

    try {
      const connection = await connectKaswareWallet(provider);
      setWallet((current) => ({
        ...current,
        accounts: connection.accounts,
        balance: connection.balance,
        checked: true,
        connecting: false,
        installed: true,
        network: connection.network,
      }));
    } catch {
      setWallet((current) => ({
        ...current,
        connecting: false,
        error: "Could not connect KasWare. No payment was sent or signed.",
      }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    const provider = getKaswareProvider();
    setWallet((current) => ({
      ...current,
      disconnecting: true,
      error: null,
      notice: null,
    }));

    let providerDisconnected = false;
    if (provider) {
      const result = await disconnectKaswareWallet(provider);
      providerDisconnected = result.providerDisconnected;
    }

    setWallet((current) => ({
      ...current,
      accounts: [],
      balance: null,
      disconnecting: false,
      network: "unknown",
      notice: providerDisconnected
        ? "Disconnected from KasWare for this site."
        : "Cleared the local wallet state. To fully revoke the site permission, open the KasWare extension menu and remove this site under “Connected sites”.",
    }));
  }, []);

  const connectedAccount = wallet.accounts[0] ?? null;
  const networkMessage = useMemo(
    () => (wallet.installed ? getNetworkMessage(expectedNetwork, wallet.network) : null),
    [expectedNetwork, wallet.installed, wallet.network],
  );
  const connected = connectedAccount !== null;
  const walletStatus = !wallet.checked ? "CHECKING" : connected ? "CONNECTED" : "DISCONNECTED";
  const walletStatusClass = !wallet.checked
    ? "status-pill status-pending"
    : connected
      ? "status-pill status-confirmed"
      : "status-pill status-failed";

  useEffect(() => {
    onStateChange?.({
      account: connectedAccount,
      checked: wallet.checked,
      connected,
      installed: wallet.installed,
      isTouchOnly: wallet.isTouchOnly,
      network: wallet.network,
    });
  }, [
    connected,
    connectedAccount,
    onStateChange,
    wallet.checked,
    wallet.installed,
    wallet.isTouchOnly,
    wallet.network,
  ]);

  // On touch-only devices (phones / most tablets) KasWare is not available.
  // Hide the card entirely once detection completed so mobile supporters get a
  // clean QR + "Open in wallet" flow without a useless desktop wallet panel.
  if (wallet.checked && wallet.isTouchOnly) {
    return null;
  }

  return (
    <section className="card wallet-card hide-on-touch">
      <span className="label">Wallet adapter</span>
      <div className="wallet-card-header">
        <h2>KasWare connect</h2>
        <span className={walletStatusClass}>{walletStatus}</span>
      </div>
      <p className="muted">
        Connect is client-only. Sending happens only from the explicit Pay with KasWare button.
        Kaspa Links does not request seed phrases, private keys, server signing, or custodial
        access.
      </p>

      {connectedAccount ? (
        <div className="wallet-grid">
          <div>
            <span className="label">Connected account</span>
            <p className="value-mono">{connectedAccount}</p>
          </div>
          <div>
            <span className="label">Wallet network</span>
            <p className="wallet-value">{wallet.network}</p>
          </div>
          {wallet.balance ? (
            <div>
              <span className="label">Wallet balance</span>
              <p className="wallet-value">{formatWalletBalance(wallet.balance.total)}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">
          {!wallet.checked
            ? "Checking for KasWare in this browser."
            : wallet.installed
              ? "KasWare is available. Connect to show the selected account and network before using the wallet link."
              : "KasWare is not available in this browser. QR, copy, and open-wallet URI flows still work."}
        </p>
      )}

      {networkMessage ? <p className={networkMessage.className}>{networkMessage.text}</p> : null}
      {wallet.error ? <p className="error-text">{wallet.error}</p> : null}
      {wallet.notice ? <p className="muted">{wallet.notice}</p> : null}

      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={wallet.connecting || wallet.disconnecting}
          onClick={connect}
        >
          {wallet.connecting
            ? "Connecting..."
            : connectedAccount
              ? "Reconnect KasWare"
              : "Connect KasWare"}
        </button>
        {connectedAccount ? (
          <button
            type="button"
            className="btn"
            disabled={wallet.connecting || wallet.disconnecting}
            onClick={disconnect}
          >
            {wallet.disconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function formatWalletBalance(totalSompi: string): string {
  if (!/^\d+$/.test(totalSompi)) {
    return `${totalSompi} sompi`;
  }

  const sompi = BigInt(totalSompi);
  const wholePart = sompi / SOMPI_PER_KAS;
  const decimalPart = sompi % SOMPI_PER_KAS;

  if (decimalPart === 0n) {
    return `${wholePart} KAS`;
  }

  return `${wholePart}.${decimalPart.toString().padStart(8, "0").replace(/0+$/, "")} KAS`;
}

function getNetworkMessage(
  expectedNetwork: PublicActionMetadata["network"],
  walletNetwork: KaspaWalletNetwork,
): null | { className: string; text: string } {
  if (walletNetwork === "unknown") {
    return {
      className: "muted",
      text: "Wallet network could not be verified. Check it manually before paying.",
    };
  }

  if (walletNetwork !== expectedNetwork) {
    return {
      className: "error-text",
      text: `Wallet network is ${walletNetwork}, but this Action expects ${expectedNetwork}.`,
    };
  }

  return {
    className: "success-text",
    text: `Wallet network matches this ${expectedNetwork} Action.`,
  };
}
