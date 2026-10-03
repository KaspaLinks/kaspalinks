-- Growth Prompt attribution. Additive and nullable: existing creators and direct
-- signups keep NULL. Values come from a fixed allowlist and never contain personal data.
ALTER TABLE "Creator" ADD COLUMN "signupSource" TEXT;
