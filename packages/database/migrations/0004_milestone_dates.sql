-- Milestones gain the two dates a lightweight roadmap actually needs: when it
-- is aimed at, and when it was reached. Both optional -- a milestone with
-- neither is still a valid marker in the project's history.

ALTER TABLE milestones ADD COLUMN target_date TEXT;
ALTER TABLE milestones ADD COLUMN completed_at TEXT;

-- Anything already marked reached gets its occurrence date as its completion
-- date, so existing rows don't read as "reached, but never".
UPDATE milestones SET completed_at = occurred_at WHERE status = 'reached' AND completed_at IS NULL;
