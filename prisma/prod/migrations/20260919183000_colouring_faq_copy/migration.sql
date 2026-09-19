-- The category's own FAQ is separate from the services-master FAQ.
-- Match only the exact stale answer; preserve customised answers and prices.
BEGIN TRY
BEGIN TRAN;

UPDATE [dbo].[ServiceCategoryContent]
SET [faqsJson] = REPLACE([faqsJson] COLLATE Latin1_General_100_BIN2, N'"A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page."', N'"A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book Consultation & Patch Test via our booking page. The current price is listed in our service menu."'),
    [updatedAt] = CURRENT_TIMESTAMP
WHERE [slug] = N'colouring'
  AND [category] = N'Colouring'
  AND CHARINDEX(N'"A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page."', [faqsJson] COLLATE Latin1_General_100_BIN2) > 0;

UPDATE [dbo].[Faq]
SET [answer] = N'A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book Consultation & Patch Test via our booking page. The current price is listed in our service menu.',
    [updatedAt] = CURRENT_TIMESTAMP
WHERE [key] = N'category:colouring'
  AND [question] = N'Why do I need a patch test before colouring?'
  AND [answer] COLLATE Latin1_General_100_BIN2 = N'A patch test checks for allergic reactions to colour products and is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page.';

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
