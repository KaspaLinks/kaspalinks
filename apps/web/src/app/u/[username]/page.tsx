import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PaymentRequestStatus, prisma } from "@kaspa-actions/db";
import { buildKaspaPaymentUri, formatSompiToKaspa } from "@kaspa-actions/kaspa";

import {
  isActionDeleted,
  isActionDisabled,
  isActionExpired,
  serializePublicAction,
  type PublicActionMetadata,
} from "@/lib/action-serializer";
import { computeGoalProgress, loadGoalProgress, type GoalProgress } from "@/lib/goal-progress";
import { buildProfileSocialPreview } from "@/lib/social-preview";
import { socialLinkEntries } from "@/lib/social-links";
import {
  encodeSupporterWallCursor,
  formatSupporterWallDate,
  profileActionTypeLabel,
  SUPPORTER_WALL_INITIAL_COUNT,
} from "@/lib/supporter-wall";

import { ProfileClient } from "./ProfileClient";
import { SupporterWall } from "./SupporterWall";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const normalized = username.trim().toLowerCase();

  if (!normalized) {
    return { title: "Creator profile" };
  }

  const creator = await prisma.creator.findUnique({
    select: { bio: true, displayName: true, username: true },
    where: { username: normalized },
  });

  if (!creator) {
    return {
      robots: { follow: false, index: false },
      title: "Creator profile not found",
    };
  }

  const preview = buildProfileSocialPreview(creator);
  const path = `/u/${encodeURIComponent(creator.username)}`;
  const imagePath = `${path}/opengraph-image`;

  return {
    alternates: { canonical: path },
    description: preview.description,
    openGraph: {
      description: preview.description,
      images: [{ alt: preview.title, height: 630, url: imagePath, width: 1200 }],
      title: preview.title,
      type: "website",
      url: path,
    },
    title: preview.title,
    twitter: {
      card: "summary_large_image",
      description: preview.description,
      images: [imagePath],
      title: preview.title,
    },
  };
}

function profileInitials(displayName: null | string, username: string): string {
  const source = (displayName ?? username).trim() || username;
  const initials = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || username.slice(0, 1).toUpperCase();
}

/**
 * Public-facing creator landing page at /u/<username>.
 *
 * Layout: bio + display name above the fold, quick-tip card pointing at
 * the creator's chosen tipAction (if any + still usable), then a grid
 * of the creator's other public Actions. Hidden Actions (per-action
 * opt-out) never appear. Soft-deleted, disabled, or expired Actions
 * are filtered out at query time so we don't render dead cards.
 *
 * URL is case-insensitive on the username segment — Next will route us
 * here for any casing but the lookup is on the lowercased canonical
 * value. The notFound() path also handles the "no such user" case.
 */
