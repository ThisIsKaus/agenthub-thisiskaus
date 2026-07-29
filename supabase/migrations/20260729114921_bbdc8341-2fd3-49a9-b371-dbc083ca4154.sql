CREATE TABLE public.state (
  id text PRIMARY KEY DEFAULT 'current',
  services jsonb NOT NULL DEFAULT '{}'::jsonb,
  models jsonb NOT NULL DEFAULT '[]'::jsonb,
  corpus jsonb NOT NULL DEFAULT '{}'::jsonb,
  spend jsonb NOT NULL DEFAULT '{}'::jsonb,
  factory jsonb NOT NULL DEFAULT '{}'::jsonb,
  digest jsonb NOT NULL DEFAULT '{}'::jsonb,
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.state TO authenticated;
GRANT ALL ON public.state TO service_role;
ALTER TABLE public.state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read state"
  ON public.state FOR SELECT TO authenticated USING (true);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('capture','factory_stage','ingest','intake','report')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','done','failed')),
  result jsonb,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX jobs_status_created_at_idx ON public.jobs (status, created_at DESC);

GRANT SELECT, INSERT ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read jobs"
  ON public.jobs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can queue jobs"
  ON public.jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

INSERT INTO public.state (id, services, models, corpus, spend, factory, digest, health)
VALUES (
  'current',
  '{"lms":"unknown","router":"unknown","aliases":0}'::jsonb,
  '[]'::jsonb,
  '{"chunks":0,"documents":0}'::jsonb,
  '{"mtd":0,"requests":0}'::jsonb,
  '{"wip":0,"limit":0,"projects":[]}'::jsonb,
  '{"date":null,"items":0,"flags":0,"tasks":0}'::jsonb,
  '{"passed":0,"warnings":0,"failed":0,"at":null}'::jsonb
);