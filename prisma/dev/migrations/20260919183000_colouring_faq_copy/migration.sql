-- The category's own FAQ is separate from the services-master FAQ.
-- Match only the exact stale answer; preserve customised answers and prices.
BEGIN;

UPDATE "ServiceCategoryContent"
SET "faqsJson" = REPLACE("faqsJson", '"A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page."', '"A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book Consultation & Patch Test via our booking page. The current price is listed in our service menu."'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'colouring'
  AND "category" = 'Colouring'
  AND INSTR("faqsJson", '"A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page."') > 0;

UPDATE "Faq"
SET "answer" = 'A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book Consultation & Patch Test via our booking page. The current price is listed in our service menu.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'category:colouring'
  AND "question" = 'Why do I need a patch test before colouring?'
  AND "answer" = 'A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page.';

COMMIT;
