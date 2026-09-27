CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Transaction_telegramId_idx" ON "Transaction"("telegramId");
CREATE INDEX "Transaction_telegramId_createdAt_idx" ON "Transaction"("telegramId", "createdAt");
