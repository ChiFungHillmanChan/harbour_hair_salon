-- Correct only the exact stale colouring copy observed on the public page.
-- Quoted JSON values avoid rewriting a paragraph the salon has customised.
-- Prices, durations and all other content remain unchanged; reruns are no-ops.
BEGIN TRY
BEGIN TRAN;

UPDATE [dbo].[ServiceCategoryContent]
SET [overviewJson] = REPLACE([overviewJson] COLLATE Latin1_General_100_BIN2, N'"A patch test is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page — it only takes a minute."', N'"A patch test is required at least 48 hours before any colour appointment. You can book Consultation & Patch Test via our booking page."'),
    [updatedAt] = CURRENT_TIMESTAMP
WHERE [slug] = N'colouring'
  AND [category] = N'Colouring'
  AND CHARINDEX(N'"A patch test is required at least 48 hours before any colour appointment. You can book a free patch test via our booking page — it only takes a minute."', [overviewJson] COLLATE Latin1_General_100_BIN2) > 0;

UPDATE [dbo].[ServiceCategoryContent]
SET [processJson] = REPLACE([processJson] COLLATE Latin1_General_100_BIN2, N'"Required 48 hours before any colour appointment. Quick, free, and protects you from allergic reactions."', N'"Required at least 48 hours before any colour appointment."'),
    [updatedAt] = CURRENT_TIMESTAMP
WHERE [slug] = N'colouring'
  AND [category] = N'Colouring'
  AND CHARINDEX(N'"Required 48 hours before any colour appointment. Quick, free, and protects you from allergic reactions."', [processJson] COLLATE Latin1_General_100_BIN2) > 0;

-- Existing FAQ rows are skipped by the insert-only FAQ seed.
UPDATE [dbo].[Faq]
SET [answer] = N'A patch test checks for allergic reactions to colour products and is required at least 48 hours before your colour appointment. You can book Consultation & Patch Test through our booking page. The current price is listed in our service menu.',
    [updatedAt] = CURRENT_TIMESTAMP
WHERE [key] = N'services-master'
  AND [question] = N'Do I need a patch test before colouring?'
  AND [answer] COLLATE Latin1_General_100_BIN2 = N'A patch test checks for allergic reactions to colour products and is required at least 48 hours before your colour appointment. You can book a free patch test through our booking page.';

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
