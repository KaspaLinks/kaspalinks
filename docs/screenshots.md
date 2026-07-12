# Screenshots and GIFs

Visual proof of the demo flow makes the project easier to share. This page lists the shots worth capturing and how to take them consistently.

## Suggested screens

For a community post or pull-request description, the following set tells the story:

1. **Landing page** at a mobile viewport (390×844): title, mantra, non-custodial card, demo CTA.
2. **Public Action page** at the same viewport before generating a payment request: title, amount in KAS, recipient address, Generate button.
3. **Public Action page** after Generate: QR code, copy buttons, Open in wallet, PENDING pill.
4. **Public Action page** after mock-confirm: CONFIRMED pill, fake tx id.
5. **Admin page** with a created Action and a recent payment request.
6. **Disabled state** screenshot of `/a/:publicId` after toggling `disabled: true`.

A short GIF that walks through screens 2 → 3 → 4 is ideal for social posts.

## How to capture them

### Browser dev tools (recommended)

Both Chrome and Firefox let you pin a mobile viewport, set device pixel ratio, and take a clean full-page screenshot.

Chrome:

1. Open the Action page.
2. DevTools → toggle device toolbar (`Cmd-Shift-M` / `Ctrl-Shift-M`).
3. Pick "iPhone 14 Pro" or set a custom 390×844 viewport.
4. DevTools menu → "Run command" (`Cmd-Shift-P`) → "Capture full size screenshot".

Firefox:

1. Responsive Design Mode (`Cmd-Opt-M`).
2. Same viewport.
3. Camera icon in the responsive toolbar.

### Real device

If you can, take an actual mobile screenshot. It captures real status bars, real scaling, and is more honest in talks.

### GIFs

For a 5–10 second screen recording, use:

- macOS: `Cmd-Shift-5` → record a portion of the screen → convert to GIF with `ffmpeg`:

  ```sh
  ffmpeg -i recording.mov -vf "fps=15,scale=540:-1:flags=lanczos" -loop 0 recording.gif
  ```

- Linux: `peek` or `kooha`.
- Windows: built-in Xbox Game Bar capture, then convert.

Keep GIFs under ~5 MB so they upload cleanly to GitHub and social platforms.

## Filing them

A `docs/media/` folder is fine for short-term assets. For polished press shots, host them on a CDN or the project website. Do not commit anything containing real admin tokens, real recipient addresses, or anything that looks like a private key.

## What not to capture

- The admin token field with a real token typed in.
- The `.env` file.
- Internal database screenshots that include hashed IPs or other audit metadata for real users.
- Anything that overstates confirmation. Captions should distinguish "mock-confirm", "demo confirmation", or "indexer-reported confirmation" accurately.
