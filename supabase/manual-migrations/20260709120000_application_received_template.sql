-- Application-Received Template (Vermittlungs-Bewerbung, Broker-Flow mit Calendly).
-- Wird direkt nach Bewerbungseingang gesendet und enthält den Termin-Buchungslink.
-- Editierbar über /admin/email-templates (Tab "Bewerbungseingang").

alter table public.tenants
  add column if not exists application_received_subject text,
  add column if not exists application_received_body text,
  add column if not exists application_received_button_label text;

comment on column public.tenants.application_received_subject is
  'Betreff der Bestätigungsmail bei Vermittlungs-Bewerbungen (Calendly-Flow).';
comment on column public.tenants.application_received_body is
  'Body (Plain-Text mit {{placeholders}}) der Bestätigungsmail bei Vermittlungs-Bewerbungen.';
comment on column public.tenants.application_received_button_label is
  'Beschriftung des CTA-Buttons (fällt zurück auf broker_block.button_label bzw. "Jetzt Termin buchen").';
