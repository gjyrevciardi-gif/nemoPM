ALTER TABLE intelligence_reviews ADD COLUMN inference_json TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN evidence_json TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN confidence REAL;
ALTER TABLE intelligence_reviews ADD COLUMN source TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN impact TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE intelligence_reviews ADD COLUMN corrected_title TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN corrected_category TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN corrected_status TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN corrected_cluster TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN review_kind TEXT NOT NULL DEFAULT 'INFERENCE';
ALTER TABLE intelligence_reviews ADD COLUMN auto_verdict TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN proposal_outcome TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN rejection_reason TEXT;
ALTER TABLE intelligence_reviews ADD COLUMN cluster_verdict TEXT;

CREATE INDEX IF NOT EXISTS idx_intelligence_reviews_finding ON intelligence_reviews(project_id, finding_id);
