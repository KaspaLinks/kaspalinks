-- Hidden workspaces for people who run a giveaway on the website without a
-- profile. They may only use the giveaway endpoints.
ALTER TYPE "CreatorAccountKind" ADD VALUE 'GUEST';
