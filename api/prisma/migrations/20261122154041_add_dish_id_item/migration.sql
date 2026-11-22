-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "dishId" TEXT;

-- CreateIndex
CREATE INDEX "MenuItem_dishId_idx" ON "MenuItem"("dishId");

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE SET NULL ON UPDATE CASCADE;
