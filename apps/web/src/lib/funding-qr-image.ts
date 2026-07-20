"use client";

import { useEffect, useState } from "react";

type FundingQrImageState = {
  error: boolean;
  loading: boolean;
  url: string;
};

export async function createFundingQrDataUrl(paymentUri: string): Promise<string> {
  if (!paymentUri.trim()) throw new Error("Funding payment URI is missing.");

  const QRCode = await import("qrcode");
  return QRCode.toDataURL(paymentUri, {
    color: { dark: "#07181b", light: "#ffffff" },
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });
}

export function useFundingQrImage(paymentUri: string): FundingQrImageState {
  const [state, setState] = useState<FundingQrImageState>({
    error: false,
    loading: false,
    url: "",
  });

  useEffect(() => {
    if (!paymentUri) {
      setState({ error: false, loading: false, url: "" });
      return;
    }

    let cancelled = false;
    setState({ error: false, loading: true, url: "" });

    void createFundingQrDataUrl(paymentUri)
      .then((url) => {
        if (!cancelled) setState({ error: false, loading: false, url });
      })
      .catch(() => {
        if (!cancelled) setState({ error: true, loading: false, url: "" });
      });

    return () => {
      cancelled = true;
    };
  }, [paymentUri]);

  return state;
}
