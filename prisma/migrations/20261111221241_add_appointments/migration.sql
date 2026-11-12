-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT', 'PAID', 'REPORT_SUBMITTED', 'DISPUTED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AppointmentActor" AS ENUM ('BUYER', 'SELLER', 'INSPECTOR', 'SYSTEM');

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "inspectorUserId" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "meetingAddress" TEXT,
    "priceCents" INTEGER NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "inspectorPayoutCents" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "endedBy" "AppointmentActor",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_buyerId_createdAt_idx" ON "Appointment"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_sellerId_createdAt_idx" ON "Appointment"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_inspectorUserId_startsAt_idx" ON "Appointment"("inspectorUserId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_listingId_status_idx" ON "Appointment"("listingId", "status");

-- CreateIndex
CREATE INDEX "Appointment_status_expiresAt_idx" ON "Appointment"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_inspectorUserId_fkey" FOREIGN KEY ("inspectorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Constraints que o Prisma não expressa (escritas à mão; ver
-- docs/appointments-design.md, seção 2). O Prisma não as enxerga nem tenta
-- apagá-las (conferido em 2026-11-11 no Prisma 7.10.1). Não remova sem
-- atualizar o desenho e o docs/audit.md (risco 26).
-- ===========================================================================

-- Exclusion constraint com igualdade em TEXT precisa do btree_gist
-- (disponível na imagem postgis/postgis:16-3.4, versão 1.7).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Risco 9: o mesmo avaliador não pode ter dois horários ocupados sobrepostos.
-- REQUESTED não ocupa horário; ocupam ACCEPTED, AWAITING_PAYMENT e PAID.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_inspector_slot_excl"
  EXCLUDE USING gist (
    "inspectorUserId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('ACCEPTED', 'AWAITING_PAYMENT', 'PAID'));

-- Sem duplicado em andamento (mesmo comprador, anúncio e avaliador).
-- O nome é usado pelo service (APPOINTMENT_OPEN_TRIPLET_INDEX).
CREATE UNIQUE INDEX "Appointment_open_triplet_key"
  ON "Appointment" ("buyerId", "listingId", "inspectorUserId")
  WHERE ("status" IN ('REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT', 'PAID', 'REPORT_SUBMITTED', 'DISPUTED'));

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_distinct_parties_chk"
    CHECK ("buyerId" <> "sellerId" AND "inspectorUserId" <> "buyerId" AND "inspectorUserId" <> "sellerId"),
  ADD CONSTRAINT "Appointment_slot_chk"
    CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Appointment_money_chk"
    CHECK ("priceCents" > 0
       AND "platformFeeBps" BETWEEN 0 AND 10000
       AND "platformFeeCents" >= 0
       AND "inspectorPayoutCents" >= 0
       AND "platformFeeCents" + "inspectorPayoutCents" = "priceCents"),
  ADD CONSTRAINT "Appointment_expires_chk"
    CHECK ("status" NOT IN ('REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT') OR "expiresAt" IS NOT NULL),
  ADD CONSTRAINT "Appointment_ended_chk"
    CHECK (("status" IN ('DECLINED', 'CANCELLED', 'EXPIRED')) = ("endedBy" IS NOT NULL)),
  ADD CONSTRAINT "Appointment_address_chk"
    CHECK ("status" NOT IN ('AWAITING_PAYMENT', 'PAID') OR "meetingAddress" IS NOT NULL);
