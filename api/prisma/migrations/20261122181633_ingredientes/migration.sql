-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "regioesIngredientes" JSONB;

-- CreateTable
CREATE TABLE "MenuItemIngrediente" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "ingredienteId" TEXT,

    CONSTRAINT "MenuItemIngrediente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingrediente" (
    "id" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nomePt" TEXT,
    "descricao" TEXT,
    "descricaoUrl" TEXT,
    "descricaoBuscadaEm" TIMESTAMPTZ(3),

    CONSTRAINT "Ingrediente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredienteNome" (
    "id" TEXT NOT NULL,
    "ingredienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "idioma" TEXT NOT NULL,

    CONSTRAINT "IngredienteNome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuItemIngrediente_menuItemId_idx" ON "MenuItemIngrediente"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemIngrediente_ingredienteId_idx" ON "MenuItemIngrediente"("ingredienteId");

-- CreateIndex
CREATE INDEX "IngredienteNome_ingredienteId_idx" ON "IngredienteNome"("ingredienteId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredienteNome_idioma_nomeNormalizado_key" ON "IngredienteNome"("idioma", "nomeNormalizado");

-- AddForeignKey
ALTER TABLE "MenuItemIngrediente" ADD CONSTRAINT "MenuItemIngrediente_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemIngrediente" ADD CONSTRAINT "MenuItemIngrediente_ingredienteId_fkey" FOREIGN KEY ("ingredienteId") REFERENCES "Ingrediente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredienteNome" ADD CONSTRAINT "IngredienteNome_ingredienteId_fkey" FOREIGN KEY ("ingredienteId") REFERENCES "Ingrediente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
