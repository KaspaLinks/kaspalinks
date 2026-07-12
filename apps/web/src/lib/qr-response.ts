import QRCode from "qrcode";
import { z } from "zod";

import { apiError, ErrorCodes } from "./errors";

const QR_SIZES = new Set([512, 1024, 2048]);

const qrOptionsSchema = z.object({
  format: z.enum(["png", "svg"]).default("svg"),
  size: z
    .string()
    .default("1024")
    .refine((value) => /^\d+$/.test(value), { message: "size must be numeric." })
    .transform((value) => Number(value))
    .refine((value) => QR_SIZES.has(value), {
      message: "size must be one of 512, 1024, or 2048.",
    }),
});

type QrOptions = z.infer<typeof qrOptionsSchema>;

export function parseQrOptions(request: Request): { options: QrOptions } | { response: Response } {
  const url = new URL(request.url);
  const parsed = qrOptionsSchema.safeParse({
    format: url.searchParams.get("format") ?? undefined,
    size: url.searchParams.get("size") ?? undefined,
  });

  if (!parsed.success) {
    return {
      response: apiError(
        ErrorCodes.INVALID_BODY,
        parsed.error.issues[0]?.message ?? "Invalid QR options.",
        400,
      ),
    };
  }

  return { options: parsed.data };
}

function safeFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function qrImageResponse(input: {
  filenameBase: string;
  options: QrOptions;
  targetUrl: string;
}): Promise<Response> {
  const filenameBase = safeFilename(input.filenameBase) || "kaspa-links-qr";
  const filename = `${filenameBase}.${input.options.format}`;
  const headers = {
    "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
    "Content-Disposition": `inline; filename="${filename}"`,
  };

  const qrOptions = {
    color: {
      dark: "#061014",
      light: "#ffffff",
    },
    errorCorrectionLevel: "H" as const,
    margin: 2,
    width: input.options.size,
  };

  if (input.options.format === "png") {
    const png = await QRCode.toBuffer(input.targetUrl, { ...qrOptions, type: "png" });
    return new Response(new Uint8Array(png), {
      headers: {
        ...headers,
        "Content-Type": "image/png",
      },
    });
  }

  const svg = await QRCode.toString(input.targetUrl, { ...qrOptions, type: "svg" });
  return new Response(svg, {
    headers: {
      ...headers,
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
