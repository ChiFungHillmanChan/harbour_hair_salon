-- Correct only the exact stale colouring copy observed on the public page.
-- Quoted JSON values avoid rewriting a paragraph the salon has customised.
-- Prices, durations and all other content remain unchanged; reruns are no-ops.
BEGIN;

UPDATE "ServiceCategoryContent"
SET "overviewJson" = REPLACE("overviewJson", '"A patch test is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page — it only takes a minute."', '"A patch test is required at least 48 hours before any colour appointment. You can book Consultation & Patch Test via our booking page."'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'colouring'
  AND "category" = 'Colouring'
  AND STRPOS("overviewJson", '"A patch test is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page — it only takes a minute."') > 0;

UPDATE "ServiceCategoryContent"
SET "processJson" = REPLACE("processJson", '"Required 48 hours before any colour appointment. Quick, free, and protects you from allergic reactions."', '"Required at least 48 hours before any colour appointment."'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'colouring'
  AND "category" = 'Colouring'
  AND STRPOS("processJson", '"Required 48 hours before any colour appointment. Quick, free, and protects you from allergic reactions."') > 0;

-- Existing FAQ rows are skipped by the insert-only FAQ seed.
UPDATE "Faq"
SET "answer" = 'A patch test checks for allergic reactions to colour products and is required at least 48 hours before your colour appointment. You can book Consultation & Patch Test through our booking page. The current price is listed in our service menu.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'services-master'
  AND "question" = 'Do I need a patch test before colouring?'
  AND "answer" = 'A patch test checks for allergic reactions to colour products and is required at least 48 hours before your colour appointment. You can book a free patch test through our booking page.';

COMMIT;
