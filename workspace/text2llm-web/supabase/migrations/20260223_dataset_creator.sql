-- Up migration for Dataset Creator feature

-- 1. Add tier column to profiles if it doesn't exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tier text DEFAULT 'free';

-- 2. Create dataset_jobs table
CREATE TABLE IF NOT EXISTS dataset_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  file_key text, -- Now optional because scrape/api tasks might not have an initial upload
  output_format text NOT NULL DEFAULT 'jsonl',
  status text NOT NULL DEFAULT 'pending', -- pending, queuing, scraping, cleaning, processing, completed, failed
  scrape_config jsonb,
  api_config jsonb,
  synth_config jsonb,
  output_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE dataset_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create their own jobs" 
ON dataset_jobs FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own jobs" 
ON dataset_jobs FOR SELECT 
USING (auth.uid() = user_id);
