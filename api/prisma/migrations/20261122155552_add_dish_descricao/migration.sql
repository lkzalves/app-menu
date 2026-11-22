-- AlterTable
ALTER TABLE "Dish" ADD COLUMN     "descricao" TEXT,
ADD COLUMN     "descricaoBuscadaEm" TIMESTAMPTZ(3),
ADD COLUMN     "descricaoUrl" TEXT;
