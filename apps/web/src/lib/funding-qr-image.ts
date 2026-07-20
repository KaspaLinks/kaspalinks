"use client";

import { useEffect, useState } from "react";

type FundingQrPathInput = {
  amountKas: string;
  label: string;
  recipientAddress: string;
};

type FundingQrImageState = {
  error: boolean;
  loading: boolean;
  url: string;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export function pngBytesToDataUrl(bytes: Uint8Array): string {
  if (
    bytes.length <= PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((expected, index) => bytes[index] !== expected)
  ) {
    throw new Error("QR endpoint did not return a PNG image.");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export function buildFundingQrPath({
  amountKas,
  label,
  recipientAddress,
}: FundingQrPathInput): string {
  const searchParams = new URLSearchParams({
    amountKas,
    format: "png",
    label,
    recipientAddress,
    size: "512",
  });
  return `/api/toccata-lab/qr?${searchParams.toString()}`;
}

export function useFundingQrImage(requestPath: string): FundingQrImageState {
  const [state, setState] = useState<FundingQrImageState>({
    error: false,
    loading: false,
    url: "",
  });

  useEffect(() => {
    if (!requestPath) {
      setState({ error: false, loading: false, url: "" });
      return;
    }

    const abortController = new AbortController();
    setState({ error: false, loading: true, url: "" });

    void (async () => {
      try {
        const response = await fetch(requestPath, {
          cache: "no-store",
          headers: { Accept: "image/png" },
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error(`QR endpoint returned ${response.status}.`);

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (abortController.signal.aborted) return;
        setState({ error: false, loading: false, url: pngBytesToDataUrl(bytes) });
      } catch {
        if (abortController.signal.aborted) return;
        setState({ error: true, loading: false, url: "" });
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [requestPath]);

  return state;
}
