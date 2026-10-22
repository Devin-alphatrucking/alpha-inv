DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'invoice_crm') THEN
    CREATE ROLE invoice_crm LOGIN PASSWORD 'invoice_crm_dev_password';
  ELSE
    ALTER ROLE invoice_crm WITH LOGIN PASSWORD 'invoice_crm_dev_password';
  END IF;
END
$$;
