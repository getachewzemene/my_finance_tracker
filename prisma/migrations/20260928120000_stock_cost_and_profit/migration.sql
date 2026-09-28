ALTER TABLE "Product"
ADD COLUMN "unitCost" DECIMAL(14,2);

ALTER TABLE "Sale"
ADD COLUMN "unitCost" DECIMAL(14,2),
ADD COLUMN "costTotal" DECIMAL(14,2),
ADD COLUMN "profit" DECIMAL(14,2);

UPDATE "Sale"
SET "unitCost" = "unitPrice",
    "costTotal" = "total",
    "profit" = 0;

ALTER TABLE "Sale"
ALTER COLUMN "unitCost" SET NOT NULL,
ALTER COLUMN "costTotal" SET NOT NULL,
ALTER COLUMN "profit" SET NOT NULL;