-- Add enum value for pickup
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PICKUP'
      AND enumtypid = '"FleetUnitType"'::regtype
  ) THEN
    ALTER TYPE "FleetUnitType" ADD VALUE 'PICKUP';
  END IF;
END $$;
