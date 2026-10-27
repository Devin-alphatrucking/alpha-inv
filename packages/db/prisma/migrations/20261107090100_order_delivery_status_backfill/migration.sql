-- Orders already sent get the status their deliveries say (a new enum value can only be used after the migration that adds it has finished).
WITH totals AS (
  SELECT o.id,
         bool_and(COALESCE(r.got, 0) >= l.quantity) AS all_in,
         bool_or(COALESCE(r.got, 0) > 0) AS any_in,
         (SELECT max(g."receivedOn") FROM "GoodsReceipt" g WHERE g."orderId" = o.id) AS last_on
  FROM "PurchaseOrder" o
  JOIN "PurchaseOrderLine" l ON l."orderId" = o.id
  LEFT JOIN (SELECT "orderLineId", sum(quantity) AS got FROM "GoodsReceiptLine" GROUP BY "orderLineId") r ON r."orderLineId" = l.id
  WHERE o.status = 'SENT'
  GROUP BY o.id
)
UPDATE "PurchaseOrder" o
SET status = CASE WHEN t.all_in THEN 'DELIVERED'::"OrderStatus" WHEN t.any_in THEN 'PART_DELIVERED'::"OrderStatus" ELSE o.status END,
    "deliveredAt" = CASE WHEN t.all_in THEN t.last_on::timestamp ELSE o."deliveredAt" END
FROM totals t
WHERE o.id = t.id AND (t.all_in OR t.any_in);
