DROP POLICY IF EXISTS "Authenticated users can read jobs" ON public.jobs;

CREATE POLICY "Users can read their own jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (auth.uid() = created_by);