CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_telegramId_name_key" ON "Product"("telegramId", "name");
CREATE INDEX "Product_telegramId_idx" ON "Product"("telegramId");
CREATE INDEX "Sale_telegramId_createdAt_idx" ON "Sale"("telegramId", "createdAt");
CREATE INDEX "Sale_productId_idx" ON "Sale"("productId");
CREATE UNIQUE INDEX "Sale_transactionId_key" ON "Sale"("transactionId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;