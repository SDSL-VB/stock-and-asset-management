-- Forces a password change when an admin chose the password.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Everyone who exists right now got their password from the seed or from an
-- admin, so every one of them must replace it. The system account is excluded
-- because it cannot sign in at all.
UPDATE "users" SET "mustChangePassword" = true WHERE "isSystem" = false;
