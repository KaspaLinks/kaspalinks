import { describe, expect, it } from "vitest";

import { extractSocialHandle, socialLinkEntries } from "./social-links";

describe("extractSocialHandle", () => {
  // X / Twitter — the @ prefix and 1-15 char username rule are the
  // canonical handle representation; the reserved-paths list keeps
  // us from rendering a fake "@search" pill from a non-profile URL.
  it("extracts X handles with the @ prefix", () => {
    expect(extractSocialHandle("x", "https://x.com/anna_streams")).toBe("@anna_streams");
    expect(extractSocialHandle("x", "https://twitter.com/anna_streams")).toBe("@anna_streams");
    // Tweet permalinks still surface the author's handle.
    expect(extractSocialHandle("x", "https://x.com/anna_streams/status/12345")).toBe(
      "@anna_streams",
    );
    // Reserved app sections must not produce a "@search" / "@i" pill.
    expect(extractSocialHandle("x", "https://x.com/search?q=foo")).toBeNull();
    expect(extractSocialHandle("x", "https://x.com/i/lists/123")).toBeNull();
    expect(extractSocialHandle("x", "https://x.com/explore")).toBeNull();
    // Length violations (Twitter max is 15) or invalid chars.
    expect(extractSocialHandle("x", "https://x.com/way_too_long_username_here")).toBeNull();
    expect(extractSocialHandle("x", "https://x.com/has-a-dash")).toBeNull();
    // Empty path falls back to no handle so the platform label still shows.
    expect(extractSocialHandle("x", "https://x.com/")).toBeNull();
  });

  it("extracts GitHub usernames without an @ prefix", () => {
    expect(extractSocialHandle("github", "https://github.com/anna")).toBe("anna");
    // Repository URLs collapse to the owner; that's still the right
    // pill content because we link to the user/org, not the repo.
    expect(extractSocialHandle("github", "https://github.com/anna/some-repo")).toBe("anna");
    // Reserved sections never become a handle.
    expect(extractSocialHandle("github", "https://github.com/orgs/example")).toBeNull();
    expect(extractSocialHandle("github", "https://github.com/marketplace")).toBeNull();
    // GitHub disallows leading hyphens; the regex must reject them.
    expect(extractSocialHandle("github", "https://github.com/-bad-name")).toBeNull();
  });

  it("extracts Twitch usernames without an @ prefix", () => {
    expect(extractSocialHandle("twitch", "https://twitch.tv/annastreams")).toBe("annastreams");
    expect(extractSocialHandle("twitch", "https://twitch.tv/directory/game/x")).toBeNull();
    // Too short (Twitch min is 4) — fall back to platform label.
    expect(extractSocialHandle("twitch", "https://twitch.tv/abc")).toBeNull();
  });

  it("handles YouTube's three different URL shapes", () => {
    // Modern @handle URL.
    expect(extractSocialHandle("youtube", "https://youtube.com/@anna")).toBe("@anna");
    // Legacy /c/ custom URL drops to the channel name without an @.
    expect(extractSocialHandle("youtube", "https://youtube.com/c/AnnaChannel")).toBe("AnnaChannel");
    // /user/ legacy URLs also surface the username.
    expect(extractSocialHandle("youtube", "https://youtube.com/user/anna")).toBe("anna");
    // Channel IDs are opaque (UCxxx) and never read as a handle.
    expect(
      extractSocialHandle("youtube", "https://youtube.com/channel/UC1234567890abcdef"),
    ).toBeNull();
  });

  it("returns null for platforms without a meaningful handle", () => {
    // Discord server invites are opaque codes; we'd rather show the
    // platform label than mislead users with a "handle" that isn't one.
    expect(extractSocialHandle("discord", "https://discord.gg/abc123")).toBeNull();
    // Website pills already surface the hostname — a handle would clash.
    expect(extractSocialHandle("website", "https://anna.dev")).toBeNull();
  });

  it("survives garbage URLs without throwing", () => {
    expect(extractSocialHandle("x", "not-a-url")).toBeNull();
    expect(extractSocialHandle("github", "")).toBeNull();
  });
});

describe("socialLinkEntries", () => {
  it("attaches the extracted handle to each entry", () => {
    const entries = socialLinkEntries({
      github: "https://github.com/anna",
      website: "https://anna.dev",
      x: "https://x.com/anna_streams",
    });
    const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
    expect(byKey.x?.handle).toBe("@anna_streams");
    expect(byKey.github?.handle).toBe("anna");
    expect(byKey.website?.handle).toBeNull();
  });
});
