-- Erweitert landing_pages.flow_type um 'broker' (Vermittlung)
ALTER TABLE public.landing_pages DROP CONSTRAINT IF EXISTS landing_pages_flow_type_check;
ALTER TABLE public.landing_pages
  ADD CONSTRAINT landing_pages_flow_type_check
  CHECK (flow_type IN ('classic','fast','broker'));