export default async function CreatorProfilePage({ params }: PageProps) {
  const { username } = await params;
  const normalized = username.trim().toLowerCase();

  if (!normalized) {
    notFound();
  }

  const creator = await prisma.creator.findUnique({
    where: { username: normalized },
  });

  if (!creator) {
    notFound();
  }

  // tipAction is the canonical "quick tip" card. May be null if creator
  // hasn't picked one, or if the chosen Action is now deleted /
  // disabled / expired / explicitly hidden — in any of those states we
  // just drop the card, we don't 404 the whole profile.
  //
  // The hiddenFromProfile guard here is the security-relevant filter:
  // a creator may legitimately promote an Action to tipActionId and
  // later flip "Hide from profile" (e.g. because the Action turned out
  // to leak a customer-specific invoice). The toggle would otherwise
  // succeed silently while the Action still rendered prominently as
  // the Quick-Tip — exactly the leak the visibility flag is meant to
  // prevent. We do *not* auto-null tipActionId on toggle so a creator
  // who un-hides later gets their card back without re-picking.
  const tipAction = creator.tipActionId
    ? await prisma.action.findFirst({
        where: {
          creatorId: creator.id,
          deletedAt: null,
          disabledAt: null,
          hiddenFromProfile: false,
          id: creator.tipActionId,
        },
      })
    : null;

  const tipActionUsable =
    tipAction !== null && !isActionDeleted(tipAction) && !isActionDisabled(tipAction)
      ? !isActionExpired(tipAction)
        ? tipAction
        : null
      : null;

  // Visible Actions list — exclude the tip Action so it doesn't render
  // twice. Per-Action hiddenFromProfile is the main filter; the rest
  // are usability guards (deleted/disabled/expired).
  const otherActions = await prisma.action.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      ...(tipActionUsable ? { NOT: { id: tipActionUsable.id } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      creatorId: creator.id,
      deletedAt: null,
      disabledAt: null,
      hiddenFromProfile: false,
    },
  });

  const supporterWallEntries = await prisma.paymentRequest.findMany({
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    select: {
      amountSompi: true,
      confirmedAt: true,
      id: true,
      supporterMessage: true,
      supporterName: true,
      action: {
        select: {
          publicId: true,
          slug: true,
          title: true,
          type: true,
        },
      },
    },
    take: SUPPORTER_WALL_INITIAL_COUNT + 1,
    where: {
      action: {
        creatorId: creator.id,
        deletedAt: null,
        hiddenFromProfile: false,
      },
      confirmedAt: { not: null },
      status: PaymentRequestStatus.CONFIRMED,
      supporterHiddenAt: null,
      supporterPublic: true,
    },
  });

  const tipActionMetadata: PublicActionMetadata | null = tipActionUsable
    ? serializePublicAction(tipActionUsable)
    : null;
  const tipActionPaymentUri = tipActionUsable
    ? buildKaspaPaymentUri({
        amountSompi: tipActionUsable.amountSompi ?? undefined,
        label: tipActionUsable.title,
        message: tipActionUsable.message,
        recipientAddress: tipActionUsable.recipientAddress,
      })
    : null;
  const tipActionGoalProgress = tipActionUsable
    ? await loadGoalProgress(prisma, tipActionUsable)
    : null;

  // Batch the goal progress for the "more ways to support" grid into a
  // single grouped aggregate instead of one query per card. Only goal
  // links carry a goalSompi target, so non-goal cards skip this entirely.
  const goalActions = otherActions.filter((action) => action.goalSompi !== null);
  const goalRaisedByActionId = new Map<string, { raisedSompi: bigint; supporterCount: number }>();
  if (goalActions.length > 0) {
    const grouped = await prisma.paymentRequest.groupBy({
      _count: { _all: true },
      _sum: { amountSompi: true },
      by: ["actionId"],
      where: {
        actionId: { in: goalActions.map((action) => action.id) },
        status: PaymentRequestStatus.CONFIRMED,
      },
    });
    for (const row of grouped) {
      goalRaisedByActionId.set(row.actionId, {
        raisedSompi: row._sum.amountSompi ?? 0n,
        supporterCount: row._count._all,
      });
    }
  }

  // NEVER use Number() on sompi BigInts for display math — large amounts
  // overflow Number's 53-bit safe integer range and lose precision (a
  // single AGENTS.md no-no). formatSompiToKaspa does the integer-decimal
  // split without float arithmetic.
  const otherActionCards = otherActions.map((action) => {
    let goalProgress: GoalProgress | null = null;
    if (action.goalSompi !== null) {
      const raised = goalRaisedByActionId.get(action.id);
      goalProgress = computeGoalProgress({
        goalSompi: action.goalSompi,
        raisedSompi: raised?.raisedSompi ?? 0n,
        supporterCount: raised?.supporterCount ?? 0,
      });
    }

    return {
      amountKas: action.amountSompi !== null ? formatSompiToKaspa(action.amountSompi) : null,
      description: action.description,
      goalProgress,
      href:
        action.slug === null
          ? `/a/${encodeURIComponent(action.publicId)}`
          : `/u/${encodeURIComponent(creator.username)}/${encodeURIComponent(action.slug)}`,
      publicId: action.publicId,
      title: action.title,
      type: action.type,
      typeLabel: profileActionTypeLabel(action.type),
    };
  });
  const profileDisplayName = creator.displayName ?? creator.username;
  const profileInitial = profileInitials(creator.displayName, creator.username);
  const profileSocialLinks = socialLinkEntries(creator.socialLinks);
  const visibleSupporterWallEntries = supporterWallEntries.slice(0, SUPPORTER_WALL_INITIAL_COUNT);
  const supporterWallCards = visibleSupporterWallEntries.map((entry) => ({
    actionHref:
      entry.action.slug === null
        ? `/a/${encodeURIComponent(entry.action.publicId)}`
        : `/u/${encodeURIComponent(creator.username)}/${encodeURIComponent(entry.action.slug)}`,
    actionTitle: entry.action.title,
    amountKas: entry.amountSompi !== null ? formatSompiToKaspa(entry.amountSompi) : null,
    dateLabel: formatSupporterWallDate(entry.confirmedAt),
    id: entry.id,
    message: entry.supporterMessage,
    supporterName: entry.supporterName ?? "Anonymous",
    typeLabel: profileActionTypeLabel(entry.action.type),
  }));
  const lastVisibleSupporter =
    visibleSupporterWallEntries[visibleSupporterWallEntries.length - 1] ?? null;
  const supporterWallNextCursor =
    supporterWallEntries.length > SUPPORTER_WALL_INITIAL_COUNT &&
    lastVisibleSupporter?.confirmedAt
      ? encodeSupporterWallCursor({
          confirmedAt: lastVisibleSupporter.confirmedAt,
          id: lastVisibleSupporter.id,
        })
      : null;

  return (
    <main className="profile-main">
      <header className="profile-header">
        <div className="profile-avatar" aria-hidden="true">
          {profileInitial}
        </div>
        <div className="profile-header-copy">
          <span className="profile-kicker">Creator profile</span>
          <h1 className="profile-display-name">{creator.displayName ?? `@${creator.username}`}</h1>
          <p className="profile-handle">@{creator.username}</p>
          {creator.bio ? <p className="profile-bio">{creator.bio}</p> : null}
          {profileSocialLinks.length > 0 ? (
            <nav className="profile-social-links" aria-label={`${profileDisplayName} social links`}>
              {profileSocialLinks.map((link) => {
                // Pill label policy, in order of preference:
                //
                // 1. Website (allowedHosts: null) — surface the hostname
                //    directly. Phishing-mitigation: the creator can
                //    point this at any URL, so the supporter needs to
                //    see "anna.dev" up-front, not an opaque "Website".
                //
                // 2. Platforms with an extractable handle (X, GitHub,
                //    YouTube, Twitch) — combine the platform label and
                //    the user's handle so the destination is verifiable
                //    at a glance: "X · @anna_streams".
                //
                // 3. Everything else (Discord server invites, malformed
                //    handle paths) — fall back to the platform label.
                //    The backend host whitelist still guarantees that
                //    the link goes to the right platform.
                const displayLabel = (() => {
                  if (link.allowedHosts === null) return link.host;
                  if (link.handle) return `${link.label} · ${link.handle}`;
                  return link.label;
                })();
                return (
                  <a
                    className="profile-social-link"
                    href={link.url}
                    key={link.key}
                    rel="noopener noreferrer me"
                    target="_blank"
                    title={link.host}
                  >
                    {displayLabel}
                  </a>
                );
              })}
            </nav>
          ) : null}
        </div>
      </header>

      {tipActionMetadata && tipActionPaymentUri ? (
        <section className="profile-tip-card">
          <ProfileClient
            action={tipActionMetadata}
            goalProgress={tipActionGoalProgress}
            paymentUri={tipActionPaymentUri}
          />
        </section>
      ) : (
        <section className="profile-tip-card profile-tip-card--empty">
          <p>This creator hasn&apos;t set up a quick-tip card yet.</p>
        </section>
      )}

      {supporterWallCards.length > 0 ? (
        <SupporterWall
          entries={supporterWallCards}
          initialNextCursor={supporterWallNextCursor}
          username={creator.username}
        />
      ) : null}

      {otherActionCards.length > 0 ? (
        <section className="profile-links">
          <h2 className="profile-links-heading">More ways to support {profileDisplayName}</h2>
          <ul className="profile-links-list">
            {otherActionCards.map((card) => (
              <li key={card.publicId} className="profile-link-card">
                <Link className="profile-link-card__link" href={card.href}>
                  <span className="profile-link-card__body">
                    <span className="profile-link-card__meta">{card.typeLabel}</span>
                    <span className="profile-link-card__title">{card.title}</span>
                    {card.description ? (
                      <span className="profile-link-card__desc">{card.description}</span>
                    ) : null}
                    {card.goalProgress ? (
                      <span className="profile-link-card__goal">
                        <span
                          className={`profile-link-card__goal-bar${
                            card.goalProgress.reached ? " profile-link-card__goal-bar--reached" : ""
                          }`}
                        >
                          <span
                            className="profile-link-card__goal-fill"
                            style={{ width: `${card.goalProgress.pct}%` }}
                          />
                        </span>
                        <span className="profile-link-card__goal-text">
                          {card.goalProgress.raisedKas} / {card.goalProgress.goalKas} KAS ·{" "}
                          {card.goalProgress.pctLabel}%
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <span className="profile-link-card__aside">
                    {card.goalProgress ? (
                      <span className="profile-link-card__amount profile-link-card__amount-open">
                        {card.goalProgress.reached ? "Goal reached" : "Goal"}
                      </span>
                    ) : card.amountKas ? (
                      <span className="profile-link-card__amount">{card.amountKas} KAS</span>
                    ) : (
                      <span className="profile-link-card__amount profile-link-card__amount-open">
                        Any amount
                      </span>
                    )}
                    <span className="profile-link-card__arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
