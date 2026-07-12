"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { writeClipboardText } from "@/lib/clipboard";
import { buildProfileXPostText, buildXBioText, buildXIntentUrl } from "@/lib/share-text";
import { SOCIAL_LINK_FIELDS, socialLinkEntries, type SocialLinks } from "@/lib/social-links";

import { SESSION_EVENT } from "../BrandNav";
import type { CreatorAction } from "../dashboard/metrics";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";

type Creator = {
  bio: null | string;
  displayName: null | string;
  socialLinks: null | SocialLinks;
  tipActionId: null | string;
  username: string;
};

function readSessionValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readSocialLinks(value: null | SocialLinks | undefined): SocialLinks {
  return value ? { ...value } : {};
}

function cleanSocialLinksDraft(draft: SocialLinks): null | SocialLinks {
  const cleaned: SocialLinks = {};
  for (const field of SOCIAL_LINK_FIELDS) {
    const value = draft[field.key]?.trim();
    if (value) {
      cleaned[field.key] = value;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export function MyProfileClient() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [creator, setCreator] = useState<Creator | null>(null);
  const [actions, setActions] = useState<CreatorAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [copied, setCopied] = useState<null | string>(null);

  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [socialLinksDraft, setSocialLinksDraft] = useState<SocialLinks>({});
  const [tipActionIdDraft, setTipActionIdDraft] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<null | string>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<null | string>(null);

  const signedIn = username.length > 0 && token.length > 0;

  useEffect(() => {
    setUsername(readSessionValue(USERNAME_STORAGE_KEY));
    setToken(readSessionValue(TOKEN_STORAGE_KEY));
    setHydrated(true);

    function refresh() {
      setUsername(readSessionValue(USERNAME_STORAGE_KEY));
      setToken(readSessionValue(TOKEN_STORAGE_KEY));
    }

    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!username || !token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/creator/actions", {
        headers: {
          "x-creator-token": token,
          "x-creator-username": username,
        },
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not load your profile.");
        return;
      }
      setCreator(body.creator);
      setActions(body.actions ?? []);
    } catch {
      setError("Network error while loading your profile.");
    } finally {
      setLoading(false);
    }
  }, [token, username]);

  useEffect(() => {
    if (hydrated && signedIn) {
      void loadData();
    }
  }, [hydrated, loadData, signedIn]);

  const effectiveUsername = creator?.username ?? username;
  const confirmMatches =
    deleteConfirmation.trim().toLowerCase() === effectiveUsername.toLowerCase() &&
    effectiveUsername.length > 0;

  const tipActionCandidates = useMemo(
    () => actions.filter((action) => !action.hiddenFromProfile && action.disabledAt === null),
    [actions],
  );

  const currentTipActionTitle = useMemo(() => {
    if (!creator?.tipActionId) return null;
    const found = actions.find((action) => action.id === creator.tipActionId);
    return found?.title ?? null;
  }, [actions, creator?.tipActionId]);
  const creatorSocialLinks = useMemo(
    () => socialLinkEntries(creator?.socialLinks ?? null),
    [creator?.socialLinks],
  );

  const profilePath = `/u/${encodeURIComponent(effectiveUsername)}`;
  const profileUrl =
    typeof window !== "undefined" ? `${window.location.origin}${profilePath}` : profilePath;
  const profileQrBase = `/api/profiles/${encodeURIComponent(effectiveUsername)}/qr`;
  const profileQrPreviewSrc = `${profileQrBase}?format=svg&size=512`;
  const profileQrSvgUrl = `${profileQrBase}?format=svg&size=1024`;
  const profileQrPngUrl = `${profileQrBase}?format=png&size=1024`;
  const profileQrPngPrintUrl = `${profileQrBase}?format=png&size=2048`;
  const profileBioText = buildXBioText(profileUrl);
  const profileXPostText = buildProfileXPostText({ profileUrl });
  const profileXIntentUrl = buildXIntentUrl({
    hashtags: ["Kaspa"],
    text: buildProfileXPostText({ includeUrl: false }),
    url: profileUrl,
  });

  const copyProfileValue = useCallback(async (key: string, value: string) => {
    const ok = await writeClipboardText(value);
    if (ok) {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1600);
    } else {
      setError("Clipboard copy failed. Select and copy the text manually.");
    }
  }, []);

  const copyProfileUrl = useCallback(async () => {
    await copyProfileValue("profile-url", profileUrl);
  }, [copyProfileValue, profileUrl]);

  const copyProfileBioText = useCallback(async () => {
    await copyProfileValue("profile-bio", profileBioText);
  }, [copyProfileValue, profileBioText]);

  const copyProfilePostText = useCallback(async () => {
    await copyProfileValue("profile-post", profileXPostText);
  }, [copyProfileValue, profileXPostText]);

  const openProfileEditor = useCallback(() => {
    setBioDraft(creator?.bio ?? "");
    setDisplayNameDraft(creator?.displayName ?? "");
    setSocialLinksDraft(readSocialLinks(creator?.socialLinks));
    setTipActionIdDraft(creator?.tipActionId ?? "");
    setProfileError(null);
    setProfileEditOpen(true);
  }, [creator]);

  const cancelProfileEdit = useCallback(() => {
    setProfileEditOpen(false);
    setProfileError(null);
  }, []);

  const handleProfileSave = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!signedIn) return;
      setProfileSaving(true);
      setProfileError(null);
      try {
        const body: {
          bio: null | string;
          displayName: null | string;
          socialLinks: null | SocialLinks;
          tipActionId: null | string;
        } = {
          bio: bioDraft.trim().length > 0 ? bioDraft.trim() : null,
          displayName: displayNameDraft.trim().length > 0 ? displayNameDraft.trim() : null,
          socialLinks: cleanSocialLinksDraft(socialLinksDraft),
          tipActionId: tipActionIdDraft.length > 0 ? tipActionIdDraft : null,
        };
        const response = await fetch("/api/creators/me", {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-creator-token": token,
            "x-creator-username": username,
          },
          method: "PATCH",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setProfileError(payload?.error?.message ?? "Could not save profile changes. Try again.");
          return;
        }
        if (payload?.creator) {
          setCreator(payload.creator);
        }
        setProfileEditOpen(false);
      } catch {
        setProfileError("Network error while saving the profile.");
      } finally {
        setProfileSaving(false);
      }
    },
    [bioDraft, displayNameDraft, signedIn, socialLinksDraft, tipActionIdDraft, token, username],
  );

  const cancelDelete = useCallback(() => {
    setDeleteOpen(false);
    setDeleteConfirmation("");
    setDeleteError(null);
  }, []);

  const handleDelete = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!signedIn || !confirmMatches) return;
      setDeleting(true);
      setDeleteError(null);
      try {
        const response = await fetch("/api/creators/me", {
          body: JSON.stringify({ confirmUsername: deleteConfirmation.trim() }),
          headers: {
            "content-type": "application/json",
            "x-creator-token": token,
            "x-creator-username": username,
          },
          method: "DELETE",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setDeleteError(
            body?.error?.message ?? "Could not delete the profile. Try again or contact support.",
          );
          setDeleting(false);
          return;
        }
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          window.sessionStorage.removeItem(USERNAME_STORAGE_KEY);
          window.dispatchEvent(new CustomEvent(SESSION_EVENT));
        }
        router.replace("/");
      } catch {
        setDeleteError("Network error while deleting the profile.");
        setDeleting(false);
      }
    },
    [confirmMatches, deleteConfirmation, router, signedIn, token, username],
  );

  if (!hydrated) {
    return (
      <main className="main-wide">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="main-wide">
        <section className="card card-accent">
          <span className="label">My profile</span>
          <h1 style={{ marginBottom: 6 }}>Sign in to manage your profile</h1>
          <p className="muted" style={{ marginBottom: 14 }}>
            Edit your public profile, choose your quick-tip card, or delete the profile.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/sign-in">
              Sign in
            </Link>
            <Link className="btn" href="/create-profile">
              Create profile
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="main-wide">
      <section className="card card-accent">
        <span className="label">My profile</span>
        <h1 style={{ marginBottom: 6 }}>{creator?.displayName ?? effectiveUsername}</h1>
        <p className="muted" style={{ margin: 0 }}>
          Public namespace: <code>/u/{effectiveUsername}</code>
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn btn-primary" href={profilePath}>
            View public profile
          </Link>
          <Link className="btn" href="/new-link">
            Create a new link
          </Link>
          <button className="btn" disabled={loading} onClick={() => void loadData()} type="button">
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="card" id="profile">
        <div className="row row-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Public profile</h2>
          {!profileEditOpen ? (
            <button className="btn" onClick={openProfileEditor} type="button">
              Edit
            </button>
          ) : null}
        </div>
        {!profileEditOpen ? (
          <div className="profile-summary">
            <p className="muted" style={{ marginTop: 0 }}>
              Lives at{" "}
              <Link href={profilePath}>
                <code>/u/{effectiveUsername}</code>
              </Link>
            </p>
            <dl className="profile-summary-grid">
              <div className="profile-summary-card">
                <dt className="label">Display name</dt>
                <dd>
                  <strong>{creator?.displayName ?? "Not set"}</strong>
                  <span>Shown as the headline on your public profile.</span>
                </dd>
              </div>
              <div className="profile-summary-card">
                <dt className="label">Bio</dt>
                <dd>
                  <strong>{creator?.bio ?? "No bio yet"}</strong>
                  <span>Add a few words so visitors know what they are supporting.</span>
                </dd>
              </div>
              <div className="profile-summary-card profile-summary-card-wide">
                <dt className="label">Social links</dt>
                <dd>
                  {creatorSocialLinks.length > 0 ? (
                    <div className="profile-social-summary">
                      {creatorSocialLinks.map((link) => (
                        <a
                          className="profile-social-link"
                          href={link.url}
                          key={link.key}
                          rel="noopener noreferrer me"
                          target="_blank"
                          title={link.host}
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <strong>No social links yet</strong>
                  )}
                  <span>Shown publicly beneath your profile bio.</span>
                </dd>
              </div>
              <div className="profile-summary-card profile-summary-card-wide">
                <dt className="label">Quick-tip card</dt>
                <dd>
                  <strong>{currentTipActionTitle ?? "No primary tip Action selected"}</strong>
                  <span>
                    This is the large payment card at the top of your public profile. Pick your main
                    tip or donation link here.
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <form className="row-stack" onSubmit={handleProfileSave}>
            <div>
              <label className="label" htmlFor="profile-display-name">
                Display name
              </label>
              <input
                autoComplete="off"
                id="profile-display-name"
                maxLength={80}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                placeholder={`@${effectiveUsername}`}
                type="text"
                value={displayNameDraft}
              />
            </div>
            <div>
              <label className="label" htmlFor="profile-bio">
                Bio
              </label>
              <textarea
                id="profile-bio"
                maxLength={280}
                onChange={(event) => setBioDraft(event.target.value)}
                placeholder="A short blurb shown at the top of your profile."
                rows={3}
                value={bioDraft}
              />
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                {bioDraft.length}/280
              </p>
            </div>
            <fieldset className="social-link-form">
              <legend className="label">Social links</legend>
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
                Optional public links shown on your profile. Use accounts and pages you control.
              </p>
              <div className="social-link-form-grid">
                {SOCIAL_LINK_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="label" htmlFor={`profile-social-${field.key}`}>
                      {field.label}
                    </label>
                    <input
                      autoComplete="off"
                      id={`profile-social-${field.key}`}
                      inputMode="url"
                      maxLength={200}
                      onChange={(event) =>
                        setSocialLinksDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      type="url"
                      value={socialLinksDraft[field.key] ?? ""}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor="profile-tip-action">
                Quick-tip card
              </label>
              <select
                id="profile-tip-action"
                onChange={(event) => setTipActionIdDraft(event.target.value)}
                value={tipActionIdDraft}
              >
                <option value="">- None (hide quick-tip card) -</option>
                {tipActionCandidates.map((action) => (
                  <option key={action.id} value={action.id}>
                    {action.title}
                    {action.amountKas ? ` · ${action.amountKas} KAS` : " · variable amount"}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                This becomes the large payment card at the top of your public profile. Your other
                visible links appear below it.
              </p>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={profileSaving} type="submit">
                {profileSaving ? "Saving..." : "Save"}
              </button>
              <button
                className="btn"
                disabled={profileSaving}
                onClick={cancelProfileEdit}
                type="button"
              >
                Cancel
              </button>
            </div>
            {profileError ? <p className="error-text">{profileError}</p> : null}
          </form>
        )}
      </section>

      <section className="card">
        <div className="row row-between" style={{ marginBottom: 10 }}>
          <div>
            <span className="label">Share profile</span>
            <h2 style={{ margin: "4px 0 0" }}>Profile share kit</h2>
          </div>
          <div className="row profile-share-actions">
            <a
              className="btn btn-primary"
              href={profileXIntentUrl}
              rel="noreferrer"
              target="_blank"
            >
              Post profile on X
            </a>
            <button className="btn" onClick={() => void copyProfileBioText()} type="button">
              {copied === "profile-bio" ? "Bio text copied" : "Copy bio text"}
            </button>
            <button className="btn" onClick={() => void copyProfileUrl()} type="button">
              {copied === "profile-url" ? "Profile link copied" : "Copy profile link"}
            </button>
          </div>
        </div>
        <div className="qr-download-panel">
          <div className="qr-download-preview">
            <Image
              alt={`QR code for /u/${effectiveUsername}`}
              height={196}
              src={profileQrPreviewSrc}
              unoptimized
              width={196}
            />
          </div>
          <div className="qr-download-copy">
            <span className="label">QR code target</span>
            <p className="value-mono">{profileUrl}</p>
            <p className="muted">
              Use this for a general profile or tip link. It opens your public profile first, then
              supporters can choose the quick-tip card or another visible link.
            </p>
            <div className="row">
              <button className="btn" onClick={() => void copyProfilePostText()} type="button">
                {copied === "profile-post" ? "Post text copied" : "Copy post text"}
              </button>
              <a
                className="btn"
                download={`kaspalinks-${effectiveUsername}-profile.svg`}
                href={profileQrSvgUrl}
              >
                SVG
              </a>
              <a
                className="btn"
                download={`kaspalinks-${effectiveUsername}-profile-1024.png`}
                href={profileQrPngUrl}
              >
                PNG 1024
              </a>
              <a
                className="btn"
                download={`kaspalinks-${effectiveUsername}-profile-print.png`}
                href={profileQrPngPrintUrl}
              >
                PNG print
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="card card-danger">
        <h2 style={{ marginBottom: 6 }}>Delete your profile</h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          Permanently removes your creator profile, every link you ever created, and every payment
          request those links received. Security audit records stay for abuse investigation, but the
          profile and public links for <code>{effectiveUsername || "your account"}</code> are
          removed. This is irreversible.
        </p>
        <p className="error-text" style={{ marginBottom: 14 }}>
          Open claimable links must be claimed, refunded, or removed while still unfunded before the
          profile can be deleted. This prevents locked KAS from losing its recovery path.
        </p>

        {!deleteOpen ? (
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)} type="button">
            Delete profile...
          </button>
        ) : (
          <form className="row-stack" onSubmit={handleDelete}>
            <div>
              <label className="label" htmlFor="delete-confirm-username">
                Type your username to confirm
              </label>
              <input
                aria-describedby="delete-confirm-hint"
                autoComplete="off"
                autoFocus
                id="delete-confirm-username"
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={effectiveUsername}
                type="text"
                value={deleteConfirmation}
              />
              <p className="muted" id="delete-confirm-hint" style={{ fontSize: "0.82rem" }}>
                Must match <code>{effectiveUsername}</code> exactly (case-insensitive).
              </p>
            </div>
            <div className="row">
              <button
                className="btn btn-danger"
                disabled={!confirmMatches || deleting}
                type="submit"
              >
                {deleting ? "Deleting..." : "Delete forever"}
              </button>
              <button className="btn" disabled={deleting} onClick={cancelDelete} type="button">
                Cancel
              </button>
            </div>
            {deleteError ? <p className="error-text">{deleteError}</p> : null}
          </form>
        )}
      </section>
    </main>
  );
}
