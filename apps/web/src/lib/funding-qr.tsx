"use client";

import React from "react";
import { create as createQrCode } from "qrcode";

export type FundingQrMatrix = {
  path: string;
  viewBoxSize: number;
};

const QUIET_ZONE_MODULES = 4;

export function createFundingQrMatrix(paymentUri: string): FundingQrMatrix {
  if (!paymentUri.trim()) throw new Error("Funding payment URI is missing.");

  const qrCode = createQrCode(paymentUri, { errorCorrectionLevel: "M" });
  const { modules } = qrCode;
  const path: string[] = [];

  for (let row = 0; row < modules.size; row += 1) {
    let column = 0;

    while (column < modules.size) {
      if (!modules.get(row, column)) {
        column += 1;
        continue;
      }

      const runStart = column;
      while (column < modules.size && modules.get(row, column)) column += 1;

      path.push(
        `M${runStart + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}` +
          `h${column - runStart}v1H${runStart + QUIET_ZONE_MODULES}z`,
      );
    }
  }

  return {
    path: path.join(""),
    viewBoxSize: modules.size + QUIET_ZONE_MODULES * 2,
  };
}

type FundingQrCodeProps = {
  ariaLabel: string;
  paymentUri: string;
};

export function FundingQrCode({ ariaLabel, paymentUri }: FundingQrCodeProps) {
  const matrix = React.useMemo(() => {
    try {
      return createFundingQrMatrix(paymentUri);
    } catch {
      return null;
    }
  }, [paymentUri]);

  if (!matrix) {
    return (
      <div className="notice notice-warn" role="status">
        QR code could not be created. Open Kaspium or copy the address instead.
      </div>
    );
  }

  return (
    <svg
      aria-label={ariaLabel}
      className="funding-qr-svg"
      focusable="false"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${matrix.viewBoxSize} ${matrix.viewBoxSize}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{ariaLabel}</title>
      <rect fill="#ffffff" height={matrix.viewBoxSize} width={matrix.viewBoxSize} />
      <path d={matrix.path} fill="#07181b" />
    </svg>
  );
}
