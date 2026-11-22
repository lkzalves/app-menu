-- CreateEnum
CREATE TYPE "StatusItem" AS ENUM ('PROCESSANDO', 'PRONTO');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "status" "StatusItem" NOT NULL DEFAULT 'PRONTO';
