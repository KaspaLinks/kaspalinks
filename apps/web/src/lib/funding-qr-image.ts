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
    let objectUrl = "";
    setState({ error: false, loading: true, url: "" });

    void (async () => {
      try {
        const response = await fetch(requestPath, {
          cache: "no-store",
          headers: { Accept: "image/png" },
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error(`QR endpoint returned ${response.status}.`);

        const blob = await response.blob();
        if (!blob.type.startsWith("image/"))
          throw new Error("QR endpoint did not return an image.");
        if (abortController.signal.aborted) return;

        objectUrl = URL.createObjectURL(blob);
        if (abortController.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          return;
        }
        setState({ error: false, loading: false, url: objectUrl });
      } catch {
        if (abortController.signal.aborted) return;
        setState({ error: true, loading: false, url: "" });
      }
    })();

    return () => {
      abortController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestPath]);

  return state;
}
