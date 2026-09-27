ALTER TABLE "Transaction"
ALTER COLUMN "amount" TYPE DECIMAL(14, 2)
USING ROUND("amount"::numeric, 2);

ALTER TABLE "Transaction"
ADD COLUMN "currencyCode" CHAR(3) NOT NULL DEFAULT 'ETB';