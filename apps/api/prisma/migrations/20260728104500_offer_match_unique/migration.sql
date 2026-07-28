-- הצעה אחת פר התאמה (ביקורת Codex, PR #3):
-- ניקוי כפילויות קיימות תחילה — נשארת ההצעה החדשה ביותר פר התאמה.
DELETE FROM offers o USING offers newer
WHERE o.match_id = newer.match_id AND o.id < newer.id;

-- שם האינדקס תואם לקונבנציית Prisma עבור @unique על match_id
CREATE UNIQUE INDEX "offers_match_id_key" ON "offers"("match_id");
