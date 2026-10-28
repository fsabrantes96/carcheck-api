-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'INSPECTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "Specialty" AS ENUM ('ENGINE', 'TRANSMISSION', 'SUSPENSION', 'BRAKES', 'ELECTRICAL', 'BODYWORK', 'AIR_CONDITIONING');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roles" "Role"[] DEFAULT ARRAY['USER']::"Role"[];

-- CreateTable
CREATE TABLE "InspectorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "specialties" "Specialty"[],
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "serviceRadiusKm" INTEGER NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectorProfile_userId_key" ON "InspectorProfile"("userId");

-- AddForeignKey
ALTER TABLE "InspectorProfile" ADD CONSTRAINT "InspectorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
