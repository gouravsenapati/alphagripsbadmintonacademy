alter table if exists public.invoices
  add column if not exists calculated_amount numeric(10,2),
  add column if not exists override_amount numeric(10,2),
  add column if not exists override_reason text,
  add column if not exists override_updated_by integer;

update public.invoices
set calculated_amount = coalesce(calculated_amount, amount)
where calculated_amount is null;

alter table if exists public.academies
  add column if not exists location text,
  add column if not exists contact_details text,
  add column if not exists assigned_manager_user_id integer;

update public.academies
set location = coalesce(location, address)
where location is null;

create unique index if not exists idx_invoice_receipts_receipt_number
on public.invoice_receipts (receipt_number);
