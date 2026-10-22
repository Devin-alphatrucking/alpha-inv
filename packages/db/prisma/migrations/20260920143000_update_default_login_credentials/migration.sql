-- Update only the original seeded accounts. Custom users are left untouched.
UPDATE "User"
SET
  "email" = 'admin@sanvicasagroup.in',
  "passwordHash" = '$2b$12$NoKsSsYyVCjcp1LqLtoMPON7lI28cOMi/X3KsbR5yKVPpgjVcmvS.'
WHERE "email" = 'admin@example.com';

UPDATE "User"
SET
  "email" = 'staff@sanvicasagroup.in',
  "passwordHash" = '$2b$12$oasADxvvlkS8wiWWZOYcrObcwZzZwrYa5x3DbyD4oHiFML9FcjmsS'
WHERE "email" = 'staff@example.com';
