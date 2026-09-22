-- Notifications for everyone (in the app, and by mail for those who choose),
-- each person's mail choices, a lead time and due date on every purchase order
-- line, when the background checks last ran, and failed sign-ins counted in the
-- database. Additive only.

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ACTION', 'DECIDED', 'LOW_STOCK', 'ORDER_LATE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mailDigest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mailInstantKinds" "NotificationKind"[] DEFAULT ARRAY['ACTION', 'DECIDED']::"NotificationKind"[];

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "expectedBy" TIMESTAMP(3),
ADD COLUMN     "leadTimeDays" INTEGER;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "digestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "watchChecksAt" TIMESTAMP(3),

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_failures" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_failures_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

