-- CreateEnum
CREATE TYPE "StatusMenu" AS ENUM ('RECEBIDO', 'PROCESSANDO', 'CONCLUIDO', 'ERRO');

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "restaurante" TEXT,
    "idioma" TEXT,
    "status" "StatusMenu" NOT NULL DEFAULT 'RECEBIDO',
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "nomeTraduzido" TEXT,
    "descricao" TEXT,
    "preco" DECIMAL(10,2),

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuItem_menuId_idx" ON "MenuItem"("menuId");

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
