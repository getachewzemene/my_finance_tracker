CREATE TABLE "Budget" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "monthlyLimit" DECIMAL(14,2) NOT NULL,
    "alerted80Month" TEXT,
    "alerted100Month" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Budget_telegramId_category_key" ON "Budget"("telegramId", "category");