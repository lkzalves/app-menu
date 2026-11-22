-- Extensão para a busca aproximada (similarity e o operador %). Precisa existir antes do índice GIN
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "FonteImagem" AS ENUM ('PIXABAY', 'WIKIMEDIA', 'BRAVE');

-- CreateTable
CREATE TABLE "Dish" (
    "id" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DishName" (
    "id" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "idioma" TEXT NOT NULL,

    CONSTRAINT "DishName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DishImage" (
    "id" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "fonte" "FonteImagem" NOT NULL,
    "urlOrigem" TEXT NOT NULL,
    "paginaOrigem" TEXT,
    "storageKey" TEXT NOT NULL,
    "credito" TEXT,
    "licenca" TEXT,
    "votosPositivos" INTEGER NOT NULL DEFAULT 0,
    "votosNegativos" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DishImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DishName_dishId_idx" ON "DishName"("dishId");

-- CreateIndex
CREATE INDEX "DishName_nomeNormalizado_idx" ON "DishName" USING GIN ("nomeNormalizado" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "DishName_idioma_nomeNormalizado_key" ON "DishName"("idioma", "nomeNormalizado");

-- CreateIndex
CREATE INDEX "DishImage_dishId_idx" ON "DishImage"("dishId");

-- AddForeignKey
ALTER TABLE "DishName" ADD CONSTRAINT "DishName_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishImage" ADD CONSTRAINT "DishImage_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
